# Vista rápida de empresa, conductor y equipo desde el Cierre — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native, elegido por el usuario).

**Goal:** que el coordinador consulte la empresa, el conductor o el equipo de una fila del Cierre en un panel lateral
de solo lectura, sin salir del Cierre, con "Abrir ficha completa" hacia una dirección canónica (minuta 09/10, ítem 21).

**Architecture:**
- Un endpoint de resumen por entidad (una consulta, sin URLs firmadas, con la regla de vencimiento de siempre).
- Un solo componente `EntityQuickView` con la variante como prop, armado solo con primitivas de `components/ui`.
- Direcciones canónicas `/dashboard/drivers/[id]` y `/dashboard/assets/[id]` que resuelven la empresa y abren su
  panel en la ficha de la empresa.

**Tech Stack:** FastAPI + asyncpg, Next.js (app router) + React Query + Tailwind, vitest, pytest de integración
contra la base real (`conexion_revertida`).

**HU (fuente):** `monitor-app/docs/user-stories/20261011/01-hu-entity-quick-view.md`.
**Maqueta:** `monitor-app/docs/mockups/2026-10-quick-view/entity-quick-view.html`.

## Global Constraints

- **Nombres:** todo lo nuevo en inglés estándar (archivos, componentes, funciones, claves JSON, rutas); textos de la
  UI en español neutral, sin voseo. Los archivos existentes en español no se renombran.
- **Estilo:** solo primitivas de `components/ui` y tokens de la spec 2026-08-16:
  - letra en 11/13/15/20/28 px, nada bajo 11 px;
  - `tabular-nums` en patente, RUT, fecha y teléfono;
  - títulos de sección en minúscula y gris;
  - cian (`--accion`) solo para lo que se puede hacer clic;
  - cero emojis, solo `lucide-react`.
- **Solo lectura:** el panel no escribe nada.
- **Permisos:** endpoints con `require(Permission.DIRECTORY_READ)`; sin ese permiso los nombres de la fila no son
  enlaces (`usePermiso('directory.read')`).
- **Pruebas:** cada test nuevo falla primero (o mutación); solo tests del área. `npm run build` una vez, porque hay
  rutas nuevas y Next solo las confirma en el build.
- **Aceptación visual:** captura de Playwright de la implementación al mismo ancho que la maqueta, lado a lado, en
  escritorio (1440) y teléfono (390). Si no coinciden, no está lista.

## Review Focus

1. **Lo que viene del TMS sin cruzar no se enlaza:** sin id resuelto, la celda queda en texto con "no está en el
   directorio".
2. **Datos faltantes:** sin teléfono, sin origen o sin requisitos, la línea lo dice; nunca un "0" inventado.
3. **Entidad de baja o sin empresa:** chip "De baja"; la ruta canónica de un conductor sin empresa muestra un estado
   claro, no un panel vacío.
4. **Foco y teclado:** Esc cierra y devuelve el foco al enlace de la fila; Tab no se escapa del panel.
5. **Navegar dentro del panel:** "← Volver" vuelve a la entidad anterior; nunca se abren dos paneles.

---

### Task 1: Endpoints de resumen por entidad

**Files:** create `monitor-app/backend/api/app/services/entity_summary.py`; modify `app/routers/drivers.py`,
`app/routers/assets.py`, `app/routers/carriers.py`; test `tests/test_entity_summary_integration.py`.

**Produces:** `GET /api/v1/drivers/{id}/summary`, `GET /api/v1/assets/{id}/summary` y
`GET /api/v1/carriers/{id}/summary`. Responden 404 si no existe y 422 si el id no es un uuid.

Forma común de `documents` (de `compliance_records` con `is_current`, usando `vencido_predicate`,
`por_vencer_predicate` y `vence_el_sql` de `services/vencimientos.py`; nunca otra copia de la regla):

