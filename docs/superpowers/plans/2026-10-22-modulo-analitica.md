# Módulo Analítica: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una pantalla `/dashboard/analytics` que muestra, filtra, guarda y descarga la BDOT reconstruida
(`analytics.bdot` y `analytics.fleet_daily`). Absorbe la Reportería.

**Architecture:**
- El backend expone un catálogo de columnas declarado una vez y una consulta paginada, filtrada y ordenada en el
  servidor sobre `analytics.*`. Arma el SQL solo desde ese catálogo, con parámetros.
- La descarga Excel sale del servidor y queda auditada.
- Las vistas guardadas viven en una tabla nueva, `app.saved_views`.
- El frontend reusa el kit de tabla (`components/ui/tabla/data`) con un modo servidor nuevo, y lleva el período en
  la URL junto a la vista.
- La Reportería pasa a ser el modo "Tabla dinámica" de Flota por día.

**Tech Stack:** FastAPI + asyncpg, openpyxl; Next.js + TanStack Table + React Query; dbt 1.8 en Mage; Postgres
(Supabase).

**Spec:** `monitor-app/docs/user-stories/20261022/01-hu-analitica.md`. Diseño de datos:
`docs/superpowers/specs/2026-10-21-analitica-modelo-dimensional-design.md`.

## Global Constraints

- **Origen de los datos:** la API lee solo el schema `analytics`, nunca `gold` ni `app` para las filas.
- **SQL:** se arma solo con los ids del catálogo de columnas; todo valor del usuario va como parámetro `$n`.
  Una columna o un orden fuera del catálogo da 422.
- **Datos personales** (`driver_name`, `driver_tax_id`): solo con `analytics.personal_data`, en filas, catálogo,
  filtros y Excel. Sin el permiso, el catálogo no los trae.
- **Permisos:**
  - `analytics.read` (en `READ_ALL`);
  - `analytics.export` (supervisores de las cuatro áreas y admin);
  - `analytics.manage_views` (los mismos);
  - `analytics.personal_data` (`privileged=True`, solo admin; owner por `grants_all`).
- **Período por defecto:** últimos 30 días por fecha de planificación. Páginas de 50, 100 o 200 filas.
- **Excel:** máximo 50.000 filas; si hay más, 413 con el total.
- **Frescura:** "Datos al HH:MM" en hora de Chile, ámbar si tiene más de 2 h.
- **Texto:** español neutral, sin voseo. Cero emojis (lucide-react). Rutas en inglés, etiquetas en español.
  Nombres de base, API y código en inglés.
- **Sistema visual:** solo primitivas de `components/ui`, sin color crudo de Tailwind y nada bajo 11 px.
- **Una cifra derivada no se muestra hasta tener el dato:** nada de `?? 0` en el total ni en las cifras de los
  filtros.
- **Tests de integración:**
  - Corren contra la copia local: `bash -c 'set -a; . .superpowers/local-sim/sim.env; set +a; env -u
    SUPABASE_DB_PASSWORD venv/bin/python -m pytest …'`.
  - Los casos se escriben a mano.
  - Cada regla nueva lleva una mutación revertida que pone el test en rojo.
- **Producción:** las migraciones en la base real van con ensayo con ROLLBACK y autorización explícita del usuario.
- **dbt:** se edita en `.mage-agent/local_sync/dbt/tms`, se prueba con el dbt local
  (`scratchpad/dbtvenv` + perfil a la copia local), se sincroniza con `mcp__mage-agent__sync_local_to_remote` y
  se copia al repo con `monitor-app/analytics/sync-gold-from-mage.sh`.

## Review Focus

1. **Un filtro o un orden con un id inventado en la URL** (`?f.drop_table=x`, `sort=1;--`): 422, nunca SQL
   armado. Test en la Task 4.
2. **Un período al revés o de varios años** (`from > to`, rango de 3 años): 422 con un mensaje claro. El rango
   máximo es 400 días. Test en la Task 4.
3. **Una vista guardada compartida que referencia una columna personal**, abierta por quien no tiene el permiso: la
   vista abre sin esa columna, sin error ni filtración. Test en la Task 6.
4. **Una vista guardada que referencia una columna que ya no existe en el catálogo:** se ignora la columna, la
   vista abre. Tests en las Tasks 6 y 10.
5. **Descarga cuando el modelo está a medio recargar** (la tabla de `analytics` se reemplaza en el minuto 20): la
   consulta no falla. Las tablas se reemplazan de una vez, así que basta un test que haga la descarga dentro de
   una transacción. Test en la Task 5.

---

### Task 1: datos personales en una sola tabla, y clientes del día en Flota por día (dbt)

