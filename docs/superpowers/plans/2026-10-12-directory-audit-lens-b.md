# Auditoría del Directorio — Lente B: dominio y datos

**Alcance:** plan `2026-10-12-directory-audit.md`, Lente B. Solo lectura de punta a punta: código del repo,
espejo local de Mage (`.mage-agent/local_sync`, no se tocó Mage) y la base real con `SELECT` en transacción
`readonly`, `statement_timeout` de 20-30 s, conexión con `credenciales_integracion()`. Ninguna consulta tardó más
de 0,32 s. Se reportan solo conteos; ningún nombre, RUT, patente, teléfono ni correo.

**Medición:** 11/10/2026, 21:47-21:52 hora de Chile (`hoy_chile()` = 2026-10-11, domingo: 23 viajes del día).
Las cifras de "hoy" son de un domingo; las de ventana usan 14 días (`planning_date`) o los días abiertos del
Cierre (38 períodos OPEN, 12 con líneas en los últimos 45 días).

**Lo que hay en la base (para leer las cifras):** 251 empresas (36 ACTIVE, 9 INACTIVE, 205 LEGACY_INACTIVE,
1 ONBOARDING), 101 conductores (93 ACTIVE, 8 INACTIVE), 139 equipos (136 ACTIVE, 3 INACTIVE). Asignaciones:
`driver_assignments` 91 ACTIVE / 14 INACTIVE, `asset_assignments` 133 / 4, `vehicle_driver_assignments` 68 / 16.

**Precisión sobre conceptos que ya no existen:** no hay columna `is_active` ni `baja_override` en
`carriers`/`drivers`/`assets` (verificado en `information_schema.columns`). El "activo" de una entidad es solo
`operational_status`, y la protección contra la ingesta es `is_manual_override`. La nota de memoria
"is_active → baja_override + operational_status" está desactualizada en lo de `baja_override`.

---

## 1. Inventario de definiciones

Canónicas (las que la síntesis debería tomar como referencia):
- **Documento:** `document_state_sql` + `in_scope_sql` + `ultima_empresa_sql`,
  `monitor-app/backend/api/app/services/vencimientos.py:379`, `:400`, `:416`.
- **Viaje abierto/asignado:** `app.is_trip_open(status)` y `app.is_trip_assigned(status, fleet, trip_id)`
  (funciones de la base; las llama dbt y el trigger `app.sync_trip_assignment`).
- **Flota del viaje:** `app.trip_fleet_links` escrita por `app.resolve_trip_fleet()` (capas: RUT TMS → nombre →
  nombre parcial → padrón `vehicle_driver_assignments`) o por la persona (`link_source='manual'`, terminal), leída
  por `app.v_trip_fleet_resolution`.

### 1.1 Empresa activa

| Definición | Dónde | Superficies | En qué difiere |
|---|---|---|---|
| `carriers.operational_status = 'ACTIVE'` | columna; filtro en `carriers.py:116` (`list_carriers`) | Directorio (pestañas), vista rápida | Referencia. "Inactivas" agrupa `INACTIVE` + `LEGACY_INACTIVE`; `ONBOARDING` es pestaña aparte |
| `es_activa = operational_status ∈ FUNNEL_ACTIVE_STATUSES OR unclassified > 0` | `compliance.py:222` | Certificación › embudo | Una empresa inactiva con documentos sin clasificar cuenta como "activa"; ONBOARDING entra |
| `operational_status = 'ACTIVE'` sin cascada | `in_scope_sql`, `TRACTOREO_ROSTER_CTE` (`driver_roster.py`), `SQL_ESTADO_TRACTOS` (`cierre_lineas.py:117`), `_SQL_DIRECTORIO` (`carriers.py:359`) | Pendientes, Cierre, tira del Directorio | Coinciden en la empresa, pero **ninguna baja de empresa cierra las asignaciones de su flota** (ver B-2) |
| `resolve_trip_fleet()` no filtra estado de empresa | función `app.resolve_trip_fleet` | Monitor | Un viaje puede resolverse a una empresa de baja (0 casos en 14 días) |

### 1.2 Conductor / equipo activo

