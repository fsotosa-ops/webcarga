# Entrega 1: kit, fichas del Directorio y navegación (plan de implementación)

> Método del proyecto (14/10): ejecución inline, sin subagentes; un documento por entrega (HU + criterios + contratos +
> tareas, sin código); un test por criterio de aceptación; humo E2E antes del despliegue; un despliegue y una revisión.

**Objetivo:** que empresa, conductor y equipo tengan una ficha liviana con las piezas de Certificación, y que todo nombre
de una entidad en las pantallas de trabajo lleve a su vista rápida.

**Arquitectura:**
- El kit vive en `components/ui`.
- Las fichas son una sola forma: encabezado, secciones y un bloque de Detalles, con la pestaña Documentos de la empresa
  generalizada.
- La vista rápida pasa a un proveedor único en el layout del dashboard, y `EntityCell` se vuelve un enlace que la abre.
- **El modal de conductor y equipo sobre la ficha de empresa ES la ficha propia en variante `dialog`:** se retiran
  `DriverDetailPanel` y `VehicleDetailPanel`. Si no, habría dos implementaciones de "Detalles".

**Stack:**
- Frontend: Next.js, React Query, Tailwind 4 y vitest.
- Backend: FastAPI y asyncpg, con pytest contra la copia local (`TEST_DB_LOCAL_PORT=55322`) y, al cierre, contra la
  base real.

**Spec:** `docs/superpowers/specs/2026-10-15-fichas-directorio-y-navegacion-design.md`.
**Maquetas:** `docs/superpowers/mockups/2026-10-15-fichas-ficha-alineada.html` (material visual) y
`…-ficha-liviana.html` (estructura). Las dos se aceptan con una captura lado a lado.

## Historia de usuario

Como **coordinador de Certificación u Operaciones**, quiero abrir una ficha que me diga en una línea quién es, si puede
operar y por qué no, y quiero llegar a ella desde cualquier cola o viaje con un clic. Así resuelvo sin buscar a mano
ni leer lo mismo tres veces.

## Restricciones globales

- **Idioma:** español neutral, sin voseo (`lib/copy/espanol-neutral.test.ts`). Rutas en inglés y etiquetas en español.
  Nombres de código, componentes y archivos nuevos en inglés.
- **Íconos:** cero emojis, solo `lucide-react`.
- **Sistema visual:**
  - Solo primitivas de `components/ui` y tokens: `text-informativo`, `text-accion`, `text-status-incidente`,
    `text-warning` y `text-resuelto`.
  - Escala 11/13/15/20/28 px, nada bajo 11 px.
  - Los topes de `lib/ui/sistema.test.ts` (color crudo y `<h1>`) y de `lib/ui/escala.test.ts` solo bajan, y se bajan en
    el mismo commit que los hace bajar.
- **Fechas:** cortas, con `diaMes` (02/10) y año solo si no es el actual.
- **Catálogos:** sin valores de catálogo en el código: el tipo de equipo sale de `useAssetTypes` y "es tracto" se
  pregunta con `is_power_unit`, nunca por la etiqueta.
- **Permisos:** los de hoy (`directory.edit`, `directory.delete`, `directory.identity`, `directory.fleet_status`,
  `documents.upload`, `documents.review` y `certification.request`). Ningún botón que la API rechace.
- **Verificación:** suite completa y `npm run build` solo si se tocó código compartido. Esta entrega SÍ toca código
  compartido (`EntityCell`, `ComplianceCounts` y el layout), así que se corren una vez, al final.

## Foco de revisión (lo que la spec no dice y más probablemente rompe)

1. **Conductor o equipo sin empresa.** La ficha existe (C5), el encabezado dice "Sin empresa" y Documentos muestra sus
   filas aunque no haya `carrier_id`. Lo prueba la Tarea 4 (paso de verificación más test).
2. **Empresa dada de baja o en onboarding.** El chip de habilitación va en gris y la razón no habla de documentos, sino
   de "La empresa no está activa". Lo prueba la Tarea 5.
3. **Conductor o equipo dado de baja.** La habilitación va en gris (`enablementStyleFromFlag(…, false)`) y no se
   muestra la razón. Lo prueba la Tarea 3.
4. **Teclado y clic modificado sobre `EntityCell`.**
   - Enter abre la vista rápida.
   - Ctrl/Cmd + clic, Shift + clic y el clic medio no la abren: navega el navegador.
   - Lo prueba la Tarea 2.
