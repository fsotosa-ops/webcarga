# Configuración, Parte 1: Configuración liviana (índice único, un patrón, color por significado)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, método del 14/10: sin subagentes,
> un test por criterio visto en rojo antes, revisión final opus). Pasos con checkbox (`- [ ]`).

**Goal:** Configuración con un índice único agrupado por área, un solo patrón de edición (lista + panel lateral) y el
color de estados y vocabularios derivado de su significado; el Monitor deja de pintar con colores libres.

**Architecture:** el registro `DOMINIOS` sigue siendo la fuente de verdad (área → secciones → permiso → panel) y ahora
alimenta un índice lateral y rutas `/settings/[area]/[section]`. Una sola pieza de lista + panel (`SettingsList`) sirve a
todas las secciones vía "fuentes" (adaptadores de datos), construida sobre lo que hoy hace Estados del tablero. El tono
de una columna del tablero entra al glosario (`boardColumnStyle`) y reemplaza `bg_color`/`text_color` en toda la app.
Se expande (dejar de leer/escribir colores) y se contrae en una migración aparte (sin aplicar hasta autorización).

**Tech Stack:** Next.js (App Router), TanStack Query, vitest + Testing Library, FastAPI + asyncpg, pytest, Playwright
(humo en la copia local).

**Spec:** `docs/superpowers/specs/2026-10-16-configuracion-en-tres-partes-design.md` (§3, §4) · **Maquetas:**
`.superpowers/brainstorm/56411-1792100703/content/config-tres-partes.html`, `config-colores.html`

## Global Constraints

- Español neutral, sin voseo; cero emojis (solo `lucide-react`); rutas e identificadores en inglés, etiquetas en
  español.
- Solo tokens del sistema visual; los topes de `lib/ui/sistema.test.ts` y `lib/ui/escala.test.ts` bajan al número real
  en el mismo commit que los baja.
- Sin parches ni código duplicado: cada pieza existe una vez; lo reemplazado se borra en la misma tarea, con su guarda.
- Sin valores de catálogo en el código: el tono se decide por **grupo de columna** (conjunto cerrado de 7, validado en
  backend), nunca por el id o la etiqueta de un estado.
- Cada sección declara su permiso en `PERMISO_DE_SECCION` (front) y `REVISABLES` (back); `test_revisiones.py` falla si
  se separan. Sin permiso: se ve, no se edita (la API responde 403).
- Los cuatro estados de toda pantalla: vacío, a medias, sin permiso, falló.
- Migraciones en la base real solo con autorización explícita, ensayo `BEGIN…ROLLBACK` y verificación de Mage en vivo.

## HU

Como supervisor de un área, quiero encontrar y ajustar lo que me toca en Configuración con un solo índice y un solo modo
de edición, y que los colores de la app signifiquen lo mismo en todas partes.

## Criterios de aceptación (un test por criterio)

| # | Criterio | Test |
|---|---|---|
| P1.1 | El índice muestra solo las áreas y secciones que la persona puede ver; sin `users.manage` no aparece Personas y accesos; quien solo tiene `certification.configure` ve Certificación | `app/dashboard/admin/settings/SettingsIndex.test.tsx` |
| P1.2 | Toda sección es lista + panel: ninguna fila tiene un `input`, `select` ni paleta | `app/dashboard/admin/settings/SettingsList.test.tsx` (+ guarda P1.6b) |
| P1.3 | Sin el permiso de la sección, la lista se ve y el panel no ofrece guardar ni desactivar | `SettingsList.test.tsx` |
| P1.4 | Seguros › Alertas de vencimiento edita `poliza_por_vencer` con `insurance.configure`; Certificación no la ve ni la edita | `tests/test_umbrales_por_area.py` + `ParameterSources.test.tsx` |
| P1.5 | Un estado del tablero se pinta con el tono de su columna en Configuración y en el Monitor; cambiar la columna cambia el tono | `lib/states.board.test.ts` + `components/ui/StatusBadge.test.tsx` |
| P1.6 | Ningún archivo de `app/`, `components/` ni `lib/` lee `bg_color`/`text_color`; la API rechaza colores en escritura (422) | `lib/ui/color-por-significado.test.ts` (guarda) + `tests/test_config_sin_colores.py` |
| P1.7 | Las URL viejas (`/settings/<area>?section=<s>[&estado=…]`) redirigen a `/settings/<area>/<s>` conservando el panel abierto | `app/dashboard/admin/settings/[area]/page.test.tsx` |
| P1.8 | En el teléfono, `/settings` muestra el índice; cada sección tiene "‹ Configuración" | `SettingsIndex.test.tsx` + humo a 390 |
| P1.9 | Humo: Configuración → Motivos de conductor → abrir un motivo → guardar → la lista lo muestra revisado | `scripts/smoke/smoke.spec.ts` |
| P1.10 | Contracción: borra `bg_color`/`text_color` de `app.trip_statuses` y `app.status_taxonomies` y las columnas de color de las dos vistas materializadas, con copia en `audit_log`; no quedan lectores | `tests/test_config_sin_colores.py` (guarda sobre el código) |