```json
{"documents": {"ok": 12, "expiring": 3, "expired": 2,
               "attention": [{"name": "Licencia A5", "state": "expired", "due_on": "2026-10-02"}]}}
```

`attention` trae como máximo 3 documentos: primero los vencidos y después los que están por vencer, por fecha.

**Campos de cada endpoint:**
- **Conductor:** `id`, `full_name`, `tax_id`, `operational_status`, `carrier {id, name} | null`, `home_location`
  (nombre del origen y cliente) o null, `usual_tractor {id, plate} | null` (de `vehicle_driver_assignments` ACTIVE),
  `phone` (el contacto principal activo) o null, y `documents`.
- **Equipo:** `id`, `license_plate`, `asset_type`, `manufacture_year`, `operation_type` (etiqueta) o null,
  `operational_status`, `carrier` o null, `usual_driver {id, name} | null`, y `documents`.
- **Empresa:** `id`, `business_name`, `tax_id`, `operational_status`, `shippers [{id, name}]` (ACTIVE),
  `active_drivers` y `active_assets` (conteos con `driver_assignments` y `asset_assignments` ACTIVE),
  `primary_contact {name, phone} | null`, y `documents`.

**Tests (fallan primero):** cada test crea su propia entidad en la transacción revertida.
- un conductor con dos registros, uno vencido y otro al día, devuelve los conteos y `attention` con el vencido;
- sin contacto devuelve `phone` en null;
- un id inexistente da 404 y un id mal formado da 422;
- una empresa devuelve `active_drivers` igual a sus asignaciones activas;
- el equipo devuelve `usual_driver`.

### Task 2: Ids en las filas de `cierre-viajes`

**Files:** modify `app/services/cierre_viajes.py` (SQL_BASE, SQL_GRUPOS_CIERRE y SQL_CON_MOTIVO) y
`app/routers/trips.py` (el dict de cada fila). Test en `tests/test_incomplete_assignment_integration.py` o en un
archivo nuevo, `tests/test_closure_trip_ids_integration.py`.

**Produces:** cada fila agrega `carrier_id`, `driver_id` y `tractor_asset_id` (`vfr.resolved_*`, en texto o null).

**Test:** un viaje con un vínculo completo devuelve los tres ids; sin vínculo, devuelve los tres en null.

### Task 3: Primitivas de `components/ui`

**Files (create):**
- `components/ui/Section.tsx`: título de 13 px, semibold, gris, en minúscula, con el contenido debajo y un divisor
  superior.
- `components/ui/KeyValueList.tsx`: grilla de 2 columnas (rótulo gris de 13 px y valor), filas `{label, value}`.
- `components/ui/DocumentStatusBar.tsx`: la barra apilada (al día, por vencer, vencido), la leyenda con conteos y
  la lista de los que hay que atender. Sin documentos dice "Sin requisitos configurados".
- `components/ui/StatusChip.tsx`: un chip para cinco señales (normal, atención, urgente, resuelto, informativo),
  con tokens.

**Modify:** `components/ui/PanelLateral.tsx` agrega la prop `overlay?: 'dim' | 'none'`, con `'dim'` por defecto
para no cambiar a quien ya lo usa. Con `'none'` no hay fondo oscuro ni `aria-modal`, el clic fuera igual lo
cierra, y el ancho es 420 px en escritorio y pantalla completa en el teléfono.

**Tests:** vitest de cada primitiva:
- `DocumentStatusBar` con ceros y sin requisitos;
- los anchos de la barra proporcionales a los conteos;
- `PanelLateral` con `overlay="none"`: sin fondo oscuro, Esc cierra y el foco vuelve al elemento anterior.

### Task 4: Direcciones canónicas y vuelta al Cierre

**Files:**
- create `lib/navegacion/directory.ts`: `carrierHref(id, returnTo?)`, `driverHref(id, returnTo?)` y
  `assetHref(id, returnTo?)`;