| Definición | Dónde | Superficies | En qué difiere |
|---|---|---|---|
| `drivers/assets.operational_status = 'ACTIVE'` | columna | Fichas, `EntityQuickView.tsx:123` (`isActive`) | Referencia |
| "Flota de la empresa" = asignación `ACTIVE`, **sin** mirar el estado de la entidad | `_SQL_DIRECTORIO` `carriers.py:359` (tira: conductores, tractos, ramplas); `carrier_summary` `entity_summary.py:155` (`active_drivers`, `active_assets`); vistas materializadas `app.carrier_driver_roster`/`carrier_asset_roster` | Directorio (tira y pestañas de la ficha), vista rápida de empresa | Cuenta como "activos" a conductores y equipos de baja que conservan la asignación (B-1) |
| Activo + asignación ACTIVE + empresa ACTIVE | `in_scope_sql` (`vencimientos.py:416`), `fleet_driver_gap.py:22`, `TRACTOREO_ROSTER_CTE` | Pendientes, brecha de dotación, Cierre | Referencia para "opera" |
| Búsqueda de conductores para el Monitor | `drivers.py:29` y `:83` | Monitor (TripAssignDialog, fuzzy) | Filtra conductor activo, pero la empresa entra por `LEFT JOIN ... AND c.operational_status='ACTIVE'`: un conductor de empresa de baja aparece **sin empresa** |
| Buscador del Directorio | `carriers.py:407` | Directorio | Muestra la empresa de la asignación aunque esté de baja (correcto como dato, distinto de Monitor) |

### 1.3 Asignado, y a qué empresa

| Definición | Dónde | Superficies | En qué difiere |
|---|---|---|---|
| Empresa vigente = `driver_assignments`/`asset_assignments` con `status='ACTIVE'` (índice único parcial: una por sujeto) | `get_driver` `drivers.py:143`, `get_asset` `assets.py:29`, `entity_summary.py:74/122`, `compliance.py:400` (`attributed`), `/pending` `resolved` | Directorio, vista rápida, Certificación | Referencia "hoy". **Sin fechas efectivas:** 100% de las filas (ACTIVE e INACTIVE) tienen `end_date` NULL; la app nunca la escribe |
| "Última empresa" = `ORDER BY COALESCE(end_date,'infinity') DESC, start_date DESC, created_at DESC` | `ultima_empresa_sql` `vencimientos.py:400`; `_empresa_que_dejo_sql` `compliance.py:95` | Pendientes (ON_ENTITY_END) | Como `end_date` siempre es NULL, el orden depende de `start_date`, que la transferencia no renueva (B-3) |
| Empresa del viaje = empresa ACTIVE del **tracto** al momento de resolver (`asset_assignments`) | `app.resolve_trip_fleet` | Monitor, Cierre (vía `v_trip_fleet_resolution`), Certificación (`viajes` 30 d) | No se re-resuelve cuando el Directorio reasigna el tracto; un vínculo manual de conductor (`assign_driver_bulk` `trips.py:2119`) conserva la empresa del tracto |
| Empresa "propia" del conductor en el viaje = `driver_assignments` ACTIVE de hoy | `v_trip_fleet_resolution.resolved_driver_home_carrier_id`; `_FLEET_MATCH_CASE` `trips.py:605` | Monitor (MISMATCH) | Compara el viaje (fecha X) contra la asignación de hoy |
| Cierre: MISMATCH si algún viaje del día tiene empresa nula o distinta de `home_carrier_id` (asignación de **hoy**) | `SQL_ESTADO_CONDUCTORES` `cierre_lineas.py:86`; detalle `daily_closures.py:100-112` | Cierre | Un día abierto pasado se juzga con la asignación de hoy (B-3) |
| Cierre: pantalla filtra por roster **vivo**; firma cuenta todas las líneas | `daily_closures.py:75` y `:170` (`JOIN active_roster`) vs `cierre_lineas.py:603` | Cierre | Líneas de quien salió del roster quedan ocultas pero bloquean la firma (B-4) |
| Conductor habitual del tracto = `vehicle_driver_assignments` ACTIVE | `assets.py:166`, `resolve_trip_fleet` capa 5, `SQL_ESTADO_TRACTOS` (origen), `_SQL_SINCRONIZAR_TRACTOS` (motivo heredado), `driver_summary` (tracto habitual: el más reciente) | Directorio (ficha de equipo), Monitor, Cierre, vista rápida | No valida que conductor y tracto sean de la misma empresa (hoy 0 casos) |
| Roster del Cierre (conductores) = activo + asignación ACTIVE a empresa ACTIVE que tiene ≥1 tracto ACTIVE TRACTOREO | `TRACTOREO_ROSTER_CTE` `driver_roster.py` | Cierre, reporte de estado | El tipo de operación del conductor se hereda de la **empresa**, no de su tracto (B-9) |
| Roster del Cierre (tractos) = TRACTOCAMION activo, asignado a empresa ACTIVE (todos los tipos) | `SQL_ESTADO_TRACTOS` `cierre_lineas.py:117` | Cierre de equipos | `requires_reason` falso solo para Equipo Completo puro |