**Files:**
- Create: `.mage-agent/local_sync/dbt/tms/models/analytics/driver_identity.sql`
- Delete: `.mage-agent/local_sync/dbt/tms/models/analytics/bdot_people.sql`
- Modify: `.mage-agent/local_sync/dbt/tms/models/analytics/schema.yml`
- Modify: `.mage-agent/local_sync/dbt/tms/models/gold/fct_fleet_daily_status.sql`
- Modify: `.mage-agent/local_sync/dbt/tms/models/analytics/fleet_daily.sql`
- Modify: `.mage-agent/local_sync/dbt/tms/models/gold/schema.yml`

**Interfaces:**
- Produces:
  - `analytics.driver_identity(driver_id uuid PK, driver_name text, driver_tax_id text)`, con
    `grants select: ['analytics_personal_reader']`.
  - `analytics.fleet_daily.client_names text[]`: los clientes de los viajes de ese conductor o equipo ese día,
    por nombre del directorio, ordenados. Arreglo vacío si no hubo viaje.
  - `gold.fct_fleet_daily_status.client_ids uuid[]`.

- [ ] **Step 1:** En `fct_fleet_daily_status`, agregar `client_ids`.
  - Es el `array_agg(DISTINCT f.client_id ORDER BY f.client_id)` de `fct_trips`, con
    `f.planning_date = s.business_date` y `f.driver_id = s.subject_id` (DRIVER) o
    `f.tractor_asset_id = s.subject_id` (ASSET).
  - Vale `'{}'` si no hay viaje.
  - Mismo criterio que `client_names` de `_REPORT_SQL` en `routers/daily_closures.py` (viajes del día del
    conductor).
- [ ] **Step 2:** En `fleet_daily`, `client_names` = nombres de `dim_client` de esos ids, ordenados. Crear
  `driver_identity` desde `dim_driver`. Borrar `bdot_people`.
- [ ] **Step 3:** Tests en `schema.yml`:
  - `driver_identity.driver_id` con not_null y unique;
  - test singular `tests/assert_fleet_daily_clients_match_trips.sql` (`tags=['analytics']`): para 200 filas al
    azar, `client_ids` es igual al cálculo directo sobre `fct_trips`.
- [ ] **Step 4:** Correr `dbt build --select snapshot_carriers gold analytics` local. Esperado: todo PASS.
  Verificar con psql que `analytics_reader` NO tiene SELECT en `driver_identity` y `analytics_personal_reader` sí.
- [ ] **Step 5:** Sincronizar con Mage, correr `analytics_gold` (`mcp__mage-agent__run_pipeline`) y verificar en
  la real:
  - `analytics.bdot_people` ya no existe (dbt no borra modelos retirados: `DROP TABLE analytics.bdot_people` con
    autorización del usuario);
  - `driver_identity` tiene tantas filas como `gold.dim_driver`;
  - `fleet_daily.client_names` no es vacío en las filas ASSIGNED.
- [ ] **Step 6:** `monitor-app/analytics/sync-gold-from-mage.sh` y commit
  `feat(analitica): driver_identity y clientes del día en fleet_daily`.

### Task 2: permisos de Analítica

**Files:**
- Modify: `monitor-app/backend/api/app/authz/permissions.py`
- Regenerate: `monitor-app/frontend/lib/authz/permisos.generated.ts` (`backend/api/scripts/generar_permisos_ts.py`)
- Test: `monitor-app/backend/api/tests/test_authz_catalogo.py`

**Interfaces:**
- Produces: `Permission.ANALYTICS_READ = "analytics.read"`, `ANALYTICS_EXPORT = "analytics.export"`,
  `ANALYTICS_MANAGE_VIEWS = "analytics.manage_views"`, `ANALYTICS_PERSONAL_DATA = "analytics.personal_data"`.
  Área `"analytics"`.

- [ ] **Step 1: Test que falla**: `test_permisos_de_analitica`.
  - `ANALYTICS_READ` está en todo rol de sistema.
  - `ANALYTICS_EXPORT` y `ANALYTICS_MANAGE_VIEWS` están exactamente en `admin` y en los cuatro `*_supervisor`.
  - `ANALYTICS_PERSONAL_DATA` está solo en `admin` y es `privileged`.
- [ ] **Step 2:** Correr; esperado FAIL (atributo inexistente).
- [ ] **Step 3:** Agregar los permisos al enum y a `PERMISSION_META`, con descripciones en español:
  - "Ver Analítica y guardar vistas personales";
  - "Descargar Excel de Analítica";
  - "Crear y editar vistas compartidas de Analítica";
  - "Ver y descargar nombre y RUT del conductor en Analítica".

  Agregar `ANALYTICS_READ` a `READ_ALL`. Agregar `_ANALITICA_SUPERVISOR = (P.ANALYTICS_EXPORT,
  P.ANALYTICS_MANAGE_VIEWS)` a los cuatro supervisores, y eso más `P.ANALYTICS_PERSONAL_DATA` a `admin`.
- [ ] **Step 4:** Regenerar el TS. Correr `test_authz_catalogo.py` y `test_permisos_ts_en_sincronia.py`; esperado
  PASS.
