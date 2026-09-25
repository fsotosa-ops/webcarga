# CLAUDE CONTEXT MEMORY
> Proyecto: webcarga
> Histórico completo en AGENTLOG_ARCHIVE.md — no es el histórico completo.
> **`AGENTLOG_ARCHIVE.md` NO está en git, y es a propósito** (decisión del usuario, 2026-08-15):
> el histórico no ensucia el repo ni los diffs. Consecuencia asumida: archivar mueve contenido
> fuera de control de versiones. El respaldo real son los commits viejos de `AGENTLOG.md`, que sí
> está trackeado — el `.gitignore` lo lista pero no lo afecta, porque ya lo estaba desde antes.
> No "arreglar" esto con `git add -f`.
> (Rondas 51-54, 55-109, 112-120 y 138-146 archivadas en su momento; ver el archivo.)
> (**Rondas 147-148 archivadas al cerrar la Ronda 149**: el backlog y el roadmap, el click-through
> de la app desplegada, el contrato, el rol `writer` y el test rojo. Lo que seguía abierto se
> consolidó ABAJO antes de mover nada.)
> (**Rondas 152-157 archivadas al cerrar la sesión del 2026-09-14**: todo su trabajo está
> desplegado, y lo que seguía abierto se consolidó en el checklist de la Ronda 160.)
> (**Rondas 149-161 archivadas al cerrar la Ronda 162**: el único pendiente propio de la 161 era
> la historia de usuario de Operación/CD, que ES la Ronda 162; lo demás que seguía abierto está
> consolidado en el checklist de abajo antes de mover nada.)

### 2026-09-24 — Ronda 164: caída de la tarde (Disk IO agotado) y recorte del IO de la ingesta

Plan aprobado: `~/.claude/plans/purring-hugging-meteor.md`.

## Diagnóstico (medido)

- **16:45 CL**: la base (org `webcarga`, **plan free**, confirmado con `get_organization`) agotó
  el Disk IO. Hubo `statement timeout` a razón de 140/h, checkpoints de 4 páginas/s y el MCP no
  podía conectarse. Supabase Auth comparte esa base, así que `/token` daba 10 s de timeout y el
  login devolvía **504 "Gateway Timeout"**. El "304" que vio el usuario es caché del navegador,
  no un error.
- **No fue la concurrencia** (el tráfico web es de decenas de requests cada 15 min) **ni el
  tamaño** (239 MB contra 500). Esto corrige la hipótesis "Micro/CPU" de la Ronda 163: el cuello
  es el disco.
- **La ingesta corre cada 15 min las 24 h**, no cada 30. Cada corrida dura 7-8 min, así que la
  base pasa la mitad del día bajo carga. El usuario decidió **mantener 15 min**.
- **Causa principal**: los 5 `insert_raw_*.sql` reescribían TODAS las filas de cada archivo
  (payload jsonb, índices, WAL) aunque nada cambiara. Dos cosas dependían de esa reescritura:
  - La marca de agua de los 5 processors: `SELECT file_name ... ORDER BY last_updated_at DESC`.
  - La alarma de SAP caído: `stg_qanalytics_trips.sap_block_liveness`.
  Según la macro `is_stale`, el 98 % de las filas SAP no cambia en 24 h.
- Otras fuentes de carga:
  - `slv_milestone_trips` se reconstruye con `--full-refresh` en cada corrida.
  - `+trips` vuelve a correr todo el upstream.
  - `dbt test` corre cada 15 min.
  - 5 CREATE y 5 DROP de `tmp_raw_*` generan unas 400 líneas de recarga de esquema de
    PostgREST por hora.
- La API `pipeline_list` de mage-agent devuelve un DAG desactualizado (del 19/08, sin
  `app_trips_tests`). **La verdad es el `metadata.yaml`**, que coincide con los logs.

## Hecho (LOCAL, sin desplegar; el mirror de Mage no está en git)