## Contratos

### Glosario (`frontend/lib/states.ts`)
- `BoardColumn = 'en_ruta' | 'en_local' | 'retornando' | 'pendiente_cierre_tms' | 'cerrado' | 'problema' | 'otro'`.
- `BOARD_COLUMNS: { id: BoardColumn; label: string }[]` en ese orden (las etiquetas actuales de `GROUP_OPTIONS`:
  "En Ruta", "En Local", "Retornando", "Pendiente de cierre TMS", "Cerrado", "Problema", "Otro"). Reemplaza a
  `GROUP_OPTIONS` (se borra de `shared.tsx`).
- `boardColumnStyle(group: string | null | undefined): StateStyle` → `{ label, tone, icon }`: en_ruta y en_local →
  `action`; retornando y otro → `neutral`; cerrado → `resolved`; problema → `urgent`; pendiente_cierre_tms → `warning`;
  desconocido o nulo → `neutral` con label "Sin columna".
- Backend: una sola constante `BOARD_COLUMNS` en `app/schemas/status_taxonomy.py`; `routers/config.py`
  (`VALID_GROUP_IDS`) y `GRUPOS_POR_DOMINIO["OPERATIONAL_STATE"]` la usan (hoy el conjunto está escrito dos veces).

### Color
- `StatusBadge` (`components/ui/StatusBadge.tsx`): resuelve el estado contra `meta.statuses` / `meta.operational_states`
  como hoy, y pinta con `boardColumnStyle(resolved.group)` → `StatusChip` (relleno) o punto con el color del tono
  (variante `punto`). Sin `style`.
- `TripTable`, `TripBoard`, `TripDetailView`, `FilterPopover`, `GestionPanel`: usan `StatusBadge`/`StatusChip`; ningún
  `style={{ backgroundColor }}` con datos del catálogo.
- `OperationTypeBadge` y el subtipo en `CarrierDocumentsWorkspace`: `StatusChip tone="neutral"`.
- Tipos: `bg_color`/`text_color` salen de `TripStatusRow`, `StatusMeta`, `TaxonomyRow` y de los tipos de flota en
  `lib/types.ts` (líneas 948, 1065, 1146, 1443 hoy: `fleet_service_type_bg_color`/`_text_color`).
- API (expandir): `StatusTaxonomyBody`, `StatusTaxonomyPatch` y el patch de estados del tablero (`config.py`, línea ~32)
  con `model_config = ConfigDict(extra="forbid")` y sin campos de color → enviar `bg_color` responde 422. Los `SELECT` de
  `config.py`, `status_taxonomies.py`, `trips.py` (meta), `carriers.py`, `assets.py`, `compliance.py`,
  `equipment_closures.py` y `services/fleet_compliance.py` dejan de devolver colores. El `INSERT` de un vocabulario nuevo
  usa el default de la columna mientras exista.

### Umbrales por área (backend)
- `services/vencimientos.py`: `UMBRALES: dict[str, Umbral]` con `Umbral(permiso, dominio, seccion)`:
  `documento_por_vencer` → `CERTIFICATION_CONFIGURE`, (`certification`, `expiry-alerts`); `poliza_por_vencer` →
  `INSURANCE_CONFIGURE`, (`insurance`, `expiry-alerts`). Constante `POLIZA_POR_VENCER = "poliza_por_vencer"` junto a
  `GLOBAL_ALERT_THRESHOLD`.