- [ ] **Step 5:** Commit `feat(analitica): permisos del módulo`.

### Task 3: catálogo de columnas

**Files:**
- Create: `monitor-app/backend/api/app/services/analytics_columns.py`
- Create: `monitor-app/backend/api/app/routers/analytics.py` (solo `GET /analytics/columns` en esta task)
- Modify: `monitor-app/backend/api/app/main.py` (`include_router`)
- Test: `monitor-app/backend/api/tests/test_analytics_columns.py`

**Interfaces:**
- Produces:
  - `Dataset = Literal["trips", "fleet"]`.
  - `@dataclass(frozen=True) class AnalyticsColumn: id: str; label: str; group: str; type: Literal["text",
    "date", "datetime", "number", "bool", "list"]; sql: str; filter: Literal["values", "none"] = "none";
    personal: bool = False; default_visible: bool = True`.
    `sql` es la expresión sobre el alias `r` (fila) o `p` (driver_identity).
  - `COLUMNS: dict[Dataset, tuple[AnalyticsColumn, ...]]`.
  - `DATE_FIELDS: dict[Dataset, dict[str, str]]`:
    - `trips`: `{"planning": "r.planning_date", "delivered": "r.delivered_date", "signed": "r.signed_business_date"}`;
    - `fleet`: `{"business": "r.business_date"}`.
  - `TABLES = {"trips": "analytics.bdot", "fleet": "analytics.fleet_daily"}`.
  - `def columns_for(dataset: Dataset, *, personal: bool) -> tuple[AnalyticsColumn, ...]`.
  - `GET /api/v1/analytics/columns?dataset=` → `[{id, label, group, type, filter, default_visible}]`. Requiere
    `ANALYTICS_READ`.
- **Contenido del catálogo:**
  - **trips:** todas las columnas de `analytics.bdot` menos `loaded_at` y los ids internos (`client_id`,
    `carrier_id`, `trip_status_id`).
    - Grupos: Fechas, Cliente, Empresa y flota, Lugares, Estado, Cierre.
    - Filtro "values" en `client_name`, `carrier_name`, `operation_type`, `destination_zone`, `trip_status`,
      `unassigned_reason`, `is_assigned`, `source_system`.
  - **fleet:** columnas de `analytics.fleet_daily` más `client_names` (type `list`).
    - Filtro en `subject_type`, `carrier_name`, `category`, `reason`, `home_origin`, `client_names`.
  - **Personales** en los dos: `driver_name` (Conductor) y `driver_tax_id` (RUT del conductor), grupo "Datos
    personales", `sql` sobre `p.`.

- [ ] **Step 1: Tests que fallan:**
  - `test_cada_columna_existe_en_su_tabla` (integración): para cada columna no personal, `SELECT <sql> FROM
    <tabla> r LIMIT 0` funciona.
  - `test_sin_permiso_no_hay_columnas_personales`: `columns_for("trips", personal=False)` no tiene ninguna
    `personal`.
  - `test_ids_unicos_y_seguros`: todos los ids cumplen `^[a-z0-9_]{1,40}$` y no se repiten.
  - `test_el_endpoint_respeta_el_permiso`: con un usuario sin `ANALYTICS_PERSONAL_DATA` no viene `driver_name`;
    con el permiso sí.
- [ ] **Step 2:** Correr; esperado FAIL (módulo inexistente).
- [ ] **Step 3:** Implementar el catálogo y la ruta. La ruta usa `require(Permission.ANALYTICS_READ)` y decide
  `personal` con el set de permisos del usuario (mismo helper que usan otras rutas para leer los permisos
  efectivos).
- [ ] **Step 4:** Correr los tests y `test_toda_ruta_declara_permiso.py`; esperado PASS.
- [ ] **Step 5:** Commit `feat(analitica): catálogo de columnas`.

### Task 4: consulta paginada en el servidor

**Files:**
- Create: `monitor-app/backend/api/app/services/analytics_query.py`
- Modify: `monitor-app/backend/api/app/routers/analytics.py`
- Test: `monitor-app/backend/api/tests/test_analytics_query_integration.py`