1. **Registro de archivos**, en reemplazo de la marca de agua. El usuario pidió la versión robusta,
   no un parche:
   - Migración `monitor-app/backend/supabase/migrations/20260924100000_bronze_ingested_files.sql`.
     Crea `bronze.ingested_files` y la siembra desde `bronze.tms_trips`. **No aplicada.**
   - `utils/ingested_files.py`: `select_new_files` elige los archivos que no están cerrados, con
     una ventana de gracia de 6 h para los atrasados. `register` los marca `pending` o `empty`.
     Probado en local con una conexión falsa.
   - Los 5 processors usan el registro. Wingsuite marca `empty` los archivos vacíos.
   - Los 5 `insert_raw_*.sql` agregan `AND payload IS DISTINCT FROM EXCLUDED.payload`, cierran los
     archivos que aterrizaron como `loaded` y los `pending` sin filas como `empty`.
   - `stg_qanalytics_trips.sap_block_liveness` lee `MAX(loaded_at)` del stream SAP.
     `sources.yml` declara `ingested_files`.
   - `status_reported_at` / "Ya no está en el TMS" no cambia: sale del snapshot, que ya solo
     versionaba cuando cambiaba el payload.
2. `dbts/app_trips_update.yaml` pasa de `+trips` a `trips trip_stops`. El DAG ya ordena
   `slv_milestone_trips → stg_qanalytics_trips → int → app_trips_update`. Se quitó el
   `--full-refresh` de los 3 yaml de vistas.
3. `app_trips_tests` sale de `batch_tms_monitor_trips` y pasa al pipeline nuevo
   `pipelines/tms_daily_tests/`. `batch_tms_monitor_trips` queda con
   `concurrency_config: pipeline_run_limit 1, skip`.

## Estado al cerrar la sesión (24/09, ~21:10 CL)

- **El trigger de `batch_tms_monitor_trips` está PAUSADO** (lo pausó el usuario; la última
  actividad de Mage fue a las 23:38 UTC). **Nada de Mage está desplegado todavía.** El pipeline
  en vivo es el de siempre: al reactivarlo sin sincronizar vuelve la carga vieja.
- **La migración 20260924100000 NO está aplicada** (commiteada, sin aplicar). Hubo tres intentos
  y ninguno terminó:
  - `execute_sql` del MCP: timeout.
  - SQL Editor del Studio: "failed fetch api.supabase.com". El Studio corta a 58 s
    (`statement_timeout='58s'`) y además tiene timeout HTTP.
  - `psql` por el pooler: `ECHECKOUTTIMEOUT`, el pool estaba agotado.
  El `CREATE`/`INSERT` es idempotente, así que se puede reintentar tal cual. Antes hay que mirar
  `pg_stat_activity` por si un intento anterior quedó colgado.
- **La base seguía estrangulada con Mage quieto.** Los checkpoints escribían 124 buffers en 33 s,
  y el catálogo del Studio, las recargas de PostgREST y `pgbouncer.get_auth` tardaban 11-21 s.
  El presupuesto de IO del plan free solo se recarga con uso bajo el nivel base: **no conviene
  consultar la base mientras tanto**, porque cada intento lo gasta. Además aparece
  `archive command failed` en los logs.
- La línea base medida antes del bloqueo (`pg_stat_statements` acumula desde el 17/04, 47 GB
  de WAL en total):
  - **Una sola sentencia de dbt = 21 GB de WAL y 2,87 millones de bloques escritos**, en 7.354
    llamadas. No alcancé a ver qué nodo es: la consulta excedió el timeout.
    **Es lo primero que hay que identificar**; sospechosos: el `create table` con
    `--full-refresh` de `slv_milestone_trips` o el merge de `app.trips`.
  - `bronze.tms_trips`: **2,5 millones de updates sobre 8.889 filas**, 0 HOT.
  - Los `COPY` a `tmp_raw_*` suman 2,7 GB (SAP), 1 GB (Sodimac) y 0,8 GB (Wingsuite).
  - `bronze.raw_bd_ot` pesa 80 MB, la tabla más grande (pipeline `legacy_drivers_transporters`).
- Conexión por `psql` desde este equipo: el host directo `db.<ref>` es solo IPv6 y no resuelve.
  Hay que usar `aws-1-us-east-1.pooler.supabase.com:5432` con el usuario
  `postgres.viclzoftiudkepqnhekv` y la clave de `monitor-app/backend/api/.env`.

## Checklist — siguiente paso exacto