### 1.4 Habilitado para operar (estado de documentos)

| Definición | Dónde | Superficies | En qué difiere del canon (`document_state_sql` + `in_scope_sql`) |
|---|---|---|---|
| `compliance_health` = `pendiente_predicate` sobre docs **propios** LEGAL_MANDATORY | `_CARRIER_LIST_AGG` `carriers.py:61` | Directorio › Empresas (lista, tiles PENDING/OK) | Solo obligatorios y solo los de la empresa; **sin alcance** (empresas de baja en rojo) |
| Igual, por conductor/equipo | `_pending_mandatory_join` `carriers.py:37` | Directorio › ficha de empresa (pestañas Conductores/Equipos) | Sin alcance: marca PENDING a sujetos de baja o colgados de empresa de baja |
| `mandatoryProblems` = LM y (`is_expired` o `status ∈ MISSING/EXPIRED/REJECTED`) | `frontend/app/dashboard/carriers/[id]/page.tsx:375`, `components/dashboard/TransporterAlertBanner.tsx:25` | Directorio › ficha de empresa | Cálculo en el cliente: suma REJECTED, no suma "por vencer", ignora `exigible_on` |
| `nodeState` (ok/overdue/pending) | `components/dashboard/DocumentChecklist.tsx:70` | Directorio › checklist | Por `status` + `is_expired`; ignora exigibilidad y "por vencer" |
| `_DOCUMENTS_SQL` (expired/expiring/missing/ok/NULL) | `entity_summary.py:24` | Vista rápida (Cierre) | "missing" solo si `status='MISSING'`; un pendiente con otro status quedaría en NULL (no se cuenta) |
| Embudo: `attributed` (docs propios + de conductores/equipos con asignación ACTIVE + finiquitos por `_empresa_que_dejo_sql`) con `pendiente_predicate` | `compliance.py:400` | Certificación › Empresas (embudo, "N de M") | Atribuye documentos de conductores/equipos **de baja**; sin `in_scope_sql` |
| `/pending` con `state` | `compliance.py:497` | Certificación › Pendientes | **Canon** |
| `_compliance_alert_lateral` (LM + `pendiente_predicate`, crítico por código) | `trips.py:620` | Monitor (badges), Cierre (sugerencia de motivo) | Sin alcance; un viaje con conductor de baja igual muestra su semáforo |
| `driver_compliance_status`/`asset_compliance_status` (vistas materializadas: total y última actualización) | `get_driver`/`get_asset` | Fichas | No calculan estado; se desfasan (B-6) |

### 1.5 Origen habitual y tipo de operación

| Concepto | Definición | Dónde | Superficies | Observación |
|---|---|---|---|---|
| Origen habitual del conductor | `drivers.home_location_id`, declarado; trigger `drivers_home_location_es_un_cd` | `patch_driver` `drivers.py:321`; sugerencia (propone, no escribe) `drivers.py:192` | Directorio, vista rápida, Cierre (congelado en `closure_lines.home_location_id`) | Una sola fuente. Correcto |
| Origen habitual del tracto | heredado del conductor habitual (`vehicle_driver_assignments` ACTIVE) | `SQL_ESTADO_TRACTOS` `cierre_lineas.py:117` | Cierre de equipos | Depende de dos datos del Directorio (habitual + origen del conductor) |
| Tipo de operación del equipo | `assets.webcarga_operation_type_id` | `patch_asset` `assets.py:103`; Mage `load_assets_04` | Directorio, Cierre, Pendientes | `PATCH` usa `COALESCE`: no se puede **quitar** el tipo |
| Tipo de operación de la empresa | derivado: `public.carrier_management_types()` (embudo), `carrier_operation_types` CTE (`compliance.py:580`, `/pending`), "≥1 tracto TRACTOREO" (`TRACTOREO_ROSTER_CTE`) | tres expresiones | Certificación, Cierre | Tres derivaciones del mismo concepto |
| Tipo de operación del conductor | no existe; se hereda de la empresa | `TRACTOREO_ROSTER_CTE` | Cierre | Ver B-9 |