**Interfaces:**
- Consumes: Task 3.
- Produces:
  - `@dataclass(frozen=True) class AnalyticsRequest: dataset: Dataset; date_from: date; date_to: date;
    date_field: str; filters: dict[str, list[str]]; q: str; sort: tuple[str, Literal["asc", "desc"]] | None;
    page: int; size: int`.
  - `def parse_request(params: QueryParams) -> AnalyticsRequest`:
    - URL con los nombres del kit: `f.<id>=v1,v2`, `q`, `sort=id:dir`, más `dataset`, `from`, `to`, `date`,
      `page`, `size`;
    - 422 ante un id fuera del catálogo, un `size` fuera de {50, 100, 200} (o hasta 50.000 para la descarga),
      `from > to` o más de 400 días.
  - `def build_select(req: AnalyticsRequest, *, personal: bool, columns: Sequence[str] | None) -> tuple[str,
    list]`: SQL y parámetros.
    - Une `analytics.driver_identity p ON p.driver_id = r.driver_id` solo si `personal` y se pidió una columna
      personal.
    - La búsqueda `q` mira `trip_code`, `tractor_plate` y `carrier_name` en trips, y `license_plate` y
      `carrier_name` en fleet, con `ILIKE` parametrizado.
    - Un filtro `list` usa `&&`.
    - El orden por defecto es `planning_date DESC, trip_code` (trips) y `business_date DESC` (fleet).
  - `async def fetch_page(conn, req, *, personal) -> dict`: devuelve `{rows, total, counts: {col_id: {valor:
    n}}, loaded_at}`.
    - `counts` es facetado: cada columna con filtro cuenta con los demás filtros y sin el suyo, máximo 200
      valores por columna.
    - `loaded_at` es el `max(loaded_at)` de `analytics.bdot` para los dos conjuntos: los reconstruye la misma
      corrida del pipeline.
  - `GET /api/v1/analytics/rows` → lo anterior. Requiere `ANALYTICS_READ`.

- [ ] **Step 1: Tests que fallan.** Integración, creando filas a mano en `analytics.bdot`, `analytics.fleet_daily`
  y `analytics.driver_identity` dentro de `conexion_revertida`; son tablas, se puede insertar.
  - `test_el_periodo_usa_la_fecha_elegida`: un viaje planificado el 01/10 y entregado el 03/10 entra con
    `date=planning&from=10-01&to=10-01` y con `date=delivered&from=10-03&to=10-03`, y no al revés.
  - `test_filtro_y_cifras_facetadas`: con 2 Walmart RM, 1 Walmart Z0 y 1 Sodimac RM, y el filtro `zone=RM`, el
    total es 3, `counts.client_name = {Walmart: 2, Sodimac: 1}` y `counts.destination_zone = {RM: 3, Z0: 1}`.
  - `test_paginacion_y_orden`: 120 filas con `size=50&page=2` dan las filas 51 a 100 en el orden pedido, y el
    total es 120.
  - `test_id_inventado_es_422`: `f.drop_table=x`, `sort=1;--:asc` y `date=otra` dan 422 cada uno (Review Focus 1).
  - `test_periodo_invalido_es_422`: `from > to` y un rango de 401 días dan 422 (Review Focus 2).
  - `test_sin_permiso_no_viaja_el_rut`: con `personal=False` y `driver_tax_id` pedido como columna, la respuesta
    no tiene esa clave en ninguna fila.
  - `test_filtro_de_lista_en_flota`: `f.client_names=Walmart` trae las filas cuyo arreglo contiene Walmart.
- [ ] **Step 2:** Correr; esperado FAIL.
- [ ] **Step 3:** Implementar. Un `COUNT(*) OVER ()` o una consulta de total aparte, a elección; cifras por
  columna con un `GROUP BY` por cada filtro.
- [ ] **Step 4:** Correr; esperado PASS.
- [ ] **Step 5: Mutación.** Quitar la condición `personal` del join a `driver_identity`; el test del RUT queda en
  ROJO. Revertir.
- [ ] **Step 6:** Commit `feat(analitica): consulta paginada en el servidor`.

### Task 5: descarga Excel auditada

**Files:**
- Modify: `monitor-app/backend/api/app/routers/analytics.py`
- Create: `monitor-app/backend/api/app/services/analytics_export.py`
- Test: `monitor-app/backend/api/tests/test_analytics_export_integration.py`

**Interfaces:**
- Consumes: Tasks 3 y 4 (`parse_request`, `build_select`).
- Produces: `GET /api/v1/analytics/export?…&columns=id1,id2`, mismos parámetros que `rows` más las columnas
  visibles en orden.
  - Requiere `ANALYTICS_EXPORT`.
  - Las columnas personales piden además `ANALYTICS_PERSONAL_DATA`; si faltan, 403, no se omiten en silencio.
  - Responde un xlsx (`Content-Disposition: attachment; filename="analitica_<dataset>_<from>_<to>.xlsx"`).
  - Fila 1: `Período <from> a <to> por <fecha> · <filtros en texto> · Datos al <HH:MM>`; fila 2: encabezados
    (etiquetas del catálogo); luego los datos.
  - 413 con `{"total": n}` si pasan 50.000.
  - `def workbook_bytes(header_line: str, columns: Sequence[AnalyticsColumn], rows: Sequence[Mapping]) -> bytes`.
- **Auditoría:** `log_change(conn, actor=user.sub, entity_type="ANALYTICS_EXPORT", entity_id=uuid4(),
  action="export", new_value={"dataset", "from", "to", "date_field", "filters", "q", "columns", "rows",
  "personal"})`, escrita DESPUÉS de armar el archivo y en la misma conexión.