5. **Error al guardar Detalles.** El formulario queda abierto con lo escrito y el mensaje de la API; nada se pierde.
   Lo prueba la Tarea 3.

---

### Tarea 0: el backend expone lo que bloquea la habilitación

**Archivos:**
- `backend/api/app/services/fleet_compliance.py` (`carrier_compliance` y `summary_from_row`).
- `backend/api/app/schemas/states.py` (`ComplianceSummary`).
- `frontend/lib/states.ts` (tipo `ComplianceSummary`).
- Tests: `backend/api/tests/test_blocking_counts.py`.

**Contrato:**
- `ComplianceSummary` gana `blocking: { own: int, fleet: int | None }`.
- **Empresa:** `own` es la cantidad de obligatorios vencidos o faltantes de la empresa misma, y `fleet` la de su flota
  activa. Ambos salen de la misma columna `blocks` del CTE `owed`, separados por `entity_type = 'CARRIER'`.
- **Conductor o equipo:** `own = blocking_mandatory` y `fleet = None`.
- Invariante: `can_operate == (estado ACTIVE y own + (fleet o 0) == 0)`.

- [ ] Escribir F2 y F3 (nivel base real, en la copia local):
  - **F2:** para todo conductor activo, `can_operate` es falso si y solo si `blocking.own > 0`.
  - **F3:** para toda empresa ACTIVE, `can_operate` es falso si y solo si `blocking.own + blocking.fleet > 0`; para
    una no activa, `can_operate` es falso.
- [ ] Verlos fallar (falta el campo).
- [ ] Implementar:
  - en el CTE, dos `count(*) FILTER (WHERE o.blocks AND …)`;
  - en `summary_from_row`, el campo nuevo;
  - el tipo en `lib/states.ts`.
- [ ] Verlos pasar. Correr los tests de `fleet_compliance` y de `entity_summary` para confirmar que no cambió ninguna
  cifra.
- [ ] Commit.

### Tarea 1: el kit en `components/ui`

**Archivos:**
- Crear `frontend/components/ui/tabla/Tabla.tsx` y su test.
- Modificar `frontend/components/ui/ComplianceCounts.tsx` y su test.
- Modificar `frontend/components/compliance/pending/PendingSummaryList.tsx` para que use `ComplianceCounts`.
- Modificar `frontend/components/compliance/pending/PendingHoldersPanel.tsx` para que su tabla sea `Tabla` (es la referencia
  visual: no debe cambiar de aspecto, y la captura de antes y después lo prueba).
- Crear `frontend/components/ui/ActionsMenu.tsx` (el "⋯") y su test.

**Contratos:**
- `Tabla`:
  - `columns: { id, label, align?, sortable? }[]`, filas como `children` y `sort?` (de `tabla/useOrden`);
  - borde y esquinas redondeadas;
  - encabezado `bg-bg-main`, `text-etiqueta` gris en texto normal (sin `uppercase`);
  - filas en `text-dato`.
- `ComplianceCounts`: el mismo nombre y las mismas props de hoy, con el aspecto de las pastillas teñidas de Pendientes
  (rojo, naranja y gris con número). Empresas y Pendientes lo usan.
- `ActionsMenu`:
  - `items: { id, label, icon?, destructive?, onSelect }[]`;
  - si `items` está vacío no dibuja nada;
  - funciona con teclado (Enter y Escape) y su botón tiene `aria-label`.

- [ ] Tests:
  - **K1a:** `Tabla` dibuja los encabezados sin `uppercase`.
  - **K1b:** `ComplianceCounts` muestra las tres pastillas con su número y omite ninguna.
  - **F7-base:** `ActionsMenu` con `items` vacío no renderiza nada.
- [ ] Implementar. Migrar la lista de Pendientes a `ComplianceCounts` y su tabla a `Tabla`.
- [ ] Ver en pantalla Pendientes y Empresas, porque las dos cambian de conteos.
- [ ] Commit.

### Tarea 2: la vista rápida como proveedor y `EntityCell` como enlace

**Archivos:**
- Crear `frontend/components/dashboard/QuickViewProvider.tsx`; adentro, `useQuickView` (que ya existe) y un
  `<EntityQuickView>`.
- Montar el proveedor en `frontend/app/dashboard/layout.tsx`.
- Modificar `frontend/components/dashboard/EntityCell.tsx` y su test.

