# Certificación: panel lateral por empresa + alta desde el módulo

## Contexto

El módulo "Certificación" (Ronda 87-88, ex-"Documentos") ya es el único punto de carga de documentos de compliance de la flota: una sábana plana (`GET /compliance-records/pending`) filtrable por categoría/tipo de operación/búsqueda, con carga individual por fila y carga masiva restringida a una sola empresa (`BulkDocumentUploadModal`). Empresas quedó de solo lectura para documentos, con un link `Subir en Certificación` que deep-linkea a `/dashboard/certification?carrier_id={id}`.

El usuario pidió (Ronda 89, sesión del 2026-08-04) que la experiencia sea más "inmersiva, intuitiva, funcional, didáctica e interactiva": poder elegir una empresa y desde ahí subir/actualizar sus documentos (individual o masivo) sin salir del módulo, y poder dar de alta una empresa nueva desde el mismo lugar — unificando el flujo de "me falta documentación → la subo" en una sola pantalla.

Se investigó el código antes de diseñar (no se asumió nada): `TransporterSlideOver.tsx` ya implementa exactamente el patrón de interacción buscado (slide-over que se abre al clickear una empresa en un listado, con secciones de resumen y un link "Ver ficha completa →" a `/dashboard/carriers/{id}`) — se usa hoy en el listado de Empresas. `CarrierSearchPicker.tsx` (typeahead de empresa) y el panel inline "Nueva empresa" de `app/dashboard/carriers/page.tsx` (`carriersApi.create`, siembra `compliance_records` en estado MISSING automáticamente al insertar) también ya existen y son reutilizables.

Se evaluaron 3 enfoques con el usuario (ver checklist de decisión abajo) — se eligió el de menor riesgo: extender la sábana actual con un panel lateral por empresa, sin rehacer el layout ni construir una ficha nueva.

## Decisiones confirmadas con el usuario

1. **Destino del "ver más"**: el drill-down profundo de una empresa (perfil, roster, baja, transferir, seguros) sigue siendo la ficha de Empresas que ya existe (`/dashboard/carriers/{id}`) — no se construye una ficha nueva dentro de Certificación.
2. **Alcance de "actualizar información" desde Certificación**: solo estado de documentos (subir/reemplazar, ver vencimientos). Editar datos de perfil de la empresa (razón social, contactos, etc.) sigue siendo exclusivo de la ficha de Empresas.
3. **Enfoque de interacción**: panel lateral (slide-over) sobre la sábana actual — no un layout maestro-detalle de 2 columnas, no solo links que navegan fuera del módulo.

## Alcance

**Dentro de alcance:**
1. `CertificationCompanyPanel.tsx` — panel nuevo, modelado sobre `TransporterSlideOver.tsx` (mismo patrón exacto: `role="dialog"`, backdrop `fixed inset-0 bg-black/50 animate-backdrop-in`, contenedor centrado `animate-modal-in`, focus trap, Escape para cerrar — es el mismo dialog centrado que usan `DriverDetailPanel`/`VehicleDetailPanel`, pese al nombre "SlideOver").
2. El nombre de empresa en cada fila de `PendingDocumentsTable` pasa a ser clickeable y abre el panel (hoy es texto plano).
3. Filtro nuevo "Empresa" en la barra de filtros de Certificación, usando `CarrierSearchPicker`.
4. Botón "+ Nueva empresa" en la barra de Certificación. Requiere extraer el panel inline de alta de `carriers/page.tsx` a un componente reusable pequeño (ver sección 3).
5. Tests nuevos/actualizados (ver sección Testing).

**Explícitamente fuera de alcance:**
- Cualquier cambio al modelo de datos o endpoints de Seguros (`insurance_policies`/`policy_coverages`/etc.) — se mantiene fuera del panel nuevo, no se fusiona con `compliance_records`. Mostrar pólizas dentro del panel de Certificación queda para una iteración futura si se pide explícitamente.
- Layout maestro-detalle de 2 columnas (enfoque B evaluado y descartado).
- Editar perfil de empresa (razón social, contactos, tipo de operación) desde Certificación — sigue siendo exclusivo de la ficha de Empresas.
- Cambiar el comportamiento de la selección múltiple / `BulkDocumentUploadModal` ya existente — el panel nuevo es una **puerta de entrada adicional** al mismo modal, no un reemplazo del flujo de checkboxes de la tabla (que sigue sirviendo para "arreglar muchas filas de distintas empresas de una pasada", filtrando la tabla primero).
- Tabs "Resumen"/"Documentos Sin Clasificar" del módulo (siguen deshabilitados, sin spec — Ronda 87).