- `GET /config/alert-thresholds` devuelve las filas de `UMBRALES` (las dos). `PATCH /config/alert-thresholds/{doc_type}`:
  404 si `doc_type` no está en `UMBRALES`; `exigir(usuario, UMBRALES[doc_type].permiso)`; registra la revisión en su
  dominio/sección. Validación aviso > crítico sin cambios.
- `services/revisiones.py`: nueva fila `Revisable("insurance", "expiry-alerts", …poliza_por_vencer…,
  Permission.INSURANCE_CONFIGURE)`.

### Navegación y rutas
- Rutas: `/dashboard/admin/settings` (índice; en escritorio redirige a la primera sección visible),
  `/dashboard/admin/settings/[area]/[section]` (la sección). `/dashboard/admin/settings/[area]` sin sección redirige a la
  primera sección visible del área; con `?section=` redirige a `/[area]/[section]` conservando los demás parámetros
  (`estado`, `doc`, `item`).
- `dominios.ts`: `Dominio` gana `clave` de área nueva `insurance` (título "Seguros", ícono `Shield`, una sección
  `expiry-alerts`). `PERMISO_DE_SECCION` pasa a clave compuesta `"<area>/<section>"` (dos secciones `expiry-alerts`
  conviven). `puedeVerArea(area, permisos)`: la ve quien tiene el permiso de **alguna** de sus secciones; dentro de un
  área visible se ven todas sus secciones, y las que no son de su permiso quedan en solo lectura (P1.3). Reemplaza a
  `puedeVerDominio` y al campo `Dominio.permiso` (hoy solo lo usa Personas).
- `SettingsIndex.tsx` (reemplaza `NavDominios.tsx` y `PortadaDominios.tsx`): grupos por área, entradas por sección con
  el contador "sin revisar" de `GET /config/inventario` (el que hoy usa la portada); sin cifra mientras carga.
  `aria-current="page"` en la activa. En < md, la ruta raíz muestra el índice a pantalla completa; dentro de una sección,
  un enlace "‹ Configuración".
- `BuscadorConfig` arriba del índice; sus resultados enlazan a `/[area]/[section]?<param>=<abre>`.
- Transitorio declarado (spec D6): Condiciones de documentos, Orígenes y Clientes del TMS **siguen** en el índice con su
  pantalla actual hasta que sus partes (2 y 3) los muevan; no se restilan aquí.

