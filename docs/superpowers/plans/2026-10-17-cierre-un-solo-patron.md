# Cierre del día con un solo patrón — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, método del 14/10: sin subagentes,
> un test por criterio visto en rojo antes, humo E2E, un despliegue, revisión final opus). Pasos con checkbox.

**Goal:** que las cuatro pestañas del Cierre elijan, filtren y muestren de una sola forma: un alcance arriba, una barra
de filtros y una tabla de datos del kit, donde recuadros, embudos y chips son puertas al mismo conjunto de filtros.

**Architecture:** una pieza nueva en el kit, `components/ui/tabla/datos/`, construida sobre TanStack Table (headless):
las columnas se declaran una vez por tabla y de esa declaración salen filtro, chip, orden, "Columnas" y recuadros. El
estado de la vista (alcance, filtros, orden, búsqueda) vive en la URL con un solo códec. La preferencia de columnas se
guarda por persona en `app.table_preferences`. El backend agrega el alcance a Viajes y Pendientes y los Nº de viaje al
Reporte; no cambia cómo se calculan `status` ni `category`.

**Tech Stack:** Next.js 16 (App Router), React 19, TanStack Query + **TanStack Table (nuevo)**, `@dnd-kit/core` +
**`@dnd-kit/sortable` (nuevo)**, vitest + Testing Library, FastAPI + asyncpg, pytest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-16-cierre-un-solo-patron-design.md` (D1-D8, §4, criterios C1-C14).
**Maquetas:** `.superpowers/brainstorm/49122-1792178898/content/flota-del-dia.html` y `cierre-alcance-unico.html`.

## Global Constraints

- Sin parches, sin código duplicado, sin Frankenstein: cada pieza existe una vez; lo que se reemplaza se borra en la
  misma tarea con su guarda (spec §6).
- Español neutral, sin voseo; cero emojis (solo `lucide-react`); rutas, claves y nombres nuevos en inglés; etiquetas en
  español desde el glosario (`lib/states.ts`), nunca escritas en un componente.
- Solo tokens del sistema visual; los trinquetes (`lib/ui/sistema.test.ts`, `escala.test.ts`) solo bajan.
- Sin valores de catálogo en el código: el tipo de operación se lee por `code` del catálogo, en un solo helper SQL.
- Una cifra no se muestra mientras carga; ningún recuadro ni chip dice algo distinto de la columna.
- Cambiar `status`/`category` en el backend: fuera de alcance. El PDF del Reporte: fuera de alcance (queda como hoy).
- Migración en la base real solo con ensayo `BEGIN…ROLLBACK` y autorización explícita del usuario.
- Tests de integración contra la copia local (`.superpowers/local-sim`, `TEST_DB_LOCAL_PORT`), nunca contra la real.

## Review Focus

- Un filtro en la URL con un valor que ya no existe ese día (empresa dada de baja, patente de otro alcance): la vista
  abre, el chip se ve con el valor y "0 filas", y se puede quitar (Task 3).
- Dos personas o dos pestañas del navegador cambiando columnas a la vez: gana la última escritura y no se corrompe la
  preferencia; una preferencia con un id de columna que la tabla ya no declara se ignora sin romper (Tasks 1 y 4).
- Un día firmado: los recuadros, filtros y "Columnas" siguen funcionando; las acciones que escriben siguen
  deshabilitadas como hoy (Task 7).
- Un viaje sin tracto en Viajes con alcance Equipo Completo: aparece, marcado "Sin tracto", y su recuadro lo cuenta
  (Tasks 2 y 8).
- Teclado: un chip se quita con Enter/Backspace, el filtro se abre y se navega con flechas, Escape cierra sin perder lo
  tipeado en la barra (Tasks 3 y 4).

---

## Contratos

### Kit — `components/ui/tabla/datos/`
- `columnas.ts`: `type DataColumn<T> = { id: string; header: string; value: (row: T) => string | null;
  render?: (row: T) => ReactNode; filter?: 'values' | 'presence' | false; sortable?: boolean; hideable?: boolean;
  defaultHidden?: boolean }`. `presence` = filtro "tiene / no tiene" (Acción, Comentario). `hideable: false` = la
  columna que identifica la fila.
- `useDataTable<T>(opts: { tableKey: string; rows: T[]; columns: DataColumn<T>[]; search?: (row: T, q: string) =>
  boolean }) → { table, visibleColumns, rows, facetCount(columnId, value) → number, filters, setFilter(columnId, values),
  clearFilters(), q, setQ, sort, setSort }`. Lee y escribe filtros/orden/búsqueda con `lib/tabla/vistaEnUrl.ts`.
  Cifra facetada = filas que pasan todos los filtros menos el de esa columna (y la búsqueda).
- `lib/tabla/vistaEnUrl.ts`: `readView(params, tableKey) → { filters: Record<string, string[]>; q: string;
  sort: { column: string; dir: 'asc' | 'desc' } | null }` y `writeView(params, tableKey, view) → URLSearchParams`.
  Formato: `f.<columnId>=v1,v2` (valores con `encodeURIComponent`), `q`, `sort=<columnId>:<asc|desc>`; un solo
  `tableKey` por pantalla, así que sin prefijo de tabla.
- `DataTable<T>({ table })`: dibuja `<table>` con `CABECERA`, `aria-sort`, embudo en cada columna filtrable.
- `ColumnFilter`: popover en portal con buscador, valores con `facetCount`, multi-selección, "Seleccionar todo",
  "Limpiar"; para `presence`, dos opciones "Tiene" / "No tiene".
- `TableToolbar({ table, searchPlaceholder, actions? })`: buscador, chips (`{header}: {valores} ✕`), "+ Filtro",
  "Limpiar", "Columnas", y `actions` al final.
- `ColumnsMenu`: casillas + arrastre (`@dnd-kit/sortable`), "Restablecer"; `hideable: false` sin casilla.
- `ShortcutTiles({ table, columnId, tiles: { value: string | null; label: string }[] })`: `value: null` = "Todos";
  el marcado es el que coincide con el filtro de `columnId`; la cifra es `facetCount`; reemplaza a `AlertStatTiles` en
  el Cierre.
- `useTablePreferences(tableKey) → { columns: { id: string; hidden: boolean }[] | null; save(columns); reset() }`
  sobre `GET/PUT /me/table-preferences/{tableKey}` (TanStack Query, clave `['table-preferences', tableKey]`).

### Backend
- Migración `20261026090000_table_preferences.sql`: `app.table_preferences (user_id uuid REFERENCES auth.users ON
  DELETE CASCADE, table_key text CHECK (table_key ~ '^[a-z0-9_.-]{1,64}$'), columns jsonb NOT NULL, updated_at
  timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, table_key))`, RLS como `app.filter_groups`.
- `routers/table_preferences.py`: `GET /me/table-preferences/{table_key}` → `{columns: [...]} | 404`;
  `PUT` con `{columns: [{id: str, hidden: bool}]}` (máx. 50, ids `^[a-zA-Z0-9_]{1,40}$`, `extra="forbid"`), upsert;
  `DELETE` (Restablecer). Solo `get_current_user`: es de cada persona.
- `services/alcance_del_cierre.py`: `scope_of_tractor_sql(asset_alias: str) -> str` →
  `CASE wot.code WHEN 'TRACTOREO' THEN 'tractoreo' WHEN 'EQUIPO_COMPLETO' THEN 'equipo_completo' END`, con su JOIN a
  `app.status_taxonomies`. Lo usan `cierre_lineas.py` (reemplaza su CASE de hoy), `/trips/cierre-viajes` y las
  escalaciones de Pendientes. Ningún otro literal de tipo de operación.
- `GET /trips/cierre-viajes`: cada viaje suma `scope: 'tractoreo' | 'equipo_completo' | null` (null = sin tracto).
- Escalaciones de Pendientes: cada aviso suma `scope` (del tracto o del tracto habitual del conductor; `null` en los de
  empresa).
- `GET /status-report`: las filas de Asignados y Segundas vueltas suman `trips: [{id, code}]`.

### Frontend del Cierre
- `lib/navegacion/cierre.ts`: `EstadoDeLaUrlDelCierre` suma `scope: 'tractoreo' | 'equipo_completo'` (default
  `'tractoreo'`); `?trips=` se retira (la sub-pestaña de Viajes pasa a ser un filtro `f.situation=`) y su forma vieja se
  traduce.
- `lib/states.ts`: `CATEGORY_LABEL: Record<CategoriaDeLinea, string>` = Asignado · Sin motivo · Trabajando sin
  asignación · No trabajando · Por regularizar; `SCOPE_LABEL` = Tractoreo · Equipo Completo; "Sin tracto".
- Claves de tabla: `closure.fleet`, `closure.trips`, `closure.pending`, `closure.report.<seccion>`.

## Tareas

Orden: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10. Commit solo con los tests de la tarea en verde; línea del ledger en el
mismo paso.

### Task 1: Preferencias de tabla por persona (backend)
**Files:** Create `backend/supabase/migrations/20261026090000_table_preferences.sql`,
`backend/api/app/routers/table_preferences.py`, `tests/test_table_preferences.py`; Modify `app/main.py` (router).
- [ ] Test rojo: `GET` sin guardar → 404; `PUT` y `GET` devuelven lo guardado; `PUT` dos veces → la segunda gana;
  `DELETE` → 404 después; 422 con `table_key` inválido, ids inválidos, > 50 columnas o campo de más; otra persona no
  ve la preferencia (integración, `conexion_revertida`, con la migración aplicada en la copia local).
- [ ] Implementar migración + router siguiendo `routers/filter_groups.py`. Aplicar la migración en la copia local.
- [ ] pytest del archivo. Commit. (La migración se aplica en la real en la Task 10, con autorización.)

### Task 2: Alcance en Viajes y Pendientes, Nº de viaje en el Reporte (backend)
**Files:** Create `app/services/alcance_del_cierre.py`; Modify `services/cierre_lineas.py`, `routers/trips.py`
(`cierre_viajes`), el servicio de escalaciones de Pendientes, `routers/status_report.py`; Tests
`tests/test_alcance_del_cierre.py`.
- [ ] Test rojo (integración, sujetos creados por el test): un viaje con tracto de tipo TRACTOREO → `scope='tractoreo'`;
  EQUIPO_COMPLETO → `'equipo_completo'`; sin tracto → `null`; una escalación de patente no registrada sin tracto →
  `null`; `recalcular` de `cierre_lineas` da los mismos `requires_reason` que antes en una copia del día de hoy (no
  cambia el cálculo); Asignados y Segundas vueltas traen `trips` con el código de cada viaje; guarda: `'TRACTOREO'` y
  `'EQUIPO_COMPLETO'` aparecen en un solo archivo de `app/` (`alcance_del_cierre.py`).
- [ ] Implementar `scope_of_tractor_sql` y usarlo en los tres lugares.
- [ ] pytest del archivo + `test_cierre_lineas*`, `test_status_report*`, `test_trips*` del área. Commit.

### Task 3: Tabla de datos del kit: motor, URL y filtro de columna
**Files:** Create `components/ui/tabla/datos/{columnas.ts,useDataTable.ts,DataTable.tsx,ColumnFilter.tsx}`,
`lib/tabla/vistaEnUrl.ts` y sus tests; Modify `package.json` (`@tanstack/react-table`).
- [ ] Tests rojos: `vistaEnUrl` ida y vuelta (valores con coma y tildes, orden, `q`, parámetros ajenos se conservan);
  `useDataTable` filtra por varias columnas, `facetCount` excluye el filtro de su propia columna, la búsqueda usa
  `search`; un valor en la URL que no está en las filas deja 0 filas y el filtro sigue listado (Review Focus);
  `ColumnFilter` busca al tipear, muestra la cifra, abre en portal (no lo recorta un `overflow-hidden`), navega con
  flechas y cierra con Escape; `presence` ofrece Tiene / No tiene.
- [ ] Implementar sobre TanStack Table (`getFacetedRowModel`, `getFacetedUniqueValues`, `getFilteredRowModel`,
  `getSortedRowModel`); el dibujo con `CABECERA`, `EncabezadoOrdenable` y `PanelLateral`/portal del kit.
- [ ] vitest de los archivos, `tsc`. Commit.

### Task 4: Barra, chips, "Columnas" y preferencias
**Files:** Create `components/ui/tabla/datos/{TableToolbar.tsx,ColumnsMenu.tsx,useTablePreferences.ts}` + tests;
Modify `package.json` (`@dnd-kit/sortable`), `lib/api/` (cliente de preferencias).
- [ ] Tests rojos: cada filtro activo es un chip `{header}: {valores}` que se quita con clic y con teclado; "+ Filtro"
  elige columna y abre su filtro; "Limpiar" vacía filtros y búsqueda; "Columnas" oculta, muestra y reordena; la
  columna `hideable: false` no tiene casilla; "Restablecer" llama `DELETE` y vuelve al orden declarado; el orden y la
  visibilidad guardados se aplican al montar; un id guardado que la tabla no declara se ignora (Review Focus).
- [ ] Implementar. Commit.

### Task 5: Recuadros-atajo
**Files:** Create `components/ui/tabla/datos/ShortcutTiles.tsx` + test.
- [ ] Test rojo (C1, C3): tocar un recuadro escribe `[value]` en el filtro de `columnId` y aparece el chip; "Todos"
  lo quita; con el filtro puesto desde el embudo, el recuadro que coincide queda marcado; quitar el chip desmarca;
  la cifra es la facetada; ninguna cifra mientras `rows` carga; cada recuadro tiene nombre accesible
  (`"{label}, {n}"`).
- [ ] Implementar. Commit.

### Task 6: El Cierre con el kit y el alcance único
**Files:** Modify `app/dashboard/operations/closures/page.tsx`, `lib/navegacion/cierre.ts` (+ test), `lib/states.ts`
(+ test).
- [ ] Tests rojos (C8, D4): `EncabezadoDePagina` con la fecha como acción, sin tarjeta propia; "Qué se cierra" con
  `SegmentedControl` arriba de las pestañas y el resumen en una línea con palabras del glosario (en Equipo Completo
  sin "sin motivo bloquea la firma"); pestañas con `Tabs` del kit y su número (Viajes = Por resolver del alcance;
  Pendientes = avisos; día firmado = ajustes posteriores, como hoy); `?scope=` en la URL, `?trips=` viejo se traduce;
  el alcance se conserva al cambiar de pestaña.
- [ ] Implementar; Viajes y Pendientes se piden al abrir la página. Commit.

### Task 7: Flota del día sobre la tabla de datos
**Files:** Modify `components/dashboard/sections/FlotaDelDiaSection.tsx` (columnas declaradas; se va el filtrado,
orden y paginación a mano); Delete `components/dashboard/CabeceraDeColumna.tsx` (+ test); Tests en
`FlotaDelDiaSection.test.tsx`.
- [ ] Tests rojos (C2, C4, C7): la columna Estado muestra `CATEGORY_LABEL` de `category` y el filtro ofrece esas cinco
  palabras; recuadros Todos · Asignados · Sin motivo · No trabajando · Por regularizar (Tractoreo) y sin "Por
  regularizar" si el alcance no lo tiene; Generador de carga, Acción y Comentario filtran; el selector de motivo depende
  de la categoría, no de la etiqueta; cambiar de alcance conserva los filtros que aplican y avisa los que quita; un
  día firmado mantiene las acciones deshabilitadas (Review Focus); los grupos ("Otros conductores del día", "Ya no
  están en el roster") son un valor de filtro, no filas de encabezado que aparecen y desaparecen.
- [ ] Implementar; quitar `AlertStatTiles` del Cierre (su uso en `FleetCenterDialog` queda con su razón en el ledger o
  se migra a `ShortcutTiles` si es la misma forma). Guarda: ningún import de `CabeceraDeColumna`. Commit.

### Task 8: Viajes sobre la tabla de datos
**Files:** Modify `components/dashboard/sections/PasoViajesSection.tsx`, `lib/cierre/gruposDeViajes.ts` (+ tests).
- [ ] Tests rojos (C9, C12): recuadros Todos · Por resolver · En seguimiento · Resueltos sobre la columna "Situación";
  el grupo de hoy ("Abandonado por el TMS", "Asignación incompleta"…) es la columna filtrable "Por qué está aquí";
  con alcance Equipo Completo se ven sus viajes y los "Sin tracto" (marcados), con Tractoreo los suyos y los "Sin
  tracto"; "Resolver" no se filtra ni se oculta; el vacío sugiere el recuadro con resultados, como hoy.
- [ ] Implementar; sale el `tablist` hecho a mano y `ChipsDeFiltro` de esta pantalla. Commit.

### Task 9: Pendientes y Reporte con el patrón
**Files:** Modify `components/dashboard/sections/PreCierrePendingSection.tsx`, `StatusReportSection.tsx`,
`reporte/SeccionesDelReporte.tsx`, `reporte/TablaDeAsignados.tsx`, `lib/reporte/exportarReporte.ts` (+ tests).
- [ ] Tests rojos (C9, C13, C14): Pendientes es una tabla con "Tipo de aviso" filtrable, la acción de cada fila igual
  que hoy, el desbalance de dotación como un tipo más, y "Nº viaje" en Conductor sin empresa; el alcance filtra los
  avisos con `scope` (los de empresa, en los dos). Reporte: el selector Tractoreo/Equipo Completo propio se va (manda
  el de arriba); "Cliente" es un chip (su valor sigue yendo a `statusReportApi.get` porque el informe se agrega en el
  servidor; el estado vive en el mismo `vistaEnUrl`); Asignados y Segundas vueltas muestran "Nº viaje" con todos sus
  viajes y enlace; "Descargar" ofrece "Lo que estás viendo (alcance · filtros · N filas)" marcado y "Todo el día"; el
  Excel coincide con la tabla en pantalla (columnas visibles y orden) y su primera fila dice el recorte; "Copiar
  estatus" copia lo que se ve; el PDF no cambia.
- [ ] Implementar. Commit.

### Task 10: Retiro, verificación y despliegue
- [ ] Guardas (C10): ni `CabeceraDeColumna`, ni `role="tablist"` hecho a mano, ni `AlertStatTiles` en el Cierre, ni
  segmentados a mano, ni encabezados en mayúsculas en el Cierre; ninguna lista de columnas escrita dos veces.
- [ ] Humo E2E C11 en la copia local (Flota del día → recuadro → chip → filtro de Empresa tipeando → ocultar y mover una
  columna → recargar → igual) + la matriz por rol.
- [ ] vitest completo, `tsc`, `npm run build`, backend del área en la copia local; trinquetes al número real; capturas
  a 1440 y 390 lado a lado con las maquetas.
- [ ] Revisión final opus y un pase de arreglos.
- [ ] Migración `table_preferences` en la real: ensayo `BEGIN…ROLLBACK`, **autorización del usuario**, aplicar.
- [ ] Push a `dev`, Deploy Frontend y Deploy Monitor API en verde, recorrido en dev con sesión; AGENTLOG.