- [ ] **Step 1: Tests que fallan:**
  - `test_la_descarga_trae_lo_que_se_ve`: con 3 filas y 2 columnas pedidas, el xlsx (leído con openpyxl) tiene el
    renglón de encabezado, las etiquetas en el orden pedido y 3 filas de datos.
  - `test_la_descarga_queda_auditada`: tras descargar, `audit_log` tiene 1 fila `ANALYTICS_EXPORT/export` con
    `rows=3` y `personal=false`.
  - `test_columna_personal_sin_permiso_es_403` y `test_sin_analytics_export_es_403`.
  - `test_mas_de_50000_es_413`: con el límite inyectado a 2 por un parámetro del servicio, para no crear 50.000
    filas, 3 filas dan 413 con `total=3` y NO se audita.
  - `test_descarga_dentro_de_transaccion` (Review Focus 5): la descarga corre con la conexión dentro de una
    transacción abierta y no falla.
- [ ] **Step 2:** Correr; esperado FAIL.
- [ ] **Step 3:** Implementar con el patrón de `compliance._planilla_a_xlsx` (openpyxl, `Response` con
  media_type xlsx). Fechas como fecha de Excel, marcas en hora de Chile y arreglos unidos con ", ".
- [ ] **Step 4:** Correr; esperado PASS. Mutación: auditar antes de armar el archivo; el test del 413 queda en ROJO.
  Revertir.
- [ ] **Step 5:** Commit `feat(analitica): descarga Excel auditada`.