### Lista + panel (`app/dashboard/admin/settings/SettingsList.tsx`)
- `SettingsList<Row>({ source })`: barra de filtros (`SegmentedControl` con conteos: los que la fuente declare + "Sin
  revisar"), tabla del kit (`CABECERA`, filas de solo lectura, chevron), panel `PanelLateral` con el elemento abierto en
  la URL (`?item=<id>`; `push` al abrir, `replace` al cerrar), pie con Guardar (si hay cambios) o "Marcar revisado", y
  Desactivar si la fuente lo permite. Sin permiso (`usePuedeEditarSeccion`): panel de solo lectura, sin pie.
- `SettingsSource<Row>` (interfaz, en `settings-sources.ts`): `clave` (área/sección), `queryKey`, `listar()`,
  `columnas` (encabezado + celda de lectura), `campos` (los del panel: texto, select de grupo, número), `guardar(id,
  cambios)`, `mover?(id, dirección)`, `crear?`, `desactivar?`, `filtros?(rows)`, `etiquetaNuevo?`, `descripcion`.
- Fuentes: `boardStatusSource` (estados del tablero: nombre visible, columna, orden; sin crear ni desactivar),
  `vocabularySource(domain)` (OPERATIONAL_STATE con columna; DRIVER_REASON con "Qué significa"; EQUIPMENT_STATE,
  TRIP_UNASSIGNED_REASON, TRIP_VOID_REASON, FLEET_SERVICE_TYPE, WEBCARGA_OPERATION_TYPE sin grupo), `thresholdSource(
  docType)` (aviso y crítico), `temperatureRangeSource` (tipo de carga, mínimo, máximo; crear y borrar),
  `monitorRulesSource` (cada regla del formulario como fila; guardar envía el formulario completo).
- Se borran: `TaxonomyTab` y `estados-tabs.tsx`, `flota-tabs.tsx`, `umbrales-tabs.tsx`, `estados-tabla.tsx`,
  `EstadoPanel.tsx`, y de `shared.tsx`: `SwatchPicker`, `COLOR_PALETTE`, `SaveRowButton`, `SortArrows`,
  `useRowFeedback`, `useConfigList`, `GROUP_OPTIONS` (lo que quede usado por Condiciones/Orígenes/Clientes se queda con
  su único usuario hasta la Parte 2/3). Sus tests se reemplazan por los de `SettingsList` y las fuentes, portando cada
  comportamiento que valga (nombrado en el commit).

### Personas y Roles
- `usuarios-tab.tsx`: fuera las cuatro tarjetas de cifras y la tarjeta dentro de tarjeta; filtros con
  `SegmentedControl` (Todos · Administran · Activos · Inactivos, con conteos); tabla del kit con `CABECERA`. Invitar y
  editar siguen como hoy (no cambia su flujo).
- `roles-tab.tsx`: encabezados con `CABECERA` (sin `uppercase`).

### Contracción (migración, sin aplicar)
- `backend/supabase/migrations/20261024090000_retire_catalog_colors.sql`: copia en `audit_log` (`entity_type`
  `TRIP_STATUS` / `TAXONOMY`, `field` `retired_colors`, `source` `migration`) de cada `bg_color`/`text_color`; recrea
  `app.carrier_asset_roster` y `app.asset_compliance_status` desde su definición vigente (leída con `pg_get_viewdef` en
  la real) sin `fleet_service_type_bg_color`/`_text_color`, con sus índices, grants y triggers de refresco; `DROP
  COLUMN bg_color, text_color` en `app.trip_statuses` y `app.status_taxonomies`. Re-ejecutable.

## Tareas

Orden: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10. Cada tarea termina con su test en verde y un commit; la línea del ledger
va en el mismo paso.

### Tarea 1 — Columnas del tablero en el glosario (una sola lista)
- [ ] Test rojo `lib/states.board.test.ts`: `boardColumnStyle` da el tono de cada uno de los 7 grupos y `neutral`/"Sin
  columna" para nulo o desconocido; `BOARD_COLUMNS` tiene los 7 ids en orden con sus etiquetas.
- [ ] Test rojo backend `tests/test_columnas_del_tablero.py`: `VALID_GROUP_IDS is BOARD_COLUMNS` y
  `GRUPOS_POR_DOMINIO["OPERATIONAL_STATE"] is BOARD_COLUMNS` (misma constante, no copia).
- [ ] Implementar en `lib/states.ts` y `schemas/status_taxonomy.py`; `config.py` importa la constante. Reemplazar los
  imports de `GROUP_OPTIONS` (`EstadoPanel`, `estados-tabla`, `shared.tsx`) por `BOARD_COLUMNS`.
- [ ] `vitest` de `lib/` y `app/dashboard/admin/settings`; pytest de los dos tests. Commit.

### Tarea 2 — El Monitor y la app pintan por significado (P1.5)
- [ ] Test rojo `components/ui/StatusBadge.test.tsx`: un estado de meta con `group: 'problema'` se pinta con la clase de
  `urgent` en relleno y con el punto del tono en variante `punto`; no hay atributo `style` con color; un estado sin meta
  se pinta neutro.
- [ ] Test rojo de guarda `lib/ui/color-por-significado.test.ts` (P1.6, parte front): recorre `app/`, `components/` y
  `lib/` (excluye tests) y falla si aparece `bg_color`, `text_color` o `_bg_color`/`_text_color`.
- [ ] Reescribir `StatusBadge` sobre `boardColumnStyle` + `StatusChip`; reemplazar los `style` de `TripTable`,
  `TripBoard`, `TripDetailView`, `FilterPopover`, `GestionPanel`, `OperationTypeBadge`, `CarrierDocumentsWorkspace`
  por `StatusBadge`/`StatusChip`; sacar los campos de color de los tipos en `lib/types.ts` y `lib/api/config.ts`.
  La guarda queda en verde salvo por Configuración (Tarea 5 la termina): la guarda lista explícitamente
  `app/dashboard/admin/settings/{estados-tabs,flota-tabs,EstadoPanel,estados-tabla,shared}.tsx` como pendientes y
  falla si la lista crece; la Tarea 5 la vacía.
- [ ] `tsc`; `vitest` de `components/` y `lib/`; trinquete de color crudo bajado al número real. Commit.

### Tarea 3 — La API deja de recibir y devolver colores (expandir; P1.6 parte back)
- [ ] Test rojo `tests/test_config_sin_colores.py::test_escribir_un_color_responde_422` (PATCH estado del tablero y
  PATCH/POST vocabulario con `bg_color` → 422) y `::test_las_lecturas_no_devuelven_colores` (meta de `/trips`,
  `/config/statuses`, `/config/taxonomies`, roster de empresa, equipos y compliance: ninguna clave termina en
  `_color`).
- [ ] `extra="forbid"` y sin campos de color en los tres schemas; quitar colores de los `SELECT` listados en
  Contratos. Ajustar los tests de backend que los fijaban (`test_assets.py` y los de config/taxonomías), nombrándolos.
- [ ] Backend del área (config, taxonomías, trips meta, carriers, assets, compliance) contra la línea base. Commit.

### Tarea 4 — Umbrales por área: Seguros entra (P1.4 back)
- [ ] Test rojo `tests/test_umbrales_por_area.py`: con `insurance.configure` se edita `poliza_por_vencer` y se registra
  la revisión en (`insurance`, `expiry-alerts`); con solo `certification.configure` → 403; `documento_por_vencer` sigue
  exigiendo `certification.configure`; un `doc_type` fuera del registro → 404; `GET` devuelve las dos filas.
- [ ] Implementar `UMBRALES` y `POLIZA_POR_VENCER` en `services/vencimientos.py`, el `PATCH` con `exigir`, la fila de
  `REVISABLES`. `test_revisiones.py` en verde (la sincronía front/back se completa en la Tarea 6).
- [ ] pytest del área. Commit.

### Tarea 5 — `SettingsList` y las fuentes de vocabulario (P1.2, P1.3)
- [ ] Test rojo `SettingsList.test.tsx`: (a) la lista no tiene `input`/`select`/botones de color en filas; (b) clic en
  una fila abre el panel y pone `?item=` en la URL, cerrar lo quita con `replace`; (c) sin permiso, el panel no tiene
  Guardar ni Desactivar; (d) con permiso y sin cambios, el pie ofrece "Marcar revisado"; con cambios, "Guardar";
  (e) los filtros del `SegmentedControl` cuentan desde los datos y "Sin revisar" desde las revisiones; sin cifra en
  vuelo; (f) los cuatro estados: vacío ("No hay … todavía"), cargando, error con reintento.
- [ ] Test rojo `settings-sources.test.ts`: `boardStatusSource` guarda nombre y columna y mueve; `vocabularySource(
  'DRIVER_REASON')` ofrece "Qué significa" con sus dos opciones; `vocabularySource('TRIP_VOID_REASON')` no ofrece grupo;
  ninguna fuente envía colores.
- [ ] Implementar `SettingsList.tsx` sobre lo que hoy hace `estados-tabla.tsx` + `EstadoPanel.tsx` (filtro, URL, orden
  en el panel, revisión) y `settings-sources.ts`. Conectar en `dominios.ts` las secciones de Operaciones (estados ×3,
  motivos ×3) y Flota (×2). Borrar `estados-tabs.tsx`, `flota-tabs.tsx`, `estados-tabla.tsx`, `EstadoPanel.tsx` y lo
  de `shared.tsx` que queda sin usuarios; vaciar la lista de pendientes de la guarda de color.
- [ ] `vitest` de `app/dashboard/admin/settings`, `lib/`; `tsc`; trinquetes al número real. Commit.

### Tarea 6 — Parámetros como lista + panel (P1.4 front)
- [ ] Test rojo `ParameterSources.test.tsx`: `thresholdSource('poliza_por_vencer')` muestra "Póliza por vencer" con
  aviso y crítico y guarda con `PATCH /config/alert-thresholds/poliza_por_vencer`; el panel rechaza crítico ≥ aviso
  antes de enviar; `temperatureRangeSource` crea y borra; `monitorRulesSource` guarda el formulario completo.
- [ ] Implementar las tres fuentes; conectar Certificación › Alertas de vencimiento, Operaciones › Umbrales de alerta y
  Rangos de temperatura, y el área nueva Seguros › Alertas de vencimiento en `dominios.ts` (`PERMISO_DE_SECCION` con
  clave compuesta). `test_revisiones.py` (sincronía) en verde. Borrar `umbrales-tabs.tsx`.
- [ ] `vitest` del área; pytest de revisiones. Commit.

### Tarea 7 — Índice único y rutas (P1.1, P1.7, P1.8)
- [ ] Test rojo `SettingsIndex.test.tsx`: con permisos de Operaciones solo aparecen Operaciones y Flota; con
  `users.manage` aparece Personas; con `insurance.configure` aparece Seguros; la entrada activa tiene
  `aria-current`; los contadores "sin revisar" no muestran "0" mientras cargan; en ancho de teléfono la raíz muestra el
  índice.
- [ ] Test rojo `[area]/page.test.tsx`: `/settings/operations?section=driver-reasons&estado=x` redirige a
  `/settings/operations/driver-reasons?item=x`; `/settings/operations` va a la primera sección visible; un área o
  sección inexistente o sin permiso → 404.
- [ ] Implementar `SettingsIndex.tsx`, `app/dashboard/admin/settings/[area]/[section]/page.tsx`, el layout del módulo
  (índice + sección, "‹ Configuración" en teléfono) y las redirecciones; `BuscadorConfig` enlaza a las rutas nuevas.
  Borrar `NavDominios.tsx`, `PortadaDominios.tsx`, la página de dominio con pestañas y sus tests (portando lo que
  valga). `lib/rutas.test.ts` suma las rutas nuevas.
- [ ] `vitest` del área y `lib/`; `npm run build` (rutas nuevas en el manifiesto). Commit.

### Tarea 8 — Personas y Roles con el kit
- [ ] Test rojo en `usuarios-tab.test.tsx`: los filtros son un `SegmentedControl` con conteos y no hay tarjetas de
  cifras; los encabezados no están en mayúsculas. En `roles-tab.test.tsx`: encabezados con `CABECERA`.
- [ ] Implementar; trinquetes al número real. Commit.

### Tarea 9 — Contracción (P1.10; migración sin aplicar)
- [ ] Leer en la real (solo lectura) `pg_get_viewdef` de `app.carrier_asset_roster` y `app.asset_compliance_status`,
  sus índices, grants y triggers de refresco; verificar Mage en vivo (que ningún bloque lea los colores).
- [ ] Test rojo de guarda en `tests/test_config_sin_colores.py::test_nadie_lee_los_colores`: ningún `.py` de `app/` ni
  `.sql` de migraciones posteriores a la contracción menciona `bg_color`/`text_color`.
- [ ] Escribir la migración (Contratos); aplicarla en la copia local dos veces (re-ejecutable); backend completo contra
  la línea base. Commit (sin aplicar en la real).

### Tarea 10 — Verificación y despliegue
- [ ] `npx vitest run` completo, `npx tsc --noEmit`, `npm run build` (se tocó código compartido: `StatusBadge`, glosario).
- [ ] Humo P1.9 en la copia local; matriz por rol (cada rol ve su índice sin 403).
- [ ] Capturas a 1440 y 390 de: índice, una sección de vocabulario con panel abierto, Estados del tablero, una de
  parámetros, Seguros › Alertas, Personas; y del Monitor (tabla y tablero) con los tonos nuevos; lado a lado con la
  maqueta.
- [ ] Revisión final opus; un pase de arreglos (cada uno RED→GREEN).
- [ ] Push a `dev` (API y frontend en la misma ventana); recorrido en dev con sesión. Pedir autorización para la
  contracción; ensayo `BEGIN…ROLLBACK`; aplicar; re-verificar el Monitor.

## Review Focus

- Un supervisor con un solo permiso de configuración entra a `/settings`: aterriza en su primera sección, no en un 404
  ni en un índice vacío (test en Tarea 7).
- Un enlace viejo guardado con `?section=…&estado=…` abre la misma sección con el mismo elemento (test en Tarea 7).
- Un estado del TMS nuevo que llega sin columna (`group` nulo) se ve neutro con "Sin columna" en el Monitor, sin romper
  (test en Tarea 1 y Tarea 2).
- Guardar un elemento mientras el filtro "Sin revisar" está activo: el elemento sale de la lista pero el panel queda
  abierto con la confirmación, sin saltar a otro (test (b)/(d) en Tarea 5).
- El tablero del Monitor arrastra un viaje a otra columna: el tono del estado cambia con la columna nueva tras guardar
  (cubierto por P1.5 en Tarea 2: el tono se deriva en cada render del grupo resuelto).