**Contratos:**
- `useOpenQuickView(): ((target: QuickViewTarget) => void) | null`. Es `null` sin `directory.read` o fuera del
  proveedor.
- `EntityCell`:
  - con `id`, es `<a href={driverHref|assetHref|carrierHref(id)}>`;
  - `onClick`: sin teclas modificadoras y con el botón izquierdo, `preventDefault` y abre la vista rápida (la prop
    `onOpen` si llega, si no el proveedor); con Ctrl/Cmd/Shift o con el clic medio no hace nada propio;
  - sin `id` sigue siendo texto, como hoy.
- **El Monitor y el Cierre se quedan con su `onOpen`** (el Cierre marca la fila de origen), para no tocar dos pantallas
  que funcionan. El proveedor sirve a las pantallas nuevas.

- [ ] Tests:
  - **N1:** `EntityCell` tiene `href` a la ficha; un clic llama a `onOpen`; Ctrl + clic y Meta + clic no lo llaman.
  - **RF4:** Enter sobre el enlace abre la vista rápida.
- [ ] Implementar.
- [ ] Correr los tests de `TripTable`, de las secciones del Cierre y de `EntityQuickView`.
- [ ] Commit.

### Tarea 3: la ficha de conductor y equipo (encabezado, Detalles y menú)

**Archivos:**
- Crear `frontend/components/directory/ProfileHeader.tsx`, `DetailsBlock.tsx` y `blockingReason.ts` (en
  `lib/states.ts`, si encaja con el glosario).
- Reescribir `frontend/components/dashboard/FleetProfile.tsx`.
- Tests: `FleetProfile.test.tsx` y `blockingReason.test.ts`.

**Contratos:**
- `ProfileHeader`:
  - props `title`, `lifecycle: StateStyle`, `enablement: StateStyle | null` (`null` mientras carga), `reason: string |
    null`, `onSeeDocuments`, `primaryAction: ReactNode` y `menu: ActionsMenu items`;
  - usa `EncabezadoDePagina`.
- `blockingReason(records, summary)`:
  - devuelve `null` si `can_operate` o si la entidad no está activa;
  - si no, devuelve la frase con los nombres de los obligatorios que bloquean (`isBlocking`), hasta 2 nombres y "y N
    más". Ejemplo: "Licencia vencida y 2 documentos faltan".
- `DetailsBlock`:
  - props `rows: { label, value: ReactNode }[]`, `editForm?: ReactNode` y `canEdit`;
  - "Editar" cambia el bloque por el formulario en el mismo lugar;
  - **el borrador se vuelve a cargar desde los datos cada vez que se abre** (efecto sobre "abierto", no sobre el montaje).
- `FleetProfile({ kind, id, variant: 'page' | 'dialog', onClose? })`:
  - **Datos:** `GET …/summary` para el encabezado, `GET /drivers|assets/{id}` para la edición, `…/assignments` y
    `…/activity`.
  - **Secciones:** Resumen · Documentos · Contactos (conductor); Resumen · Documentos (equipo); en `?tab=`.
  - **Resumen:**
    - conductor: RUT, empresa con historial, tracto habitual (`EntityCell`), origen habitual y la línea de actividad;
    - equipo: tipo y subtipo (`useAssetTypes`), tipo de operación, año, conductor habitual (`EntityCell`), empresa con
      historial y la actividad.
  - **Menú:**
    - Transferir o Asignar a una empresa (`directory.edit`);
    - Corregir RUT o patente (`directory.identity`);
    - Dar de baja o Reactivar (`directory.fleet_status`);
    - Quitar de la empresa (`directory.edit`, solo con empresa).
    - Todo lo destructivo, con su confirmación de hoy (`BajaReasonModal` y `ConfirmarBaja`).
  - **Acción principal:** "Subir documentos" (`documents.upload`) o "Pedir a Certificación" (`certification.request`).

- [ ] Tests:
  - **F1:** con `can_operate = false`, la razón nombra la licencia vencida.
  - **RF3:** dado de baja → habilitación en gris y sin razón.
  - **F4:** el Resumen no tiene chip ni tarjeta de pendientes.
  - **F7:** sin `directory.edit` ni `directory.identity` ni `directory.fleet_status`, el menú no se dibuja.
  - **F8:** abrir "Editar", cancelar, cambiar el dato afuera y reabrir muestra el valor nuevo.
  - **RF5:** si la API rechaza al guardar, el formulario sigue abierto con lo escrito y el mensaje.
  - **F9:** el tracto habitual del conductor es un enlace a su ficha.
