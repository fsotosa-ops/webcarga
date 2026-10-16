# Configuración, Parte 3: Directorio › Clientes (una sola lista de lugares)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, método del 14/10: sin subagentes,
> un test por criterio visto en rojo antes, revisión final opus). Pasos con checkbox (`- [ ]`).

**Goal:** que los clientes tengan su lugar en Directorio (lista y ficha con sus lugares, sus empresas y cómo los llama
cada TMS), y que Orígenes y Clientes del TMS salgan de Configuración sin crear una segunda lista de lugares.

**Architecture:** tres piezas que ya existen pasan a servir en dos lugares cada una, sin copias: `LocationsTable`
(Tarifario y ficha de cliente, con la columna Origen), la tabla de Empresas (lista del Directorio y ficha de cliente,
extraída de `app/dashboard/carriers/page.tsx`) y los vínculos del TMS (vista "sin vincular" de Clientes y ficha de
cliente, salida de `clientes-del-tms.tsx`). La API suma el detalle y la edición de un cliente y filtros por cliente.

**Tech Stack:** Next.js (App Router), TanStack Query, vitest + Testing Library, FastAPI + asyncpg, pytest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-16-configuracion-en-tres-partes-design.md` §6 (revisada el 16/10: sin
"Directorio › Lugares") y §3.

## Global Constraints

- Sin parches ni código duplicado: una pieza, varios usos; lo que se mueve se borra de su lugar viejo en la misma
  tarea, con su guarda. Robusto, escalable, mantenible y legible (pedido del usuario, 16/10).
- Español neutral, sin voseo; cero emojis (solo `lucide-react`); rutas e identificadores en inglés, etiquetas en
  español; solo tokens del sistema visual (los trinquetes solo bajan); sin valores de catálogo en el código.
- Lectura como hoy (`directory.read` para Directorio, `commercial.read` para lugares y nombres del TMS); escritura
  `commercial.edit`. Sin permiso, todo se ve y nada ofrece editar (la API responde 403).
- Los cuatro estados de toda pantalla: vacío, a medias, sin permiso, falló. Ninguna cifra mientras carga.
- Sin migraciones de esquema: no cambia el modelo (`public.shippers`, `public.locations`, `app.tms_client_shippers`,
  `public.carrier_shippers` ya existen).

## HU

Como Supervisor Comercial, quiero ver y ordenar a cada cliente en un solo lugar (sus lugares de carga, las empresas
que lo atienden y cómo lo llama cada TMS), en vez de tenerlo repartido entre Configuración y el Tarifario.

## Criterios de aceptación (un test por criterio)

| # | Criterio | Test |
|---|---|---|
| P3.1 | Directorio › Clientes lista los clientes con nombres del TMS, orígenes, empresas y viajes (30 días); filtros Activos · Inactivos con conteos; vista "Nombres del TMS sin vincular" | `app/dashboard/clients/page.test.tsx` |
| P3.2 | La ficha de un cliente muestra Lugares (la tabla del Tarifario filtrada, con Origen), Empresas (la tabla del Directorio filtrada) y "Cómo lo llaman los TMS" | `app/dashboard/clients/[id]/page.test.tsx` |
| P3.3 | Con `commercial.edit` se edita nombre y estado del cliente, vínculos del TMS y orígenes; sin él, todo se lee (sin botones ni selectores) | `components/directory/ClientProfile.test.tsx` + `components/dashboard/LocationsTable.test.tsx` |
| P3.4 | Cambiar un vínculo ya hecho se confirma antes de escribir; el backend lo audita y mueve sus viajes (comportamiento actual, ahora desde la ficha y la vista "sin vincular") | `components/directory/TmsClientLinks.test.tsx` |
| P3.5 | Renombrar un cliente no saca sus viajes del Monitor (ya cubierto por `test_cliente_del_viaje_integracion`); un nombre repetido (sin importar mayúsculas) responde 409 | `tests/test_shippers.py` |
| P3.6 | El Tarifario filtra Orígenes y marca/desmarca Origen desde la fila | `app/dashboard/pricing/page.test.tsx` |
| P3.7 | Configuración ya no tiene Orígenes ni Clientes del TMS; `/settings/operations/origins` lleva al Tarifario con Orígenes y `/settings/operations/tms-clients` a Clientes con la vista "sin vincular" | `app/dashboard/admin/settings/[area]/[section]/page.test.tsx` |
| P3.8 | Humo: Directorio › Clientes → abrir un cliente → marcar un lugar como Origen → aparece en el Tarifario con el filtro Orígenes | `scripts/smoke/smoke.spec.ts` |

## Contratos

### API (backend)
- `GET /shippers` (commercial.read): además de `id, name, status`, por cliente: `tms_names` (cuántos nombres del TMS
  lo apuntan), `locations` y `origins` (lugares activos de `entity_type='SHIPPER'` y cuántos con `is_origin`),
  `carriers` (`carrier_shippers` activos) y `trips_30d` (`app.trips.shipper_id`, planificados en los últimos 30 días,
  fecha de Chile). Una sola consulta con subconsultas agregadas; los consumidores de hoy (`ClientPicker`, Tarifario)
  siguen leyendo `id, name, status`. Parámetros opcionales `q` y `status`.
- `GET /shippers/{id}` (commercial.read): la fila anterior + `tms` (`[{source_client_id, source_system, source_client,
  trips}]` de `app.tms_client_shippers`). 404 si no existe; id tipado (422 si no es UUID).
- `PATCH /shippers/{id}` (commercial.edit): `name?`, `status?` (`ACTIVE|INACTIVE`), `extra="forbid"`; 409 si el
  nombre choca con otro (índice `shippers_name_ci_key`); `log_change` con `entity_type='SHIPPER'` por campo.
  Desactivar no borra vínculos ni lugares (un cliente inactivo no se ofrece para vincular, como hoy).
- `GET /carriers?shipper_id=<uuid>`: filtra por `carrier_shippers` activos (mismo shape y facetas que hoy).
- `GET /tms-clients?shipper_id=<uuid>` y `?unlinked=true`: filtran la lista de hoy (`_SQL_LISTA`) en SQL; sin
  parámetros, igual que hoy.
- `PATCH /locations/{id}` ya acepta `is_origin` (commercial.edit): sin cambios.

### Frontend
- `lib/api/locations.ts`: `Shipper` suma los conteos; `shippersApi.get(id)`, `shippersApi.patch(id, body)`,
  `ShipperDetail`. `lib/api/carriers.ts`: `list({ shipper_id })`. `tmsClientsApi.list({ shipper_id?, unlinked? })`.
- `lib/navegacion/directory.ts`: `CLIENTS = '/dashboard/clients'`, `clientHref(id, returnTo?)` (mismo patrón que
  `carrierHref`). `lib/rutas.test.ts` suma `clients`.
- Sidebar: Directorio suma `{ href: '/dashboard/clients', label: 'Clientes' }`.
- `components/directory/CarriersTable.tsx`: la tabla que hoy está en `app/dashboard/carriers/page.tsx:254-292`
  (columnas, chips del glosario, enlaces con `returnTo`), con props `{ items, returnTo }`. La página de Empresas pasa a
  usarla; no queda la tabla en la página.
- `components/directory/TmsClientLinks.tsx`: lo que hoy hace `ClientesDelTmsTab` (lista de nombres del TMS con su
  cliente, selector para vincular, confirmación al cambiar un vínculo, aviso de "N viajes") con props
  `{ shipperId?: string; unlinked?: boolean }` y lectura/escritura por `usePermiso('commercial.edit')`. Sin
  `useConfigList`/`useRowFeedback`: TanStack Query + mutación con su error en la fila.
- `components/dashboard/LocationsTable.tsx`: suma la columna **Origen** (marca `is_origin`, editable con
  `commercial.edit`) y `canEdit` (sin permiso: sin lápices, sin guardar, sin interruptores). Las opciones de zona
  dejan de estar escritas en el componente: salen de `meta.operation_types` (`useTripsMeta`), la fuente que ya usa el
  Monitor.
- `app/dashboard/clients/page.tsx`: encabezado + "+ Nuevo cliente" (`shippersApi.create`, que ya existe); barra con
  buscador y `SegmentedControl` (Activos · Inactivos · Nombres del TMS sin vincular, con conteos); tabla del kit
  (`CABECERA`) cuyas filas abren la ficha; la vista "sin vincular" dibuja `TmsClientLinks unlinked`.
- `app/dashboard/clients/[id]/page.tsx` → `components/directory/ClientProfile.tsx`: `ProfileHeader` (nombre, chip de
  estado del glosario, "Ver en el Monitor" con el helper de `lib/navegacion/viaje.ts` que busca en el Historial, ⋯ con
  Editar nombre y Desactivar/Reactivar en `PanelLateral`), pestañas Lugares · Empresas (`?tab=`), y `AsidePanel`
  Detalles + "Cómo lo llaman los TMS" (`TmsClientLinks shipperId`).
- Tarifario (`app/dashboard/pricing/page.tsx`): en "Todos los locales", filtro **Orígenes** (`origin: true`).
- Configuración: fuera las secciones `operations/origins` y `operations/tms-clients` de `dominios.ts`,
  `PERMISO_DE_SECCION` y `secciones`; `MUDADAS` en `dominios.ts` (`'operations/origins' → '/dashboard/pricing?origen=1'`,
  `'operations/tms-clients' → '/dashboard/clients?vista=sin-vincular'`), que la página de sección y la de área usan
  para redirigir. Se borran `origenes.tsx`, `clientes-del-tms.tsx` y sus tests (portando lo que valga) y de
  `shared.tsx` lo que quede sin usuarios.
- `lib/queries/directorio.test.ts`: clasificar las raíces nuevas (`clients`, `client-detail`, `tms-clients`).

## Tareas

Orden: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. Commit solo con los tests de la tarea en verde; línea del ledger en el mismo paso.

### Tarea 1 — API de clientes (P3.5, base de P3.1/P3.2)
- [ ] Test rojo `tests/test_shippers.py`: `GET /shippers` trae los conteos; `GET /shippers/{id}` trae `tms`; `PATCH`
  cambia nombre y estado con `commercial.edit`, 403 sin él, 409 con un nombre que ya existe en otra capitalización,
  422 con un campo de más; un id que no es UUID → 422; integración (`conexion_revertida`): los conteos coinciden con
  datos creados por el test (cliente, dos lugares uno origen, una empresa, un vínculo del TMS, un viaje).
- [ ] Implementar en `routers/shippers.py` (consulta única de conteos; detalle; patch auditado).
- [ ] pytest del archivo y de `test_cliente_del_viaje_integracion.py`. Commit.

### Tarea 2 — Filtros por cliente en empresas y nombres del TMS
- [ ] Test rojo: `GET /carriers?shipper_id=` devuelve solo las empresas con vínculo activo a ese cliente (integración,
  datos del test); `GET /tms-clients?shipper_id=` y `?unlinked=true` filtran; sin parámetros, igual que hoy.
- [ ] Implementar en `routers/carriers.py` y `routers/tms_clients.py`. Commit.

### Tarea 3 — Tabla de Empresas extraída
- [ ] Test rojo `components/directory/CarriersTable.test.tsx`: dibuja las columnas y chips de hoy y enlaza con
  `carrierHref(id, returnTo)`.
- [ ] Extraer la tabla de `app/dashboard/carriers/page.tsx` a `CarriersTable`; la página la usa. Los tests de la página
  siguen en verde sin cambios de comportamiento. Commit.

### Tarea 4 — `LocationsTable` con Origen y solo lectura (P3.3 parte, P3.6 parte)
- [ ] Test rojo `components/dashboard/LocationsTable.test.tsx`: columna Origen; marcar llama a
  `locationsApi.patch(id, { is_origin: true })`; con `canEdit=false` no hay lápices, guardar ni interruptores; las
  zonas del selector salen de `meta.operation_types` (ningún literal `'RM'`/`'Z0'` en el componente: guarda en el test).
- [ ] Implementar; el Tarifario pasa `canEdit={usePermiso('commercial.edit')}`. Commit.

### Tarea 5 — `TmsClientLinks` (P3.4)
- [ ] Test rojo `components/directory/TmsClientLinks.test.tsx`: con `unlinked` lista solo los sin cliente; con
  `shipperId` solo los de ese cliente; vincular uno sin cliente escribe directo; cambiar uno vinculado pide
  confirmación y dice cuántos viajes mueve; sin `commercial.edit` no hay selectores; error de la API en la fila.
- [ ] Implementar portando el comportamiento de `clientes-del-tms.tsx` (sus tests se portan y se borran con él en la
  tarea 8). Commit.

### Tarea 6 — Directorio › Clientes, lista (P3.1)
- [ ] Test rojo `app/dashboard/clients/page.test.tsx`: columnas y conteos; filtros con `SegmentedControl` y cifras de
  la API (sin cifra en vuelo); la vista `?vista=sin-vincular` dibuja `TmsClientLinks unlinked`; "+ Nuevo cliente" solo
  con `commercial.edit`; vacío, cargando y error.
- [ ] Implementar la página, `clientHref`, el ítem del menú (`Sidebar.test.tsx` suma Clientes) y `lib/rutas.test.ts`.
  Commit.

### Tarea 7 — Ficha de cliente (P3.2, P3.3)
- [ ] Test rojo `components/directory/ClientProfile.test.tsx` y `app/dashboard/clients/[id]/page.test.tsx`: encabezado
  con estado y "Ver en el Monitor"; pestaña Lugares = `LocationsTable` con `entity_id` del cliente; pestaña Empresas =
  `CarriersTable` con `shipper_id`; costado con Detalles y `TmsClientLinks shipperId`; editar nombre (409 se muestra en
  el panel) y desactivar/reactivar solo con `commercial.edit`; un id inexistente → estado vacío con volver.
- [ ] Implementar con `ProfileLayout`/`ProfileHeader`/`AsidePanel`/`DetailsBlock`. Commit.

### Tarea 8 — Fuera de Configuración, Tarifario con Orígenes, verificación (P3.6, P3.7, P3.8)
- [ ] Test rojo en `[area]/[section]/page.test.tsx` y `[area]/page.test.tsx`: las dos secciones mudadas redirigen a su
  destino; en `pricing/page.test.tsx`: el filtro Orígenes pide `origin: true`.
- [ ] Quitar las secciones de `dominios.ts`, `secciones.ts` (`PERMISO_DE_SECCION`) y del backend si las nombra
  (`test_revisiones` en verde); `MUDADAS`; borrar `origenes.tsx`, `clientes-del-tms.tsx` y sus tests, y de
  `shared.tsx` lo que quede sin usuarios; filtro Orígenes en el Tarifario; `lib/queries/directorio.test.ts`.
- [ ] Humo P3.8; `vitest` completo, `tsc`, `npm run build`; backend del área; capturas a 1440 y 390 (Clientes,
  vista sin vincular, ficha con sus dos pestañas, Tarifario con Orígenes); trinquetes al número real.
- [ ] Revisión final opus y un pase de arreglos; push a `dev` (sin migraciones); recorrido en dev con sesión.

## Review Focus

- Desactivar un cliente que tiene viajes, lugares y vínculos: se desactiva, nada se borra, deja de ofrecerse para
  vincular y su ficha sigue abriendo (test en Tarea 1 y Tarea 7).
- Un nombre del TMS nuevo que aparece sin cliente: sale en "sin vincular" y en el contador de esa vista (Tarea 5/6).
- Renombrar a un nombre que ya existe con otra capitalización: 409 con el mensaje en el panel, sin perder lo escrito
  (Tarea 1 y Tarea 7).
- Un cliente sin lugares, sin empresas y sin nombres del TMS: cada pestaña dice qué hacer, sin tablas vacías (Tarea 7).
- Quien entra a la ficha sin `commercial.edit` (Operaciones): ve todo y no hay un solo control que la API rechace
  (Tarea 4, 5 y 7).