1. **Revisar solo los logs** (`query_logs`): que no haya `statement timeout` y que los
   checkpoints escriban a ritmo normal (menos de 5 s por cada ~300 buffers). Si pasada ~1 h
   sigue igual o el pool sigue agotado, **el usuario reinicia el proyecto** (Settings → General →
   Restart). El reinicio no recarga el IO, pero libera las sesiones colgadas.
2. Con la base respondiendo:
   - aplicar la migración con
     `psql <pooler> -f monitor-app/backend/supabase/migrations/20260924100000_bronze_ingested_files.sql`,
     sin pasar por el Studio;
   - verificar con `select stream, count(*), to_timestamp(max(file_ts)) from bronze.ingested_files group by 1`.
     Deben aparecer 5 streams, con el último cerca de las 23:30 UTC del 24/09.
3. `sync_status`, luego `sync_local_to_remote`. Confirmar en `metadata.yaml` remoto que ya no
   está `app_trips_tests` y que `concurrency_config` quedó en `pipeline_run_limit 1, skip`.
   El usuario confirmó `skip`: `wait` tampoco recupera el estado del turno saltado, porque el
   scraper baja el estado actual.
4. **Usuario**: reactivar el trigger. Crear el trigger diario de `tms_daily_tests` a las ~07:30 CL.
5. Verificar la primera corrida:
   - verde;
   - `ingested_files` con `loaded` por stream;
   - `last_sap_ingest_at` avanza;
   - `n_tup_upd` de `bronze.tms_trips` cae;
   - sin `CREATE ... tms_milestone_trips` duplicado.
6. Identificar el nodo dbt de 21 GB de WAL:
   `select calls, wal_bytes, left(query,700) from extensions.pg_stat_statements order by wal_bytes desc limit 3`,
   con la base sana y `statement_timeout` holgado.
   Medir las filas de `silver.tms_milestone_trips` que ya no están vigentes en `tms_sap_snapshot`.
   Si son ~0, quitar `--full-refresh` de `dbts/slv_milestone_trips.yaml`.
   Después, `select extensions.pg_stat_statements_reset()` para medir el antes/después por corrida.
7. Paso 5 del plan: staging `tmp_raw_*` permanente con TRUNCATE, para cortar la recarga de
   PostgREST. Va en un despliegue separado, después de medir el 5.

### 2026-09-23 — Ronda 163: bugs del 23/09 (alta manual 500, cierre del 22/09) + eliminar viajes

Reportados en `monitor-app/bugs/20260923/` (dos screenshots). Plan aprobado en
`~/.claude/plans/necesito-que-revises-los-fluffy-quilt.md`.

## Causa raíz, medida (no supuesta)

- **Bug 1, alta manual "Error 500"**: 8 POST /trips con `UniqueViolationError uq_trip_fleet_link`
  en Cloud Run. El INSERT en `app.trips` dispara `trg_trips_resolve_fleet_ins`, que ya escribe el
  vínculo `auto`, y `_insert_trip` insertaba el `manual` sin ON CONFLICT. **Nunca funcionó desde el
  17/08**: hay 1 viaje manual con link manual en toda la historia (07/07). Sin transacción, cada
  reintento dejó un viaje a medias: **9 viajes huérfanos** (7 copias de SAN BERNARDO→IANSA del 23/09,
  1 HBC del 23/09 y 1 del 21/09). La rama CSV por patente chocaba igual.
- **Bug 2, cierre del 22/09**: **el POST de cierre nunca llegó a la API**. La base de Supabase se
  saturó de 22:30 a 02:00 UTC (142 statement timeouts, un `SELECT` de catálogo de 11 s, checkpoints
  de 127 s, con pocas conexiones activas: es hambre de CPU/IO, no locks ni conexiones). Supabase Auth
  usa esa base, así que cayó con ella (85/93 `/token` con 504). La app llamaba a Auth por HTTP en
  CADA request (middleware, layout, API síncrona que bloqueaba el event loop): cada página tardó
  ~35 s → `307 /login` → el login de Microsoft dio el Gateway Timeout del screenshot.
- **El 23/09 se REPITIÓ** desde las 21:00 UTC (18:00 CL): 140 statement timeouts y 169 errores 5xx
  de Auth hasta las 00:00 UTC; el JWKS de Auth tampoco respondía. La noche del 21/09: cero.
  **Es recurrente, no un evento aislado.**

## Decisiones de arquitectura