- [ ] Implementar.
- [ ] Captura contra `…-ficha-alineada.html` (Resumen).
- [ ] Commit.

### Tarea 4: Documentos con la pestaña de la empresa generalizada

**Archivos:**
- Renombrar y generalizar `frontend/components/compliance/CarrierDocumentsWorkspace.tsx` a `DocumentsWorkspace.tsx`.
- Usarlo en la ficha de empresa y en `FleetProfile`.

**Contrato:** `DocumentsWorkspace({ scope })`, donde `scope` es
`{ kind: 'carrier', carrierId, carrier } | { kind: 'driver' | 'asset', entityId, carrierId: string | null }`.
- Con una sola entidad, dibuja una `TarjetaDeSujeto` abierta, sin la cabecera de sujeto y sin las acciones de flota
  (esas viven en el "⋯" de la ficha).
- El filtro es el `SegmentedControl` Vencidos · Por vencer · Faltan · Todos, con sus números. Abre en el primero que
  tenga algo.
- La franja de subida en lote usa `BulkUploadReview` con el contexto de la entidad.
- Las filas son `RenglonPendiente` (con `pendingRowStatus`), dentro de `Tabla`, con columnas Documento · Estado ·
  Actualizado y la acción.
- En la empresa se conserva la agrupación por sujeto aprobada en C7 (una tarjeta por la empresa y una por cada
  conductor o equipo). El nombre de cada sujeto en su cabecera es un `EntityCell`. Es la forma que toma el "De quién"
  de la spec, sin una columna aparte.

- [ ] **Verificar primero, en la copia local:** si `complianceApi.listPending({ entityId, estado: 'todos' })` sin
  `carrierId` devuelve las filas de un conductor **sin empresa**.
  - Si no las devuelve: agregar en `routers/compliance.py` que, con `entity_id` y sin `carrier_id`, el alcance no exija
    empresa activa, con su test de API.
  - Eso cubre RF1.
- [ ] Tests:
  - **F5:** con 0 vencidos y 2 faltantes, abre en Faltan.
  - **F6:** la fila de un vencido dice "Venció el 02/10" y "Subir", igual que Pendientes (misma fila de prueba).
  - **RF1:** un conductor sin empresa lista sus documentos.
- [ ] Implementar. Correr los tests de la ficha de empresa (C7) y de Pendientes.
- [ ] Captura contra `…-ficha-alineada.html` (Documentos).
- [ ] Commit.

### Tarea 5: la ficha de empresa con la misma forma

**Archivos:** `frontend/app/dashboard/carriers/[id]/page.tsx` y su test.

**Contrato:**
- **Encabezado:** `ProfileHeader`, con la razón desde `blocking`: "N obligatorios de la empresa y M de su flota". Si
  la empresa no está activa: "La empresa no está activa".