### 1.6 Viaje abierto/asignado y su dependencia del Directorio

`app.is_trip_open` depende solo del estado del viaje. `app.is_trip_assigned` mira patentes y nombre/RUT del TMS
o un vínculo con `tractor_asset_id`/`trailer_asset_id`/`driver_id`, **sin** mirar si esa entidad está activa o
asignada a una empresa: es una decisión de diseño (09/10, "si tiene patente y/o conductor califica como
asignado"). El trigger `app.sync_trip_assignment` (en `trip_fleet_links`) la recalcula al cambiar un vínculo,
pero un cambio en el Directorio (baja, transferencia) **no** dispara ningún recálculo del viaje ni del vínculo.
Medido hoy: 0 viajes del día con `is_assigned` desfasado.

---

## 2. Divergencias medidas

| # | Qué se compara | Resultado | Medido |
|---|---|---|---|
| D1 | Tira del Directorio "conductores" (asignación ACTIVE a empresa activa) vs conductores **activos** con esa asignación | **84 vs 78** (6 de baja contados) | 11/10 21:47 |
| D2 | Tira "tractos" vs tractos activos / "ramplas" vs activas | **86 vs 84** / 38 vs 38 | 11/10 21:47 |
| D3 | Vista rápida de empresa (`active_drivers`/`active_assets`) vs solo entidades activas | **4 empresas** con conteo de conductores distinto, **3** con equipos | 11/10 21:52 |
| D4 | Flota con asignación ACTIVE a empresa **INACTIVE** | **7 conductores** (activos) y **9 equipos** (8 activos, 1 de baja) | 11/10 21:47 |
| D5 | Conductores activos sin asignación ACTIVE (fuera de toda empresa) | **8** | 11/10 21:47 |
| D6 | Conductores activos con empresa activa (Directorio) vs roster del Cierre | 78 vs **41** (37 de empresas sin tractos Tractoreo: por diseño); 2 del roster son de **1 empresa mixta** | 11/10 21:47 |
| D7 | Vista materializada `carrier_driver_roster` vs tablas base | **1** fila desfasada (nombre cambiado sin override: renombre del pre-cierre o del Centralizador); `carrier_asset_roster` 0 | 11/10 21:47 |
| D8 | Semáforo del Directorio (`compliance_health`) vs canon en alcance, por empresa | Activas: 0/36 distintas. **Inactivas/legacy/onboarding: 215/215 en rojo** que el canon deja fuera de alcance | 11/10 21:48 |
| D9 | Directorio (ficha de empresa, pestañas): conductores/equipos marcados PENDING que el canon excluye | **23 conductores** (267 registros) y **17 equipos** (138 registros) | 11/10 21:48 |
| D10 | Certificación (embudo, `attributed`) vs canon (`document_state` en `in_scope`) por empresa activa | **6 de 36** empresas con conteo distinto; **2.306 vs 2.226** pendientes (80 registros de flota de baja) | 11/10 21:48 |
| D11 | `mandatoryProblems` (frontend) vs `pending_mandatory` (backend), registros CARRIER LM | 3.164 vs 3.164, **0 distintos** (latente: no hay REJECTED, ni "por vencer" en empresas, ni exigibilidad diferida) | 11/10 21:48 |
| D12 | Vista rápida (`_DOCUMENTS_SQL`) vs `document_state_sql`, por registro | **0 distintos** en 5.703 registros (latente) | 11/10 21:48 |
| D13 | `pendiente_predicate` vs `document_state ∈ pendientes` | 0 / 0 | 11/10 21:48 |
| D14 | Líneas MISMATCH del Cierre en días abiertos | **6 líneas, 6 días, 1 conductor**; las 6 con viaje a otra empresa y **transferencia posterior** a la fecha | 11/10 21:49 |
| D15 | Líneas de conductor en días abiertos cuyo sujeto ya no está en el roster vivo (ocultas en pantalla) | **29 líneas, 14 conductores; 28 bloquean la firma** (sin motivo o MISMATCH) en **4 días** | 11/10 21:52 |
| D16 | Líneas de tracto en días abiertos fuera del roster de hoy | 36 de 1.044 (la pantalla de equipos no filtra por roster: visibles) | 11/10 21:52 |
| D17 | Viajes de 14 días: empresa del vínculo vs empresa actual del conductor / del tracto | auto: **3** distintas del conductor, 0 del tracto, **16 sin empresa** (de 523); manual: 0 de 34 | 11/10 21:49 |
| D18 | Monitor `fleet_match_status` 14 días | **3 MISMATCH, 16 UNMATCHED** de 576 | 11/10 21:49 |
| D19 | Asignaciones sin fecha de término | **100%** (`end_date` NULL en 105 + 137 + 84 filas, incluidas las INACTIVE) | 11/10 21:47 |
| D20 | Asignación ACTIVE con `start_date` anterior a la última decisión manual (posible fila reutilizada por una transferencia) | hasta **5** conductores y **16** equipos | 11/10 21:48 |
| D21 | "Última empresa" ambigua (sin ACTIVE, ≥2 filas) | 2 conductores, 0 equipos (sin empate de `start_date`) | 11/10 21:48 |
| D22 | Origen habitual: roster del Cierre sin origen / pares habituales con conductor sin origen / líneas de tracto de hoy sin origen | **3 de 41** / **28 de 68** / **45 de 84** (42 de 67 sin carga) | 11/10 21:48 |
| D23 | Requisitos `ON_ENTITY_END` o `MONTH_AFTER_START` | solo DRIVER (4 + 2 requisitos), **0 registros** | 11/10 21:48 |
| D24 | Tractos activos en empresa activa sin tipo de operación | 0 | 11/10 21:48 |
| D25 | Viajes del día (23): vínculo vs Directorio | 0 divergencias en todo | 11/10 21:48 |

---

## 3. Caminos de escritura

| Campo | Quién escribe (endpoint/proceso) | Permiso | Efectos que dispara | Lo que **no** dispara |
|---|---|---|---|---|
| `carriers.operational_status` | `PATCH /carriers/{id}` (`carriers.py:575`) desde Directorio (`carriers/[id]/page.tsx:230-238`) **y** desde Certificación (`compliance/[carrierId]/page.tsx:538`); Mage `load_carriers_02` (fuerza ACTIVE salvo override); `load_legacy_carriers_09` | `directory.edit` | `record_manual_edit` (override); trigger `trg_refresh_compliance_on_carriers_update` refresca **5** vistas materializadas; `trg_enqueue_closure_recompute_upd` encola el Cierre | No cierra ni avisa sobre las asignaciones de su flota (D4); no re-resuelve viajes |
| `drivers.operational_status`, `full_name` | `PATCH /drivers/{id}` (`drivers.py:321`); pre-cierre `aplicar_correcciones` renombra (`pre_cierre.py:344`, sin override); Mage `load_drivers_03` (ACTIVE + nombre, salvo override) | `directory.edit` / sistema | override (solo PATCH); encola el Cierre | **Ningún refresco** de `carrier_driver_roster` ni `driver_compliance_status` (no hay trigger en `drivers`, D7); no cierra la asignación (D1) |
| `assets.operational_status`, `webcarga_operation_type_id` | `PATCH /assets/{id}` (`assets.py:103`); Mage `load_assets_04` (tipo, salvo override; 103 equipos sin override) | `directory.edit` | override; `trg_refresh_compliance_on_assets_update` (5 vistas); encola el Cierre | No permite quitar el tipo (`COALESCE`); no cierra la asignación |
| `drivers.home_location_id` | `PATCH /drivers/{id}` (Directorio, `DriverDetailPanel`) | `directory.edit` | trigger `drivers_home_location_es_un_cd`; encola el Cierre (la línea copia el origen mientras el día está abierto) | — |
| `driver_assignments` / `asset_assignments` (transferir) | `POST /carriers/{id}/drivers|assets` → `_transferir` (`carriers.py:742`), desde Directorio, Certificación (`compliance/page.tsx:318`, `[carrierId]/page.tsx:1068`) y Monitor (`operations/monitor/page.tsx:749`); Mage `load_driver_assignments_06`/`load_asset_asignments_07` (salvo override); pre-cierre reasigna **tractos** por nombre de empresa del TMS (`pre_cierre.py:296`, salvo override) | `directory.edit` / sistema | override en origen y destino; triggers refrescan 5 vistas y encolan el Cierre | **No escribe `end_date` ni renueva `start_date`** (D19, D20); no re-resuelve `trip_fleet_links` de días abiertos; el Cierre reinterpreta días pasados (D14) |
| Desasignar | `DELETE /carriers/{id}/drivers|assets/{x}` (`carriers.py:813`, `:877`) desde Directorio y Certificación (`[carrierId]/page.tsx:515`) | `directory.delete` | `status='INACTIVE'` + override; refresco + cola | Sin `end_date`; el sujeto sale del roster vivo y sus líneas abiertas quedan ocultas pero bloqueando (D15) |
| `vehicle_driver_assignments` | `POST/DELETE /assets/{id}/driver-assignment` (`assets.py:166`, `:222`); `public.sync_habitual_drivers()` (padrón, salvo override) | `directory.edit` / `directory.delete` | encola el Cierre | La app no escribe `end_date` (el padrón sí); sin refresco de vistas (no hay vista que lo lea); no valida misma empresa |
| `trip_fleet_links` | trigger `trg_trips_resolve_fleet_*` → `resolve_trip_fleet` (en cada INSERT/UPDATE de `app.trips`, dueño: `post_hook` de dbt `models/app/trips.sql`); `assign_fleet_link` / `assign_driver_bulk` / edición de campos (`trips.py:1829`, `:2146`, `:2762-2812`) | `trips.edit_sensitive` | `sync_trip_assignment` (is_assigned), cola del Cierre | Cambios del Directorio no re-disparan la resolución; manual es terminal |

Notas sobre triggers: los de `app.trips` los recrea el `post_hook` de dbt en cada corrida (memoria
"post_hooks de dbt son dueños"); los de `public.*` viven en migraciones. No hay `pg_cron`: las vistas
materializadas solo se refrescan por trigger, así que su frescura depende de que ocurra **otra** escritura.

---

## 4. Hallazgos

**B-1 — "Activo" en la flota de una empresa cuenta a conductores y equipos de baja.** *Confunde.*
Evidencia: D1 (84 vs 78), D2 (86 vs 84), D3 (4 y 3 empresas); `_SQL_DIRECTORIO` `carriers.py:359`,
`carrier_summary` `entity_summary.py:155`, `carrier_driver_roster` (filtra solo `da.status`).
Efecto: la tira del Directorio y la vista rápida del Cierre dicen "N conductores" y el Cierre ve N-6; la
pestaña de la empresa los lista (con chip de baja, si la vista está fresca).
Causa raíz: dar de baja una entidad (`PATCH operational_status`) no toca su asignación, y cada lector decide si
mira el estado de la entidad. Hay dos conceptos ("pertenece a" y "opera") sin nombre propio.

**B-2 — Dar de baja una empresa deja su flota colgada.** *Confunde.*
Evidencia: D4 (7 conductores activos y 9 equipos con asignación ACTIVE a empresa INACTIVE); `patch_carrier`
`carriers.py:575` no cascada ni advierte; `GET /drivers` (`drivers.py:29`) devuelve a esos conductores **sin
empresa** porque filtra la empresa en el `LEFT JOIN`.
Efecto: Directorio los muestra bajo la empresa de baja; Cierre y Pendientes los ignoran; en el Monitor, al
vincularlos a un viaje, aparecen sin empresa y el viaje queda con la empresa del tracto.
Causa raíz: no hay regla de qué pasa con la flota cuando la empresa cae.

**B-3 — Las asignaciones no tienen fechas efectivas; transferir reescribe el pasado.** *Bloquea (por el
Cierre) / confunde.*
Evidencia: D19 (100% `end_date` NULL), D20 (hasta 5 y 16 filas con `start_date` viejo), D14 (6 líneas
MISMATCH en 6 días abiertos, 1 conductor, todas con transferencia posterior a la fecha); `_transferir`
`carriers.py:742` solo cambia `status`; `SQL_ESTADO_CONDUCTORES` `cierre_lineas.py:86` compara contra la
asignación de hoy.
Efecto: al transferir un conductor en el Directorio, sus días abiertos anteriores pasan a "Por regularizar" y
piden atención en días que estaban bien; "Ingresó hace N días" de Pendientes y `MONTH_AFTER_START` leen un
`start_date` que no es la fecha de ingreso a la empresa actual; "la última empresa" (finiquito) depende del
`start_date`.
Causa raíz: el modelo guarda el estado presente, no el intervalo de validez, y tres consumidores necesitan el
intervalo.

**B-4 — Líneas del Cierre ocultas que bloquean la firma.** *Bloquea.*
Evidencia: D15 (29 líneas de 14 conductores fuera del roster vivo; **28 bloquean** en 4 días abiertos). La
pantalla hace `JOIN active_roster` (`daily_closures.py:75`, `:170`); la firma cuenta todas las líneas
(`cierre_lineas.py:603`); el recálculo hace upsert del roster y **nunca borra** líneas de quien salió.
Efecto: al firmar, el sistema dice "N conductor(es) sin resolver" que la tabla no muestra; la única salida es
forzar con `closures.override`.
Causa raíz: salir del roster (baja, transferencia, empresa de baja, empresa sin tractos Tractoreo) es una
escritura del Directorio que el Cierre interpreta en dos lugares con dos reglas.

**B-5 — Tres respuestas a "¿tiene pendientes?" para la misma empresa.** *Confunde.*
Evidencia: D8 (215 empresas no activas en rojo en el Directorio, fuera de alcance para el canon), D9 (23
conductores y 17 equipos PENDING en las pestañas de la empresa, fuera de alcance), D10 (embudo de Certificación
cuenta 80 pendientes de flota de baja; 6 de 36 empresas activas con cifra distinta al canon). Definiciones:
`_CARRIER_LIST_AGG` (propios, solo LM), `attributed` (propios + flota, todos los niveles, sin alcance),
`/pending?state` (canon).
Efecto: para la misma empresa, el Directorio cuenta solo sus obligatorios propios, Certificación suma los de su
flota (incluida la de baja) y Pendientes solo lo que está en alcance: tres cifras distintas sin explicación
visible. Un conductor de baja aparece en rojo en la ficha de la empresa a la que sigue asignado.
Causa raíz: el alcance (`in_scope_sql`) se agregó solo a `/pending`; los demás lectores comparten el vocabulario
(`pendiente_predicate`) pero no el universo.

**B-6 — La lista de la empresa lee vistas materializadas que no se refrescan al editar un conductor.**
*Confunde.*
Evidencia: D7 (1 fila con nombre viejo hoy); no hay trigger en `public.drivers` que llame a
`refresh_carrier_view()`; `list_carrier_drivers` (`carriers.py:710`) lee `operational_status` y `full_name` de
`app.carrier_driver_roster`.
Efecto: dar de baja o renombrar a un conductor desde su panel no cambia la pestaña Conductores de la empresa hasta
que otra escritura (un documento, una asignación) refresque las vistas.
Causa raíz: la pantalla donde se edita lee una copia; `list_carrier_assets` ya resolvió lo mismo para el tipo de
operación leyendo `public.assets` en vivo, pero no para el estado.

**B-7 — Seis cálculos del estado de documento fuera del canon, hoy coincidentes.** *Costo interno (latente).*
Evidencia: D11, D12 = 0 hoy; definiciones en `carriers/[id]/page.tsx:375`, `TransporterAlertBanner.tsx:25`,
`DocumentChecklist.tsx:70`, `entity_summary.py:24`, `trips.py:620`, `carriers.py:61`. Difieren en REJECTED, "por
vencer", exigibilidad diferida y alcance.
Efecto: el día que exista un REJECTED, un documento de empresa por vencer o un requisito `MONTH_AFTER_START` con
registros, el Directorio, la vista rápida y el Monitor dirán cosas distintas.
Causa raíz: el bloque 3 de la spec de Pendientes (migrar lectores a `document_state_sql`) no se hizo.

**B-8 — `exigible_sql` usa `driver_assignments` para `ON_ENTITY_END` de cualquier entidad.** *Costo interno
(latente).*
Evidencia: `vencimientos.py:177-185` (sin rama por `entity_type`); D23: hoy solo hay requisitos de DRIVER.
Efecto: el primer requisito "al término" de un equipo nunca sería exigible.

**B-9 — El tipo de operación se define en el equipo y se deriva tres veces para empresa y conductor.**
*Confunde.*
Evidencia: `carrier_management_types()`, `carrier_operation_types` (`compliance.py:580`) y
`TRACTOREO_ROSTER_CTE`; D6: 2 conductores del roster del Cierre son de 1 empresa mixta; `patch_asset` no
permite quitar el tipo; 103 equipos con tipo sin override los puede reescribir `load_assets_04`.
Efecto: un conductor de una empresa mixta entra al Cierre de Tractoreo aunque maneje Equipo Completo; la
etiqueta de la empresa en Certificación y en Pendientes sale de expresiones distintas.

**B-10 — La empresa del viaje se fija al resolver y no sigue al Directorio.** *Confunde (bajo volumen).*
Evidencia: D17 (3 vínculos auto con empresa distinta a la del conductor, 16 sin empresa en 14 días), D18 (3
MISMATCH, 16 UNMATCHED en el Monitor); `resolve_trip_fleet` toma la empresa del tracto y solo corre cuando
cambia `app.trips`; `assign_driver_bulk` conserva la empresa del tracto.
Efecto: corregir la empresa de un tracto en el Directorio no corrige el viaje hasta la siguiente actualización
del TMS; un viaje manual mantiene una empresa que no es la del conductor.

**B-11 — El origen habitual del tracto depende de dos datos del Directorio que suelen faltar.** *Confunde.*
Evidencia: D22 (45 de 84 líneas de tracto de hoy sin origen; 28 de 68 pares habituales con conductor sin
origen; 3 de 41 conductores del roster sin origen). `SQL_ESTADO_TRACTOS` hereda el origen del conductor
habitual.
Efecto: la mitad de los tractos del Cierre no tienen origen para medir asistencia; la falta se arregla en el
conductor, no en el tracto, y la pantalla del tracto no lo dice.

**B-12 — Cuatro escritores de asignaciones con reglas distintas.** *Costo interno.*
Evidencia: Directorio (`_transferir`), Certificación y Monitor (mismo endpoint), pre-cierre (`pre_cierre.py:296`,
reasigna tractos por nombre de empresa del TMS), Mage 06/07 y `sync_habitual_drivers`. Solo el padrón escribe
`end_date`; solo el Directorio marca override en origen y destino; el pre-cierre renombra conductores sin
override (fuente del D7).
Efecto: una corrección automática del Cierre cambia el Directorio sin que la persona lo vea allí (queda en
`audit_log` con `source='pre_cierre_auto'`).

---

## 5. Fuente de verdad propuesta por campo

| Pregunta | Fuente única propuesta | Quién la escribe | Quién la lee (y debe dejar de derivarla) |
|---|---|---|---|
| ¿La empresa está activa? | `carriers.operational_status` | Directorio (una sola acción "Dar de baja", también desde Certificación) | Todos; la baja debe decidir explícitamente qué pasa con la flota (cerrar asignaciones o advertir) |
| ¿El conductor/equipo está activo? | `drivers/assets.operational_status` | Directorio | Todos |
| ¿A qué empresa pertenece **hoy**? | asignación ACTIVE (una por sujeto, ya garantizado por índice) | Directorio (transferir/desvincular); Centralizador y pre-cierre solo sin override | Directorio, vista rápida, Certificación |
| ¿A qué empresa pertenecía **el día X**? | intervalo `[start_date, end_date)` de la asignación, escrito siempre al transferir/desvincular | mismo escritor que la fila anterior | Cierre (MISMATCH y roster de días pasados), "última empresa", "ingresó hace N días" |
| ¿Opera (cuenta en la flota)? | una función/vista única: entidad ACTIVE + asignación ACTIVE + empresa ACTIVE (lo que ya hace `in_scope_sql`) | derivado | Tira del Directorio, vista rápida, roster de la empresa, Cierre, Pendientes, búsqueda del Monitor |
| ¿Está habilitado (documentos)? | `document_state_sql` + `in_scope_sql` | derivado | Directorio (lista, pestañas, ficha), Certificación (embudo), vista rápida, Monitor; el cliente no recalcula |
| ¿Está en el Cierre del día X? | `closure_lines` del día (no el roster vivo) | recálculo del Cierre | Pantalla del Cierre y firma con el **mismo** universo |
| Origen habitual | `drivers.home_location_id` (tracto: heredado, mostrado como tal) | Directorio | Cierre, vista rápida |
| Tipo de operación | `assets.webcarga_operation_type_id`; empresa y conductor derivados por **una** función | Directorio / Centralizador sin override | Cierre, Certificación, Pendientes |
| Empresa del viaje | `trip_fleet_links.carrier_id` (manual terminal; auto re-resoluble cuando cambia la asignación del tracto) | resolución + persona | Monitor, Cierre |
| Viaje abierto / asignado | `app.is_trip_open` / `app.is_trip_assigned` (ya únicos) | dbt + trigger | Sin cambio |