1. **Un solo dueño por escritura del vínculo manual**: `_escribir_link_manual` es un upsert que
   CONVIERTE el `auto` del trigger en `manual` (terminal). Lo usan el alta y `assign_fleet_link`, que
   esquivaba el mismo choque con SELECT+DELETE+INSERT. La resolución automática es sólo del trigger:
   se retiró `_auto_resolve_fleet_link`.
2. **`create_trip` en transacción**, como `/bulk`. **Manejador global** en `main.py`: un 500
   imprevisto responde JSON `detail` con `ref.` que también queda en el log.
3. **Eliminar viajes**: sólo `source_system='manual'`; admin/owner o el creador
   (`trips_manual.created_by`); nunca si `app.trips_del_dia(D)` lo incluye con D CLOSED. La regla vive en
   `services/eliminar_viajes.py` y decide también `can_delete` en el listado (la UI nunca ofrece lo
   que el backend rechaza). **No hay FK hacia `app.trips` en producción** (dbt las borra): el servicio
   borra a mano `closure_lines`, `trip_notes` (adjuntos por cascada, Storage después del commit),
   `trip_fleet_links`, `trip_stops`, `trips` y **`trips_manual`** (si no, dbt lo resucita). Deja una
   fila `delete` en `audit_log`.
4. **La barra de selección de Certificación se volvió `components/ui/BarraDeSeleccion`**, y
   `TriageBulkBar` la compone. No se creó una barra hermana.
5. **Sesión verificada localmente** (patrón oficial de Supabase para llaves asimétricas, ES256):
   PyJWT en la API y `getClaims` en Next, a través de `leerSesion()` (lib/supabase/sesion.ts), la
   única lectura de sesión del servidor. **Auth caído ≠ sin sesión**: lleva a `/auth/no-disponible`,
   no a `/login`. JWKS inalcanzable = 503, no 401.
6. **La llave PÚBLICA va versionada** (`backend/api/app/supabase_jwks.json` y
   `frontend/lib/supabase/jwks.json`), porque el JWKS de Auth tampoco respondía y Cloud Run arranca
   en frío (min-instances=0). Un kid desconocido se busca en vivo. **Revocar una llave exige sacarla
   de los dos archivos.**

## Estado: DESPLEGADO en dev (24/09, ~01:50 UTC)

- Commits en `dev`: `91b69bc0` (alta + eliminar), `72bcccda` (auth), `73db5e1e` (fix de la regla de
  día firmado). Workflows API y Frontend en verde; `/health` 200; sin token → 401; cero errores en
  Cloud Run; el middleware nuevo reconoce la sesión (Playwright entró directo al Monitor).
- Verde con la base sana: integración de alta manual 4/4, eliminación 6/6 (con mutación comprobada
  sobre el borrado de `trips_manual`), backend unit 804, frontend 1395 + tsc + build. Listado del
  Monitor: 213 ms antes y después del JOIN nuevo.
- **Error mío atrapado en vivo**: la regla de "día firmado" miraba `closure_lines` TRIP, que en
  producción NO existen (sólo ASSET/DRIVER; la ola 4.4 sigue pendiente). El test pasaba porque
  fabricaba una. Ahora usa `app.trips_del_dia(D)`, la misma definición con que el cierre cuenta los
  viajes, y el test firma un día real.
- **El 23/09 lo firmó Operaciones a las 22:51 CL con `viajes: 38`, que INCLUYE las 6 copias
  sobrantes de IANSA.** Por la regla nueva, hoy los 9 viajes huérfanos están bloqueados para
  eliminar (21/09 y 23/09 cerrados). No se reabrió nada: es decisión de Operaciones.

## Causa de la saturación (investigada 24/09, parcial)

- Ocurre casi todos los días HÁBILES (15, 16, 17, 18, 21, 22, 23/09), y ninguno el sábado ni el
  domingo. Normalmente entre 03:00 y 08:00 CL, sin que nadie la vea; el 22 y el 23 se corrió a la tarde.
- Instancia muy chica: base de 239 MB, `shared_buffers` de 224 MB, `max_connections` 60 → Micro
  (CPU compartida con créditos). La transición es brusca: la recarga del esquema pasa de ~1 s a más
  de 10 s de golpe. Encaja con créditos de CPU agotados. **Sin confirmar**: el endpoint de métricas
  daba 504 y el MCP no tiene historial.