### Task 6: vistas guardadas

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20261104090000_saved_views.sql`
- Create: `monitor-app/backend/api/app/routers/analytics_views.py`
- Modify: `monitor-app/backend/api/app/main.py`
- Modify: `monitor-app/backend/api/app/routers/table_preferences.py` (`max_length=50` → `80`)
- Test: `monitor-app/backend/api/tests/test_analytics_views_integration.py`

**Interfaces:**
- **Tabla** `app.saved_views`:
  - `id uuid PK default gen_random_uuid()`;
  - `owner_id uuid NULL`: NULL en las sembradas, que son del sistema;
  - `dataset text CHECK IN ('trips','fleet')`;
  - `name text CHECK (char_length BETWEEN 1 AND 60)`;
  - `scope text CHECK IN ('personal','shared')`;
  - `view jsonb NOT NULL`: `{filters, q, sort, period: {preset, from?, to?}, date_field, mode?: 'table'|'pivot',
    pivot?}`;
  - `columns jsonb NOT NULL`: `[{id, hidden}]`, mismo formato que `table_preferences`;
  - `created_at`, `updated_at`;
  - `UNIQUE (owner_id, scope, name)` con `NULLS NOT DISTINCT`.
  - `REVOKE ALL FROM anon, authenticated`.
  - Siembra de 3 compartidas con `owner_id NULL`:
    - "BDOT completo" (trips, todas las columnas no personales);
    - "Operación por cliente" (trips: client_name, planning_date, trip_code, operation_type,
      operation_type_source, destination_zone, carrier_name, trip_status);
    - "F30-1" (fleet, `f.subject_type=DRIVER`, `preset=last_month`, columnas year_month, carrier_name,
      driver_name, driver_tax_id, category).
- **API** `/api/v1/analytics/views`:
  - `GET ?dataset=`: compartidas más las personales propias, con `can_edit`. Requiere `ANALYTICS_READ`.
  - `POST {dataset, name, scope, view, columns}`: `scope=shared` exige `ANALYTICS_MANAGE_VIEWS`.
  - `PATCH /{id}` y `DELETE /{id}`: solo el dueño. Una compartida también la edita quien tiene
    `ANALYTICS_MANAGE_VIEWS`; una sembrada (`owner_id NULL`), solo ese permiso.
  - 409 si el nombre se repite en el mismo alcance.
- **Regla de lectura:**
  - El `GET` devuelve `columns` sin las columnas personales si el usuario no tiene `ANALYTICS_PERSONAL_DATA`
    (Review Focus 3).
  - El backend no valida los ids contra el catálogo al leer: el frontend ignora los que ya no existen
    (Review Focus 4).
  - Al escribir, sí valida contra el catálogo: id desconocido, 422.

- [ ] **Step 1: Tests que fallan:**
  - `test_personal_solo_la_ve_su_dueno`;
  - `test_compartir_exige_manage_views`: POST shared sin el permiso da 403;
  - `test_solo_el_dueno_o_manage_views_edita`;
  - `test_nombre_repetido_es_409`;
  - `test_las_sembradas_existen`: las 3, `scope=shared`;
  - `test_f30_sin_permiso_personal_no_trae_rut`: el GET de "F30-1" sin `ANALYTICS_PERSONAL_DATA` no trae
    `driver_name` ni `driver_tax_id` en `columns`;
  - `test_preferencias_aceptan_80_columnas`.
- [ ] **Step 2:** Aplicar la migración en la copia local (`scratchpad/lpsql.sh -f`). Correr; esperado FAIL.
- [ ] **Step 3:** Implementar la ruta con `require`, más `exigir` donde el permiso depende del cuerpo.
- [ ] **Step 4:** Correr; esperado PASS, junto con `test_toda_ruta_declara_permiso.py` y los tests de
  `table_preferences`.
- [ ] **Step 5:** Commit `feat(analitica): vistas guardadas`.

### Task 7: modo servidor del kit de tabla

**Files:**
- Modify: `monitor-app/frontend/components/ui/tabla/data/useDataTable.ts`
- Modify: `monitor-app/frontend/components/ui/tabla/data/DataTable.tsx` (paginador con total del servidor)
- Test: `monitor-app/frontend/components/ui/tabla/data/useDataTable.server.test.tsx`

**Interfaces:**
- Produces: opción nueva `server?: { total: number | null; counts: Record<string, Record<string, number>> |
  null; page: number; pageSize: number; onPage: (page: number, pageSize: number) => void }` en
  `UseDataTableOptions`. Con `server`:
  - `manualPagination`, `manualSorting` y `manualFiltering` en true, y `rowCount` igual a `total ?? 0`;
  - `rows` y `pageRows` son las filas recibidas, tal cual;
  - `facetCount(col, v)` lee `counts[col][v] ?? 0`; `valuesOf(col)` devuelve las claves de `counts[col]` más los
    elegidos;
  - un cambio de vista llama `onPage(0, pageSize)`;
  - el modelo expone `total: number | null`.
  - Sin `server`, nada cambia: los tests actuales siguen verdes.

- [ ] **Step 1: Tests que fallan:**
  - `no filtra ni ordena en el cliente con server`: con 2 filas que no cumplen el filtro de la vista, `pageRows`
    son las 2;
  - `las cifras salen de counts`;
  - `cambiar el filtro vuelve a la página 0` (`onPage(0, 50)`);
  - `sin total no hay cifra`: `model.total === null` y el paginador no muestra "de N".
- [ ] **Step 2:** Correr `npx vitest run components/ui/tabla/data`; esperado FAIL.
- [ ] **Step 3:** Implementar como una rama dentro del mismo hook: una variante es una prop, no un componente
  hermano.
- [ ] **Step 4:** Correr todo `components/ui/tabla` y las secciones que usan el kit (`components/dashboard/sections`,
  `components/insurance`); esperado PASS.
- [ ] **Step 5:** Commit `feat(tabla): modo servidor del kit`.

### Task 8: el período en la URL

**Files:**
- Create: `monitor-app/frontend/lib/analytics/period.ts`
- Test: `monitor-app/frontend/lib/analytics/period.test.ts`

**Interfaces:**
- Produces:
  - `type PeriodPreset = 'today' | 'last_7d' | 'last_30d' | 'this_month' | 'last_month' | 'custom'`.
  - `type Period = { preset: PeriodPreset; from?: string; to?: string }`.
  - `type DateField = 'planning' | 'delivered' | 'signed' | 'business'`.
  - `resolvePeriod(p: Period, today: string): { from: string; to: string }`, en días de Chile, `today` como
    YYYY-MM-DD.
  - `readPeriod(params): { period: Period; dateField: DateField | null }` y `writePeriod(params, period,
    dateField)`, con las claves `period`, `from`, `to` y `date`. Conservan los demás parámetros, igual que
    `writeView`.
  - `PERIOD_LABELS: Record<PeriodPreset, string>`: Hoy, Últimos 7 días, Últimos 30 días, Este mes, Mes anterior,
    Rango.
  - Sin parámetros, el período es `{preset: 'last_30d'}`.

- [ ] **Step 1: Tests que fallan:**
  - `resolvePeriod({preset:'last_30d'}, '2026-10-22')` da `{from: '2026-09-23', to: '2026-10-22'}`;
  - `last_month` desde `2026-10-22` da `{from: '2026-09-01', to: '2026-09-30'}`;
  - `this_month` da `{from: '2026-10-01', to: '2026-10-22'}`;
  - `custom` respeta from y to;
  - `readPeriod` de una URL vacía da `last_30d`;
  - `writePeriod` conserva `f.cliente`.
- [ ] **Step 2:** Correr; FAIL. **Step 3:** Implementar. **Step 4:** Correr; PASS.
- [ ] **Step 5:** Commit `feat(analitica): período en la URL`.

### Task 9: cliente de la API y tipos

**Files:**
- Create: `monitor-app/frontend/lib/api/analytics.ts`
- Modify: `monitor-app/frontend/lib/types.ts`
- Test: `monitor-app/frontend/lib/api/analytics.test.ts`

**Interfaces:**
- Produces:
  - **Tipos:** `AnalyticsDataset = 'trips' | 'fleet'`, `AnalyticsColumnMeta` (como la respuesta de la Task 3),
    `AnalyticsPage = { rows: Record<string, unknown>[]; total: number; counts: Record<string, Record<string,
    number>>; loaded_at: string | null }` y `SavedView` (como la tabla de la Task 6, más `can_edit`).
  - **`analyticsApi`:**
    - `columns(dataset)`;
    - `rows(q: AnalyticsQuery)`;
    - `exportUrl(q, columns: string[])`: descarga con el token, devolviendo un Blob y el nombre del archivo;
    - `views(dataset)`, `createView(body)`, `updateView(id, body)`, `deleteView(id)`.
  - `AnalyticsQuery = { dataset; period: Period; dateField; view: TableView; page; size }`. La traducción a la
    URL es la misma de la Task 4: `f.`, `q`, `sort`, `from`, `to`, `date`, `page`, `size`.
  - El 413 de la descarga se lanza como `ExportTooLargeError(total)`.
- [ ] **Step 1:** Test de la traducción a URL y del 413, con fetch simulado. **Step 2:** FAIL. **Step 3:**
  Implementar con el cliente HTTP existente de `lib/api`. **Step 4:** PASS. **Step 5:** Commit.

### Task 10: pantalla Analítica (Viajes y Flota por día, modo tabla)

**Files:**
- Create: `monitor-app/frontend/app/dashboard/analytics/page.tsx`
- Create: `monitor-app/frontend/components/analytics/AnalyticsWorkspace.tsx`
- Create: `monitor-app/frontend/components/analytics/PeriodPicker.tsx`
- Create: `monitor-app/frontend/components/analytics/analyticsColumns.ts`: catálogo de la API → `DataColumn` del
  kit.
- Modify: `monitor-app/frontend/lib/navegacion/menu.ts`: `NavTopLeaf` "Analítica", ícono `BarChart3`,
  `permission: 'analytics.read'`, después de Seguros.
- Modify: `monitor-app/frontend/lib/rutas.test.ts`: `'analytics'` en `EN_INGLES`.
- Test: `monitor-app/frontend/components/analytics/AnalyticsWorkspace.test.tsx` y
  `monitor-app/frontend/lib/navegacion/menu.test.ts`

**Interfaces:**
- Consumes: Tasks 7, 8 y 9.
- **Pantalla:** `AnalyticsWorkspace({ initialDataset })`.
  - Arriba, el selector Viajes | Flota por día (`dataset` en la URL).
  - `PeriodPicker`, con el selector de fecha solo en Viajes.
  - "Datos al HH:MM" en hora de Chile, en ámbar si tiene más de 2 h.
  - `TableToolbar` con Columnas, Excel y búsqueda, y `DataTable` en modo servidor (Task 7).
  - Columnas desde `analytics.columns`; `useTablePreferences('analytics.<dataset>')`.
  - `useUrlView` para filtros, búsqueda y orden.
  - Una vista o una preferencia con un id que ya no está en el catálogo se ignora (Review Focus 4).
- **Excel:**
  - Llama `exportUrl` con las columnas visibles en orden y descarga el Blob.
  - Sin `analytics.export`, el botón está deshabilitado con el título "Pide a un supervisor que la descargue".
  - Con `ExportTooLargeError`: "El período tiene N filas; el máximo por descarga es 50.000. Acota el período o
    los filtros."
- **Estados**, con los textos exactos de la HU:
  - vacío: "No hay viajes planificados entre el {from} y el {to}" con el botón "Ver los últimos 30 días";
  - con filtros y cero filas: "Ningún viaje cumple los filtros" con "Quitar filtros";
  - cargando: sin total ni cifras;
  - error: "No se pudieron cargar los viajes" con "Reintentar", conservando la vista;
  - sin `analytics.read`: "No tienes acceso a Analítica".
  - En Flota por día los textos dicen "registros" en vez de "viajes".
- **Teléfono:** primera columna fija (`trip_code` o `license_plate`), y Excel y Columnas en un menú "⋯".

- [ ] **Step 1: Tests que fallan:** uno por estado, con los textos exactos; `el botón Excel deshabilitado sin
  analytics.export`; `sin personal_data no existe el grupo Datos personales en Columnas`; `cambiar de período
  pide la página 0 con el nuevo rango`; `una preferencia con una columna retirada no rompe`; y el menú muestra
  Analítica solo con `analytics.read`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** `npx vitest run components/analytics lib/navegacion
  lib/rutas.test.ts`; PASS.
- [ ] **Step 5:** Commit `feat(analitica): pantalla del módulo`.

### Task 11: vistas guardadas en la pantalla

**Files:**
- Create: `monitor-app/frontend/components/analytics/SavedViewsPanel.tsx`
- Create: `monitor-app/frontend/components/analytics/SaveViewDialog.tsx`
- Modify: `monitor-app/frontend/components/analytics/AnalyticsWorkspace.tsx`
- Test: `monitor-app/frontend/components/analytics/SavedViewsPanel.test.tsx`

**Interfaces:**
- Consumes: Tasks 6 y 9. La vista activa va en la URL como `vista=<id>`.
- **Panel izquierdo** (en el teléfono, un selector arriba): grupos "Compartidas" y "Mías", y "+ Nueva vista".
- **Al aplicar una vista**, escribe en la URL sus filtros, búsqueda, orden, período y fecha, y pone sus columnas
  como preferencia de la sesión (`columnPrefs` del kit), sin pisar las preferencias guardadas.
- **Cambios sin guardar:** si la URL difiere de la vista, aparecen "Guardar cambios" (solo con `can_edit`) y
  "Descartar".
- **`SaveViewDialog`** (primitiva `Dialog` del kit):
  - nombre, de 1 a 60 caracteres;
  - "Compartir con el equipo", solo con `analytics.manage_views`.
  - Si falla, el diálogo no se cierra y conserva el nombre. Con 409: "Ya hay una vista con ese nombre".
- [ ] **Step 1: Tests que fallan:** aplicar, guardar, descartar, compartir sin permiso (opción oculta), 409 y
  error de red que no cierra el diálogo. **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS. **Step 5:**
  Commit.

### Task 12: Tabla dinámica de Flota por día y retiro de la Reportería

**Files:**
- Create: `monitor-app/frontend/components/analytics/FleetPivot.tsx`
- Modify: `monitor-app/frontend/lib/utils/pivot.ts`: tipo de fila genérico `PivotRow = { carrier_name: string |
  null; client_names: string[]; status: string; unassigned_reason_label: string | null; business_date: string }`
  en lugar de `DailyClosureReportRow`.
- Modify: `monitor-app/frontend/app/dashboard/operations/closures/history/page.tsx`: pasa a ser un `redirect` a
  `/dashboard/analytics?dataset=fleet&mode=pivot&period=custom&from=…&to=…`, conservando `desde` y `hasta` si
  vienen.
- Modify: `monitor-app/frontend/components/dashboard/sections/StatusReportSection.tsx:158`: "Ver histórico" a la
  ruta nueva.
- Modify: `monitor-app/frontend/lib/navegacion/menu.test.ts:71`: la ruta vieja ya no marca Cierre.
- Test: `monitor-app/frontend/components/analytics/FleetPivot.test.tsx` y
  `monitor-app/frontend/lib/utils/pivot.test.ts`

**Interfaces:**
- Consumes: `analyticsApi.rows` con `dataset=fleet` y `size` hasta 20.000. Para el pivot, el backend acepta
  `size` mayor que 200 solo con `mode=pivot` y `dataset=fleet`: ajuste en `parse_request` de la Task 4, con su
  test.
- **Pantalla:**
  - modo "Tabla | Tabla dinámica" (`mode` en la URL), solo en Flota por día y no en el teléfono, donde se
    explica en una línea;
  - filas y columnas con los chips de campo actuales (Empresa, Cliente, Estado, Motivo, Fecha con granularidad),
    en la URL como `pr` y `pc`;
  - valores: cantidad de registros.
- [ ] **Step 1: Tests que fallan:**
  - `pivot.test.ts` sigue verde con `PivotRow`;
  - `FleetPivot` arma Empresa × semana con 3 filas de ejemplo;
  - la ruta vieja redirige conservando el rango;
  - "Ver histórico" apunta a la ruta nueva.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS, más
  `npx vitest run && npx tsc --noEmit && npm run build`.
- [ ] **Step 5:** Commit `feat(analitica): tabla dinámica de Flota por día; la Reportería pasa a Analítica`.

### Task 13: producción y humo

- [ ] **Step 1:** Ensayo con ROLLBACK de `20261104090000_saved_views.sql` en la real (`scratchpad/rpsql.sh`).
  Pedir autorización, aplicar con `apply_migration` (sin BEGIN/COMMIT) y verificar las 3 vistas sembradas.
- [ ] **Step 2:** Push a `dev` y esperar a que el usuario confirme los dos deploys en verde.
- [ ] **Step 3:** Humo con Playwright en `https://webcarga-frontend-dev-zcdyyci7ta-uc.a.run.app/dashboard/analytics`:
  - aplicar "BDOT completo", cambiar el período a Mes anterior y filtrar Cliente = Walmart;
  - guardar la vista personal "Prueba humo", descargar el Excel con la descarga capturada y verificar con
    openpyxl el encabezado y el número de filas;
  - confirmar con SQL la fila `ANALYTICS_EXPORT` en `audit_log`;
  - abrir la Reportería vieja y comprobar la redirección;
  - la tabla dinámica Empresa × semana del mes anterior coincide con la que daba `/daily-closures/report` para
    el mismo rango (comparar por SQL);
  - capturas a 1440 y 390;
  - borrar la vista "Prueba humo".
- [ ] **Step 4:** Actualizar `AGENTLOG.md` y commit.