## 1. `CertificationCompanyPanel.tsx` (nuevo)

```
components/dashboard/CertificationCompanyPanel.tsx
components/dashboard/CertificationCompanyPanel.test.tsx
```

Props:
```ts
interface Props {
  carrierId:   string | null   // null = cerrado
  onClose:     () => void
}
```

Comportamiento:
- `useQuery(['compliance-pending-carrier-panel', carrierId], () => complianceApi.listPending({ carrierId, limit: 200 }), { enabled: !!carrierId })` — mismo endpoint que ya usa `BulkDocumentUploadModal`, trae **todos** los pendientes de esa empresa (no acotado al filtro de categoría/tipo de operación que esté activo en la tabla de fondo).
- Header: nombre + tax_id + chips de `carrier_operation_types` (mismo chip que ya usa `PendingDocumentsTable`).
- Lista de pendientes: una fila por `PendingComplianceRow`, cada una con botón "Subir" individual (`complianceApi.uploadFile`, invalida `['compliance-pending-carrier-panel', carrierId]` y `['compliance-pending']` para que la tabla de fondo también se refresque).
- Botón "Subir masivo": abre `BulkDocumentUploadModal` **sin modificarlo** — mismo componente que ya usa `app/dashboard/certification/page.tsx`, con `pendingSlots` = los datos ya cargados por el panel (evita un segundo fetch).
- Footer: `Link href={`/dashboard/carriers/${carrierId}`}` con texto "Ver ficha completa →" (mismo texto/ícono que usa `TransporterSlideOver`).
- Estados de carga/error: mismo patrón que la tabla principal de Certificación (`Loader2` + mensaje, sin spinner que borre contenido ya visible si el usuario reabre con datos cacheados).

## 2. Integración en `PendingDocumentsTable.tsx` y `app/dashboard/certification/page.tsx`

- `PendingDocumentsTable`: nuevo prop `onOpenCompanyPanel: (carrierId: string) => void`. La celda de EETT pasa de `<p>{r.carrier_name}</p>` a un `<button>` con el mismo texto, que llama `onOpenCompanyPanel(r.carrier_id)`. No cambia el checkbox de selección ni el flujo de "Subir masivo" ya existente (siguen coexistiendo).
- `CertificationPageInner`: nuevo estado `const [panelCarrierId, setPanelCarrierId] = useState<string | null>(null)`, pasado a `PendingDocumentsTable` y a `<CertificationCompanyPanel carrierId={panelCarrierId} onClose={() => setPanelCarrierId(null)} />` al final del árbol (mismo nivel que el `BulkDocumentUploadModal` ya montado condicionalmente).
- Filtro "Empresa": nuevo control en la barra de filtros usando `CarrierSearchPicker` — al elegir una empresa, se **filtra la tabla** (`carrierId` ya soportado por `complianceApi.listPending`, mismo mecanismo que hoy usa `?carrier_id=` de la URL). Abrir el panel sigue siendo exclusivo de clickear el nombre en una fila — el picker filtra, no abre el panel, para no mezclar dos comportamientos en un mismo control.

## 3. "+ Nueva empresa" — extracción del panel de alta

`app/dashboard/carriers/page.tsx` ya tiene un panel inline de alta (`addCarrierOpen`/`carrierForm`/`handleAddCarrier`, líneas ~76-120 y ~186-216) con 2 campos (`tax_id`, `business_name`) que llama a `carriersApi.create()` — el backend ya siembra `compliance_records` en MISSING automáticamente al insertar, confirmado en el comentario existente del código.

Se extrae a un componente pequeño y reusable:

```
components/dashboard/NewCarrierPanel.tsx
components/dashboard/NewCarrierPanel.test.tsx
```

```ts
interface Props {
  open:              boolean
  initialBusinessName?: string
  onClose:           () => void
  onCreated:         (carrier: CarrierCreateResult) => void   // el caller decide qué hacer después
}
```

- `carriers/page.tsx` lo usa igual que hoy — `onCreated` navega a `/dashboard/carriers/{id}` (comportamiento sin cambios, incluyendo el handoff de `driver_name`/`tractor_plate` de la Ronda 43, que se resuelve en el callback del caller, no dentro del componente extraído).
- Certificación lo monta desde un botón nuevo en su barra de filtros — `onCreated` llama `setPanelCarrierId(created.id)` en vez de navegar, para que el usuario siga en Certificación y cargue la documentación de la empresa recién creada directo en el panel lateral que ya se construyó en la sección 1.

Este es un refactor de extracción pura (mover JSX+lógica existente a un componente propio, sin cambiar su comportamiento actual en `carriers/page.tsx`) — la suite de tests de esa página debe seguir en verde sin cambios de aserciones sobre el flujo de alta.

## Manejo de errores

Sin patrones nuevos: cada acción (upload individual, upload masivo, alta de empresa) maneja su propio error inline con el mismo estilo ya usado en toda la app (`text-red-500`/`text-red-600` + mensaje corto). El panel en sí solo agrega manejo de error para su fetch inicial de pendientes (mensaje + los datos quedan vacíos, sin romper el resto de la UI).

## Testing

- `CertificationCompanyPanel.test.tsx`: abre con `carrierId`, trae y muestra pendientes; botón "Subir" individual llama `complianceApi.uploadFile` e invalida las queries correctas; botón "Subir masivo" abre `BulkDocumentUploadModal` con los `pendingSlots` ya cargados; el link "Ver ficha completa" tiene el `href` correcto; `carrierId=null` no renderiza nada.
- `PendingDocumentsTable.test.tsx`: clickear el nombre de empresa llama `onOpenCompanyPanel` con el `carrier_id` correcto; el checkbox de selección sigue funcionando sin interferencia.
- `NewCarrierPanel.test.tsx`: nuevo — no existe `carriers/page.test.tsx` hoy (confirmado, no hay test file para esa página), así que no hay aserciones previas del flujo de alta que migrar. Cubre desde cero: validación de campos requeridos, error de creación, `onCreated` se llama con el carrier creado, `open=false` no renderiza nada.
- `app/dashboard/certification/page.test.tsx`: nuevo filtro "Empresa" dispara `listPending` con el `carrierId` elegido; botón "+ Nueva empresa" monta `NewCarrierPanel`; al crear, se abre el panel de la empresa nueva (`panelCarrierId` pasa a tener el id creado).

## Verificación

- Backend: sin cambios — no requiere `pytest`.
- Frontend: `npx tsc --noEmit`, `npx vitest run`, `npm run build`.
- Manual/Playwright contra staging: crear una empresa nueva desde Certificación → se abre su panel con documentación vacía (MISSING) → subir un documento individual → aparece reflejado en la sábana de fondo sin recargar la página → abrir el panel de una empresa existente con pendientes reales → "Subir masivo" funciona igual que hoy → "Ver ficha completa" navega a la ficha real.

## Archivos críticos

- `monitor-app/frontend/components/dashboard/CertificationCompanyPanel.tsx` (nuevo)
- `monitor-app/frontend/components/dashboard/NewCarrierPanel.tsx` (nuevo, extraído)
- `monitor-app/frontend/components/dashboard/TransporterSlideOver.tsx` (patrón de referencia, no se modifica)
- `monitor-app/frontend/components/dashboard/PendingDocumentsTable.tsx`
- `monitor-app/frontend/components/dashboard/BulkDocumentUploadModal.tsx` (reusado, sin cambios)
- `monitor-app/frontend/components/dashboard/CarrierSearchPicker.tsx` (reusado, sin cambios)
- `monitor-app/frontend/app/dashboard/certification/page.tsx`
- `monitor-app/frontend/app/dashboard/carriers/page.tsx`