- Carga de fondo propia: ~5-6 mil sentencias dbt/día (incluye `dbt test` desde al menos el 14/09) y
  **~116 recargas por hora del caché de esquema de PostgREST, las 24 horas**, disparadas por el DDL
  de la ingesta. Cada una cuesta ~2 s de catálogo más una reconexión.

## Checklist — siguiente paso exacto

1. **Decisión de Operaciones sobre el 23/09**: reabrir el día → eliminar desde el Monitor 6 de las
   7 copias de IANSA (conservar `747ebcec…`, la primera) → volver a firmar. La herramienta ya existe
   y lo permite a admin/owner/creador. El 21/09 (`554a1c7a…`) cuenta en los cierres del 21 y del 22:
   misma decisión.
2. Click-through del usuario: crear un viaje manual con conductor, patente y empresa (ya no da 500);
   eliminar en lote.
3. **Infraestructura (el usuario)**: dashboard → Settings → Compute (confirmar Micro) y Reports →
   Database (CPU / Disk IO) del 22/09 19-23 CL. Si se confirma → subir la instancia (Small/Medium).
4. Después, con OK del usuario (toca Mage): cortar la tormenta de recargas de PostgREST (tablas
   temporales de la ingesta, o que PostgREST no mire `bronze`/`silver`). Medir antes cuál funciona.

### 2026-09-17/18 — Ronda 162: HU-28, asistencia y cierre por ORIGEN y por operación

Operaciones respondió las cuatro preguntas abiertas de la Ronda 161
(`monitor-app/bugs/20260916/levantamiento-user-story.md`) y con eso se diseñó y se implementó la
dimensión que al cierre le faltaba. **HU escrita en
`monitor-app/docs/user-stories/20260917/01-hu-asistencia-y-cierre-por-origen.md`** (es la fuente: el
mockup manda). Plan aprobado en `~/.claude/plans/jiggly-rolling-blum.md`.

## La objeción del usuario, y cómo se resolvió

El usuario frenó el diseño dos veces con la misma idea: *"nada de lo que viene desde la TMS es
editable"*. Cruzado el documento de Operaciones con el levantamiento, **ninguna de las 24 líneas pide
editar un dato que el TMS reportó**: todo es agrupar, filtrar y contar. Y las dos frases ambiguas se
desambiguan solas con las respuestas —"dejar abierto el filtro de CD Origen" significa que el filtro
liste **todos** los CD y no sólo Peñón/QL/LOA (respuesta 3), y "modificar el campo en los no
asignados" es fijar a qué operación se ofrece un camión **sin viaje**, del que el TMS no dice nada
(respuesta 1). Operaciones escribió el mismo criterio del usuario en su línea 21: *"se puede
modificar con la asignación de TMS"*.

Después pidió el estándar de la industria. Es **home terminal / domicile**: dato maestro declarado
del conductor (Samsara, Motive, McLeod LoadMaster, Trimble/TMW; en EE.UU. lo exige la FMCSA). De ahí
salieron las tres reglas que se adoptaron, y **una de ellas descartó mi propia propuesta anterior**
de derivar el CD del historial.

## Decisiones de arquitectura

1. **Un atributo maestro no se deriva de transacciones.** Calcular el CD desde "dónde cargó más
   veces" lo haría cambiar solo, y con él la asistencia de meses ya firmados.
2. **Asistencia y volumen son dos dimensiones distintas**: la asistencia agrupa por el **CD base
   declarado**; el volumen, por el **origen real del viaje**. Dos columnas, nunca un `COALESCE`.
3. **Un maestro de ubicaciones con roles, no una tabla por rol.** `is_origin_cd` es un **booleano**
   y no un `kind` de valor único porque **14 de los 24 orígenes observados YA existían como local de
   entrega**: un valor único obligaba a duplicar esas filas.
4. **La línea del cierre guarda su propia dimensión** (Kimball). El congelamiento sale gratis:
   `recalcular` ya es no-op con el día CLOSED.
5. **Descartado a propósito**: tabla de alias (el dato no está sucio), vigencia SCD2 del CD
   (`end_date` está en **0 de 402 filas** en las 4 tablas de asignación del repo — una quinta
   vigencia que nadie puebla es el frankenstein), y un maestro de "operación" por equipo
   (`carrier_shippers` ya existe y el filtro del cierre ya lo usa).