- create `app/dashboard/drivers/[id]/page.tsx` y `app/dashboard/assets/[id]/page.tsx`;
- modify `components/dashboard/ResultadosDelDirectorio.tsx` (usar los helpers) y
  `app/dashboard/carriers/[id]/page.tsx` (el "← Volver al Cierre").

**Comportamiento de la ruta canónica:**
- pide el `summary`; con empresa, hace `router.replace` a `/dashboard/carriers/{carrier}?tab=conductores&driver={id}`
  (o `tab=equipos&asset=`) y conserva el `?next=`;
- sin empresa, muestra `Estado` "Este conductor no está asignado a ninguna empresa" con un enlace al Directorio;
- 404 muestra "No se encontró en el directorio".

**Tests:** helpers (rutas y `?next=` codificado); páginas (redirige; sin empresa; 404); ficha de empresa ("Volver
al Cierre" solo con un `?next=` válido, validado con `destinoSeguro`).

### Task 5: `EntityQuickView`

**Files:**
- create `lib/api/entitySummary.ts` (tipos y las 3 llamadas);
- create `components/dashboard/EntityQuickView.tsx`;
- create `lib/quickView.ts` con el tipo `QuickViewTarget = {kind: 'carrier'|'driver'|'asset', id: string,
  label: string}` y `useQuickView()`, que guarda la pila de entidades para "← Volver".

**Interfaces:** `<EntityQuickView target={…} onNavigate={t => …} onBack={…} canGoBack onClose returnTo />`. La
variante sale de `target.kind`.
- React Query con la clave `['entity-summary', kind, id]`.
- El encabezado se dibuja con `target.label` mientras carga.
- Contenido según la HU §4-6; el teléfono va como `<a href="tel:…">`.
- Los nombres internos llaman a `onNavigate`.
- "Abrir ficha completa" usa `carrierHref`, `driverHref` o `assetHref` con `returnTo`.

**Tests:**
- cargando: encabezado con el label y esqueletos;
- datos de cada variante;
- `tel:`;
- sin teléfono, "Sin teléfono";
- error con "Reintentar";
- de baja;
- navegar a la empresa y volver;
- el enlace de la ficha completa.

### Task 6: Enlaces en las filas del Cierre

**Files:** modify `components/dashboard/sections/PasoViajesSection.tsx`,
`components/dashboard/sections/FlotaDelDiaSection.tsx` y `app/dashboard/operations/closures/page.tsx` (es la dueña
del estado `useQuickView` y del `returnTo = urlDeEsteCierre()`); `lib/types.ts` (ids opcionales en
`ViajeDelCierre`).

**Behavior:**
- la celda con id y permiso muestra un botón que se ve como enlace (`--accion`, `aria-label` "Ver conductor X") y
  abre la vista rápida;
- sin id, texto con "no está en el directorio" (solo conductor y empresa: la patente sin activo muestra su texto);
- en Flota, el conductor y el tracto de una fila fusionada abren cada uno su entidad;
- la fila de origen se marca mientras el panel está abierto.

**Tests:** las filas con id muestran el botón y sin id el texto; el clic llama `onOpenQuickView` con `{kind, id,
label}`; sin permiso no hay botón.

### Task 7: Despliegue y verificación visual

1. Tests del área backend y vitest completo; `npx tsc --noEmit`; `npm run build`.
2. Push a dev y esperar los dos deploys.
3. Playwright en dev, en el Cierre del 08/10:
   - abrir conductor, equipo y empresa;
   - navegar dentro del panel y volver;
   - "Abrir ficha completa" y "Volver al Cierre";
   - Esc devuelve el foco.
4. **Capturas lado a lado** con la maqueta, a 1440 y a 390 px. Corregir las diferencias hasta que coincidan y
   mostrarle al usuario las dos.
5. `AGENTLOG.md` y siguiente paso (pasada visual del detalle del viaje y de Configuración con las mismas
   primitivas).