- **Resumen:** `DetailsBlock` con RUT, tipo de operación ("según su flota" y la gestión declarada, con
  `GestionDeclarada`), clientes ("Editar clientes" pasa al menú) y el estado de los seguros (un chip, o "Sin pólizas
  registradas").
- **Sale:** el anillo, las tarjetas con las cifras de conductores y equipos, la tarjeta de seguros vacía y "Tax ID".
  "ID legacy admin" va al formulario de "Editar".
- **Menú:** Editar clientes · Reactivar o Dar de baja (con la vista previa del impacto) · Eliminar; cada uno con su
  permiso de hoy.

- [ ] Tests:
  - **F1-empresa:** la razón dice "3 obligatorios de la empresa y 5 de su flota".
  - **RF2:** una empresa en onboarding dice "La empresa no está activa".
  - **F7-empresa:** sin `directory.delete` no aparecen Dar de baja ni Eliminar.
- [ ] Implementar.
- [ ] Bajar los topes de color crudo, porque la página tenía 55.
- [ ] Captura.
- [ ] Commit.

### Tarea 6: el modal de la ficha de empresa es la ficha propia

**Archivos:**
- `frontend/app/dashboard/carriers/[id]/page.tsx` abre `FleetProfile variant="dialog"` dentro de `DetailShell`.
- Se borran `DriverDetailPanel.tsx`, `VehicleDetailPanel.tsx` y sus tests, migrando los criterios vigentes a los de
  `FleetProfile`.
- `DocumentChecklist` queda solo en `EntityQuickView` y `DocumentPreviewModal`.

- [ ] Test: el modal tiene "Abrir ficha completa" (el enlace a `/dashboard/drivers/{id}`).
- [ ] Implementar y borrar.
- [ ] `grep` de importadores en 0.
- [ ] Bajar los topes de color crudo y de tamaño de letra (los dos paneles sumaban 38 y 18).
- [ ] Commit.

### Tarea 7: enlaces en las pantallas de trabajo y "volver" con filtros

**Archivos:**
- `components/compliance/pending/PendingHoldersPanel.tsx` (titular y empresa; filas de Pendientes: `entity_id`,
  `entity_type` y `carrier_id`).
- `components/compliance/pending/OperationsRequests.tsx` (entidad y empresa).
- `components/compliance/TriageClassifyForm.tsx` / `TriageWorkbench.tsx` (titular propuesto y empresa del detalle).
- `components/dashboard/TripDetailView.tsx` (`driver_id`, `tractor_asset_id` y `carrier_id`).
- `app/dashboard/insurance/page.tsx` (`carrier_id`).
- `components/dashboard/FleetList.tsx` y la lista de empresas (`?next=`).

**Contrato:**
- Cada nombre con `id` se dibuja con `EntityCell` (abre por el proveedor). Sin `id`, texto, como hoy.
- Las listas del Directorio pasan `?next=<la URL actual con sus filtros>`, y la ruta de la ficha vuelve ahí con
  `returnLink`.

- [ ] Tests:
  - **N2:** uno por pantalla (Pendientes, Pedidos, Por asignar, detalle del viaje y Seguros). El nombre es un enlace
    con `href` a la ficha.
  - **N3:** desde `/dashboard/drivers?documents=pending&q=vidal`, la ruta de la ficha vuelve a esa URL.
- [ ] Implementar.
- [ ] Commit.

### Tarea 8: verificación, despliegue y cierre

- [ ] `npx tsc --noEmit`, `npx vitest run` (suite completa, porque se tocó código compartido) y `npm run build`.
- [ ] Backend: los tests del área en la copia local; después, los de la Tarea 0 contra la base real (solo lectura).
- [ ] Humo E2E en la copia local, con los 4 recorridos nuevos de la spec:
  - la razón → "Ver documentos";
  - Pendientes → vista rápida → ficha;
  - la lista filtrada → ficha → volver con el filtro;
  - el modal de la ficha de empresa → "Abrir ficha completa".
  - Y los anteriores en verde.
- [ ] **K1:** comprobar con `grep` que `Tabla`, `ComplianceCounts` y `RenglonPendiente` aparecen en la ficha y en
  Pendientes.
- [ ] Capturas lado a lado con la maqueta, en escritorio y en teléfono: las tres fichas y Pendientes con un nombre
  enlazado. Mostrárselas al usuario.
- [ ] Una revisión del diff. Commit y push a `dev`. Esperar los dos workflows en verde.
- [ ] Recorrer dev con sesión, en solo lectura.
- [ ] Actualizar el AGENTLOG. Lo que sigue es la Entrega 2 (Empresas y Por asignar con el kit).

## Cobertura de la spec

| Spec | Tarea |
|---|---|
| Kit: `Tabla`, conteos, menú, acción de fila (`RenglonPendiente`), barra de secciones y segmentado | 1, 4 |
| Encabezado con razón (`blocking`) | 0, 3, 5 |
| Resumen = un bloque Detalles con Editar | 3, 5 |
| Documentos = workspace generalizado | 4 |
| Menú "⋯" por entidad y permiso | 1, 3, 5 |
| Conductor ↔ tracto habitual | 3 |
| `EntityCell` como enlace + proveedor | 2 |
| Enlaces en Pendientes, Pedidos, Por asignar, viaje y Seguros | 7 |
| Modal con "Abrir ficha completa" | 6 |
| Volver con filtros | 7 |
| Estados: cargando, vacío, sin permiso, falló y teléfono | 3, 4, 5, 8 |
| Trinquetes que bajan | 5, 6, 8 |
| Entrega 2 (Empresas y Por asignar) | fuera de este plan |