6. **Nomenclatura**: ninguna columna nueva se llama `operation_*` — el nombre ya está tomado dos
   veces (`assets.webcarga_operation_type_id` = Tractoreo/Equipo Completo; `locations.operation_type`
   = zona RM/Z0/Región).

## Lo medido contra producción, que corrigió dos supuestos del plan

- **Los nombres de CD NO vienen sucios.** 18 orígenes distintos en 47 días, escritos canónicos por el
  TMS; no existe ninguna fila "LOA" ni "QL" — eso es cómo habla Operaciones. La mitad del trabajo que
  el plan proponía (normalizar) no hacía falta.
- **Origen poblado en 1.571 de 1.572 viajes (99,94%)**, sólo en `app.trip_stops.local`.
  `trips.origin_tms`/`origin_city`/`origin_region` son columnas muertas (100% NULL).
- **El CD no es fijo y por eso se declara**: 35% de los conductores de Walmart cargan en más de un
  CD, pero el dominante concentra el **90,5%** de sus viajes.
- **Roster de Tractoreo: 41 conductores**; 35 tienen un CD dominante ≥80%, 3 entre 60-80%, 2 bajo 60%
  y 1 sin historial. Por eso la carga inicial es una **sugerencia de un clic**, no 41 campos vacíos.
- **Siembra del catálogo**: 12 CD (8 marcas sobre filas existentes + 4 nuevas de Walmart), **99,26%
  de los viajes cubiertos**, 0 ambigüedades. Los 12 pares que quedan fuera son tiendas con 1-2 viajes
  de logística inversa, no CD.

## Aplicado a producción (3 migraciones, todas ensayadas con ROLLBACK antes)

| Qué | Dónde |
|---|---|
| `locations.is_origin_cd` + índice parcial + 12 CD sembrados | `20260917020000`, aplicada |
| `drivers.home_location_id` + trigger `drivers_home_location_es_un_cd()` | `20260917030000`, aplicada |
| `closure_lines.home_location_id` + índice `(business_date, home_location_id)` | `20260917040000`, aplicada |

Estado verificado en producción: 12 CD en catálogo, columna e índice de la línea creados, trigger
activo, **0 conductores con CD base** — que es la carga de negocio, no un pendiente de desarrollo.

## Lo construido, por ola

- **Ola 1**: `GET /locations?origin_cd=true`; `is_origin_cd` en el alta y el PATCH.
- **Ola 2**: el CD base entra y sale por el detalle y el alta de conductor; **sugerencia que propone
  y nunca escribe** (umbral 80%, ventana 90 días), campo en `DriverDetailPanel` y en `AltaDeFlota`, y
  sección **Configuración › Operaciones › Centros de distribución**.
- **Ola 3**: la línea del cierre guarda el CD (el tracto lo hereda de su conductor habitual);
  `home_cd_id`/`home_cd_name` y `carrier_shipper_names` en los dos ejes y en el pivot de Reportería;
  columna **"CD"** al lado de "Local de origen"; **el desplegable de CD se alimenta del catálogo y no
  de las filas presentes** (única excepción al criterio de la tabla, comentada en el código); las
  filas sin carga muestran las operaciones habilitadas de su empresa en cursiva; **los tiles pasan a
  contar sobre las filas filtradas**; y el aviso de "nadie tiene CD base" con enlace al Directorio.

## Tres hallazgos que valen más que el código

1. **El `UNIQUE` que la migración de julio declara sobre `public.locations` no existe en
   producción**: lo que hay es un índice único *case-insensitive* con otro nombre
   (`locations_entity_name_site_number_ci_key`). Un `ON CONFLICT ON CONSTRAINT` habría reventado en
   el deploy. Lo atrapó el ensayo contra la base, no los tests.
2. **`routers/locations.py` no tenía NINGÚN test de integración**: sus tests mockeados pasaban con
   una columna inexistente en el `SELECT`. Ahora tiene 4.
3. **Inferí tres firmas en vez de abrirlas** (`shippersApi`, `useRowFeedback`, `useConfigList`) y las
   tres estaban mal; `useConfigList` además habría recargado en bucle con un arrow inline.

## Lo medido

Frontend **1.375 en verde**, `tsc` limpio, `npm run build` OK, trinquete visual **1.685** sin
moverse. **Backend 1.037 en verde, cero fallas** (venía de 1.017): **16 tests nuevos de integración**
en 3 archivos, todos contra Postgres real en transacción revertida. Frontend final: **1.379**.
Los trinquetes atajaron tres veces (1.687 de color, y tamaño bajo 11px); las tres se corrigieron con
tokens y ninguno subió.

**Mutaciones verificadas, 15 en total**: el trigger del CD (probado sacándolo dentro de una
transacción revertida), el borrado con cadena vacía, el campo en la lista `touched`, la sugerencia
que no se ofrece con dato puesto, el filtro alimentado por catálogo, el borrador que se resincroniza,
el error de catálogo que no dibuja un desplegable vacío, el upsert que guarda el CD, la herencia del
tracto, las operaciones habilitadas, los tiles que siguen al filtro, y las dos columnas que no se
funden. **Ojo con una**: sacar la primera guarda del congelamiento NO pone nada en rojo — hay dos, y
hay que sacar las dos para que el test lo note. Defensa en profundidad, no test flojo.

## Dos correcciones del usuario que cambiaron el modelo y el nombre

**1. No hay umbral: si el TMS lo reporta como origen, lo es.** *"si aparecen dentro de la
trazabilidad de origen es porque lo son"*. Mi siembra usaba un umbral de 5 viajes en 90 días —una
heurística mía que separaba "CD de verdad" de "ruido" sin tener con qué decidirlo— y dejaba 12
lugares afuera. El catálogo pasó de 12 a **24**. Y se retiró la exclusión del trigger
`app.reconcile_new_trip_stop_location()`, que sólo sembraba DESTINATION con este argumento: *"el
ORIGIN casi siempre es un CD del transportista, no un local de cliente"*. Era cierto cuando una fila
de `locations` sólo podía significar "local de entrega"; con el rol aparte deja de serlo, y sin el
trigger el catálogo se quedaba viejo en silencio.

**2. No todos los orígenes son CD.** *"no todos se llaman CD porque no lo son... pero sí son un
origen"*. Medido sobre los 24: **sólo 7 se llaman "CD"**. Los otros 17 son bodegas
(`Bod La Farfana 1`), operadores logísticos (`SITRANS`, `Saam Renca`), una devolución
(`Logistica Inversa`) y tiendas despachando (`Express Maipú`, `VIÑA DEL MAR`, `HIPER SANTA CRUZ`).
Estaba nombrando la categoría por su caso más frecuente, que es justo lo que este proyecto prohíbe.

`is_origin_cd` → **`is_origin`**; en pantalla, **"Origen habitual"**. El primer intento fue *"Origen
base"* y el usuario lo frenó — *"¿qué es eso? no se entiende"*—: era una traducción literal de *home
terminal*. El nombre bueno estaba **a una columna de distancia**: la tabla ya dice "Tracto habitual".
La lección: cuando hace falta un término nuevo, mirar primero el vocabulario que la propia pantalla
ya usa.

## Un test mío que cambiaba de color solo, y cómo se cerró

La suite completa falló 1 de 1.037 — y dos veces, en tests DISTINTOS del mismo archivo. No era flake
ni presión de conexiones: `_conductor()` de `test_cd_base_conductor_integracion.py` sorteaba un RUT
completo confiando en que `public.canonical_rut()` lo aceptara, pero esa función **valida el dígito
verificador**. Un número al azar sirve 1 de cada 11 veces; con 40 reintentos cada llamada fallaba el
~2%, y el archivo la llama 7 veces → **~14% de que la corrida se cayera**.

Sólo apareció corriendo la suite ENTERA: el archivo solo pasaba, y los tres archivos nuevos juntos
(16 tests) también.

Arreglado sin reimplementar la regla en Python —lo que el propio docstring del test prohibía—: se le
preguntan a la base los 11 dígitos posibles y se toma el que califica. Evidencia en dos formas: **5
corridas seguidas en verde** (con el helper viejo, ~53% de que al menos una fallara) y la propiedad
directa medida contra producción — sobre **500 cuerpos al azar, exactamente 1 dígito válido cada
uno**, sin excepción.

## Ola 4: DESPLEGADA (decisión del usuario, 18/09)

Retira las dos adivinanzas —`_LAST_KNOWN_ORIGIN_SQL` y su gemela por conductor en
`status_report.py`, y el LATERAL `last_origin` de `equipment_closures.py`— y hace que las
**Secciones 2, 4 y 7 agrupen por el origen habitual declarado**. La **Sección 3 (vueltas) se queda con el
origen real**: es volumen, no asistencia. La Sección 2 tiene que ir por el declarado para que cuadre
con la 7, donde "enrolados" incluye a quien no salió y ése no tiene origen.

**Sección 7 nueva — "Cargaron en otro origen"** (ola 4.1). Es la mitad del valor del estándar:
declarar el origen habitual no sirve para que todos calcen, sino para poder VER cuándo no calzan. Sale de datos que
ya están en la fila, sin una consulta más.

### El antes/después que la condicionaba

| 16/09 | |
|---|---|
| Conductores en el cierre | 41 |
| **Antes** (adivinanza) | 40 con CD |
| **Después** (declarado) | **0 con origen habitual** |

Se retuvo un día por eso. El usuario decidió desplegarla igual el 18/09: **"Sin origen" es la verdad
y se llena solo** a medida que Operaciones carga los 41, mientras que lo anterior dejaba en pantalla
un número que ya sabíamos mal.

Y de paso quedó medido el defecto que la ola retira: la adivinanza atribuía al 16/09 orígenes de
viajes **desde el 23/07** y hasta el **17/09** — o sea le ponía a un día el CD de un viaje
*posterior*. Eso es reescribir el pasado, literal.

**Impacto proyectado** si los CD se cargan con la sugerencia (dominante ≥80%): en los últimos 15
días, **4 desvíos de 354 viajes (1,1%)**, en 2 conductores. La Sección 7 va a ser corta y legible,
no ruido.

## Checklist — siguiente paso exacto

1. **TODO DESPLEGADO Y VERIFICADO.** Las cuatro olas están en `dev`, en cinco commits: `2f96a519`
   (backend), `bedc48b4` (frontend), `d0987812` (ola 4), `ada0a0b4` (fix del test) y `bc05dd33`
   (rename a origen). Deploys en verde, `/health` 200, `/locations?origin=true` responde 401 sin
   credenciales, el filtro muestra **los 24 orígenes** en la app, cero errores en consola y en los
   logs. **Árbol limpio.**
   - **La HU no está en git**: `monitor-app/docs/` está en `.gitignore` por diseño.
   - **Ojo con el orden**: renombrar `is_origin_cd` dejó `/locations` en 500 hasta desplegar el
     backend. Fue asumido y duró minutos, pero un rename de columna viva no tiene orden sin hueco.
2. **Lo único que falta es de negocio: cargar el origen habitual de los 41 conductores.** Para 35 es
   un botón que ya dice el origen concreto; 3 tienen dominante entre 60-80% (se muestra el reparto y
   elige la persona), 2 bajo 60% y 1 sin historial. Mientras tanto el Cierre y el Reporte dicen
   "Sin origen", que es correcto. **No es criterio de completitud de desarrollo.**
3. **Las cuatro preguntas para Operaciones están escritas** en
   `monitor-app/bugs/20260916/preguntas-abiertas-a-operaciones.md` (sí está en git, junto al
   documento original y al levantamiento). Las dos que pesan:
   - **La cara**: si *"dejar abierto el filtro de CD Origen para modificación"* quiso decir el
     **valor** y no el filtro, hay que **rediseñar**, no ajustar.
   - Qué hacer con los desvíos de la Sección 7. Proyectado con la sugerencia puesta: **4 sobre 354
     viajes (1,1%)** en 15 días, 2 conductores. ¿Información para mirar, o alerta?
4. **El cambio de conducta de los tiles** (ahora siguen al filtro) necesita su visto bueno.
5. **UAT del usuario**: el click-through lo hice yo sobre un conductor elegido por SQL y lo revertí al
   terminar. Falta el de Operaciones con datos que se queden.
6. Sigue de la Ronda 161: la UAT del cierre unificado, el congelamiento con tráfico real, la matriz de
   grupos de motivos, y la ola 4.4 (líneas TRIP) y ola 5 (retirar tablas viejas).
