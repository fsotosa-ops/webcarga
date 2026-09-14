{{
    config(
        materialized='incremental',
        unique_key='id',
        incremental_strategy='merge',
        on_schema_change='sync_all_columns',
        merge_exclude_columns=[
            'notes', 'comments', 'fleet_link_id',
            'manually_edited_fields', 'edited_by', 'edited_at', 'created_at',
            'origin_region', 'origin_city',
            'stop_manual_fields',
            'unassigned_reason_id'
        ],
        schema='app',
        alias='trips',
        post_hook=[
            "ALTER TABLE {{ this }} ENABLE ROW LEVEL SECURITY",
            "DROP POLICY IF EXISTS trips_read ON {{ this }}",
            "CREATE POLICY trips_read ON {{ this }} FOR SELECT TO authenticated USING (true)",
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_schema = 'app' AND table_name = 'trips' AND constraint_type = 'PRIMARY KEY') THEN ALTER TABLE app.trips ADD PRIMARY KEY (id); END IF; END $$",
            "CREATE INDEX IF NOT EXISTS idx_trips_planning_date ON {{ this }} (planning_date)",
            "CREATE INDEX IF NOT EXISTS idx_trips_status ON {{ this }} (trip_status)",
            "CREATE INDEX IF NOT EXISTS idx_trips_fleet_link ON {{ this }} (fleet_link_id)",
            "CREATE INDEX IF NOT EXISTS idx_trips_fleet_plate ON {{ this }} ((fleet->>'tractor_plate'))",
            "CREATE INDEX IF NOT EXISTS idx_trips_fleet_driver ON {{ this }} ((fleet->>'driver_name_tms'))",
            "CREATE INDEX IF NOT EXISTS idx_trips_fleet_rut ON {{ this }} ((fleet->>'driver_rut_tms'))",
            "CREATE OR REPLACE FUNCTION app.protect_manual_overrides() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'app', 'pg_catalog' AS $function$ DECLARE cerrado_por_el_tms boolean; BEGIN cerrado_por_el_tms := EXISTS (SELECT 1 FROM app.trip_statuses s WHERE s.id = NEW.trip_status AND s.group_id = 'cerrado'); IF 'is_active' = ANY(OLD.manually_edited_fields) AND NOT cerrado_por_el_tms THEN NEW.is_active := OLD.is_active; END IF; IF 'is_working' = ANY(OLD.manually_edited_fields) AND NOT cerrado_por_el_tms THEN NEW.is_working := OLD.is_working; END IF; IF cerrado_por_el_tms THEN NEW.manually_edited_fields := array_remove(array_remove(NEW.manually_edited_fields, 'is_active'), 'is_working'); END IF; IF 'is_assigned' = ANY(OLD.manually_edited_fields) THEN NEW.is_assigned := OLD.is_assigned; END IF; IF 'manual_status' = ANY(OLD.manually_edited_fields) THEN NEW.manual_status := OLD.manual_status; END IF; IF 'is_first_leg' = ANY(OLD.manually_edited_fields) THEN NEW.is_first_leg := OLD.is_first_leg; END IF; RETURN NEW; END; $function$",
            "DROP TRIGGER IF EXISTS trg_protect_manual_overrides ON {{ this }}",
            "CREATE TRIGGER trg_protect_manual_overrides BEFORE UPDATE ON {{ this }} FOR EACH ROW EXECUTE FUNCTION app.protect_manual_overrides()",
            "DROP TRIGGER IF EXISTS trg_trips_resolve_fleet_ins ON {{ this }}",
            "CREATE TRIGGER trg_trips_resolve_fleet_ins AFTER INSERT ON {{ this }} REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION app.trg_resolve_trip_fleet()",
            "DROP TRIGGER IF EXISTS trg_trips_resolve_fleet_upd ON {{ this }}",
            "CREATE TRIGGER trg_trips_resolve_fleet_upd AFTER UPDATE ON {{ this }} REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION app.trg_resolve_trip_fleet()",
            "SELECT app.resolve_trip_fleet(array(SELECT t.id FROM app.trips t LEFT JOIN app.trip_fleet_links fl ON fl.trip_id = t.id WHERE fl.trip_id IS NULL))"
        ]
    )
}}

/*
  POST-HOOKS (PK / RLS / índices / trigger) — FIX DEFINITIVO del patrón
  recurrente: un --full-refresh hace DROP + CREATE TABLE AS SELECT, y la
  tabla nueva nace sin PK, sin RLS, sin políticas y sin índices (se
  perdieron 6 veces entre 2026-05 y 2026-07, restauradas a mano cada vez:
  20260618000001, 20260702000005, 20260707000001). Los post-hooks re-aplican
  todo después de CADA corrida (idempotentes: IF NOT EXISTS / DROP POLICY IF
  EXISTS / DROP TRIGGER IF EXISTS), así el full-refresh deja de ser
  destructivo para las protecciones.

  `protect_manual_overrides` (función + trigger) agregado al post_hook en la
  higienización 2026-07-17: se detectó que la función existía en DB pero sin
  ningún trigger adjunto a app.trips (pg_trigger vacío) — mismo patrón de
  pérdida por full-refresh que ya afectaba a PK/RLS/índices, nunca corregido
  para el trigger porque no estaba en esta lista. Ahora sí sobrevive.

  EL OVERRIDE MANUAL AHORA VENCE (2026-09-14). Hasta hoy la protección no
  tenía condición de salida: una vez que alguien tocaba "Activo"/"Trabajando"
  en el detalle del viaje, la API agregaba el campo a manually_edited_fields
  y este trigger lo congelaba PARA SIEMPRE. El TMS después cerraba el viaje,
  el pipeline intentaba apagar is_active, y el trigger lo revertía. Como la
  pestaña "En Curso" del Monitor es literalmente is_active = true, esos
  viajes no se iban nunca del tablero.

  Medido el 14/09 sobre los 2.124 viajes de QAnalytics en estado de cierre:
  2.120 pasaron al histórico solos y 4 quedaron trabados — los 4 con la marca
  sobre is_active (2048098, 2047773, 2048268 y 30159194, del 07-09, visibles
  en "En Curso" una semana después). No es casualidad: el pin es la causa.

  La regla nueva: cuando el estado entrante pertenece al grupo `cerrado` de
  app.trip_statuses, is_active/is_working dejan de estar protegidos y la
  marca se retira del array — el TMS sabe mejor que nadie si el viaje
  terminó, y una marca que no se retira vuelve a trabar el próximo viaje.

  Se liberan SÓLO esos dos. `is_assigned`, `manual_status` e `is_first_leg`
  siguen protegidos incluso con el viaje cerrado: responden "¿tomamos
  nosotros esta carga?", que es una corrección humana sobre algo que el TMS
  no sabe mejor. El grupo `problema` (Cancelado / En Pana / Devuelto / Sin
  Registros) NO libera: ahí el viaje todavía puede seguir vivo.

  OJO CON `NEW` vs `OLD` al retirar la marca. La primera versión hacía
  `NEW.manually_edited_fields := array_remove(OLD.manually_edited_fields, ...)`
  y eso PISA lo que el propio UPDATE acababa de escribir en esa columna: un
  `bulk_close_trips` sobre un viaje ya cerrado perdía su marca de
  `unassigned_reason_id`. Lo pescó `test_el_estado_del_tms_no_se_toca`, que
  elige una fila real de la base — el mismo test que este proyecto tiene
  anotado como frágil por elegir su sujeto sin ORDER BY, y que esta vez
  encontró un bug de verdad justo por eso.

  Va sobre `NEW` y es correcto en los dos caminos: el pipeline no escribe esa
  columna (está en `merge_exclude_columns`, así que NEW = OLD ahí), y la API
  sí la escribe, así que se le retiran los dos nombres a lo que ella mandó.

  `trg_trips_resolve_fleet_ins/upd` agregados 2026-08-17 (Capa 3 del modelo
  de resolución de flota, spec 2026-08-17-modelo-resolucion-flota-design.md).
  Llaman a app.resolve_trip_fleet(), que MATERIALIZA en app.trip_fleet_links
  quién manejó cada viaje. Antes eso se calculaba en cada lectura dentro de
  app.v_trip_fleet_resolution, y por eso corregir el nombre de un conductor
  cambiaba quién aparecía en un día ya cerrado.

  Son FOR EACH STATEMENT con tabla de transición, no FOR EACH ROW: este
  modelo materializa con `merge` en lotes de cientos de filas, y el
  resolvedor arma una tabla temporal por invocación.

  La última línea del post_hook resuelve los viajes que quedaron SIN vínculo.
  Es la red para el propio full-refresh: el CTAS inserta las filas ANTES de
  que el post_hook vuelva a crear el trigger, así que esas filas nunca lo
  dispararon. En régimen normal no cuesta nada — no hay viajes sin vínculo.
*/

/*
  app_trips → app.trips
  ──────────────────────
  Granularidad : 1 fila por viaje
  Fuente       : silver.int_tms_trips_conformed (is_current = true)

  Nomenclatura: app.trips usa el mismo vocabulario que int_tms_trips_conformed
  (source_system, source_client_id, source_system_id, source_system_trip_id,
  trip_status, milestone_status) — antes esta capa traducía a nombres ad hoc
  (tms_name, tms_id, tms_client_id, source_trip_id, current_status_tms,
  milestone_status_sap) que no eran agnósticos a la TMS y generaban una
  capa de traducción innecesaria en cada boundary (DB → API → frontend).
  Migración de rename: 20260702000003_rename_app_trips_columns.sql.

  Este modelo ya NO hace GROUP BY/jsonb_agg sobre filas por parada ni
  recomputa la normalización de vocabulario de estado (eso vive en
  int_tms_trips_conformed, único lugar). Solo remapea claves de trip_stops
  a la forma que espera el frontend (Trip/TripStop en lib/types.ts) y
  trips.py.

  PROTECCIÓN DE CAMPOS OPERATIVOS — dos niveles (ver
  monitor-app/backend/supabase/migrations/20260717220000_trip_hygiene_spanish_to_english_columns.sql,
  nombres renombrados de español a inglés en la higienización 2026-07-17):

  1. `merge_exclude_columns` (arriba): notes, comments,
     fleet_link_id, manually_edited_fields, edited_by, edited_at, created_at
     — el pipeline los incluye en el SELECT (para el INSERT inicial) pero
     dbt NUNCA los toca en el UPDATE del MERGE. Sin esto, cada corrida
     pisaría notes/comments reales con NULL y created_at con
     el timestamp de esa corrida — bug real detectado en una versión
     anterior de este archivo, donde el SELECT emitía NULL/now() para
     estas columnas en CADA fila, no solo en el INSERT.

  2. Trigger `app.protect_manual_overrides` (BEFORE UPDATE en app.trips,
     creado vía post_hook arriba): is_active, is_working, is_assigned,
     manual_status, is_first_leg SÍ están en el MERGE (el pipeline los
     recalcula cada corrida para reflejar el estado real del viaje — ver
     derivación abajo), pero el trigger revierte al valor anterior si ese
     campo específico está en manually_edited_fields (lo pone la API en el
     mismo UPDATE que cambia el valor, así que ese UPDATE puntual no se ve
     afectado — solo las corridas siguientes del pipeline quedan
     bloqueadas para ese campo). Estos campos deben reflejar por defecto
     lo que reporta la TMS, y solo quedar en manual cuando operaciones
     confirma algo distinto con el transportista (WhatsApp/llamada) o
     para viajes cargados a mano sin fuente TMS.

  DERIVACIÓN DE CAMPOS OPERATIVOS (valor por defecto, sobreescribible):
    - is_active: true mientras el viaje no esté en un estado terminal
      (CERRADO* / CANCELADO / Declinada / Removida de sodimac) — mismo
      criterio que ya usa el watermark incremental más abajo.
    - is_assigned: true si la TMS ya reportó tractor o conductor (forzado a
      false para los estados pre-viaje de sodimac Creada/Aceptada/Control
      de salida).
    - is_working: true si el estado normalizado indica movimiento activo
      (RUTA, EN LOCAL, RETORNANDO). SUPUESTO A CONFIRMAR: no hay una
      definición explícita de "is_working" en el código existente más
      allá del toggle manual.

  FIX 2026-08-02 (bug real reportado en vivo: viajes con >1000 horas
  "en local" en el Diario, ej. source_system_trip_id=1968333): QAnalytics a
  veces saca un viaje de su propia vista de "viajes activos" ANTES de
  reportar su cierre real — confirmado contra bronze.tms_trips_snapshot
  para el caso 1968333, el último trip_status real fue "EN LOCAL" el
  18/05, sin ningún cambio posterior. Como is_active nunca exigía
  recencia, el viaje quedaba is_active=true para siempre (no hay forma de
  recuperar el cierre real — la fuente nunca lo reportó). Confirmado con
  datos reales: de los viajes is_active=true en producción, 93% (698/751)
  no tenían reporte en más de 30 días, y solo ~5% en menos de 7 — split
  prácticamente binario, sin zona gris real. Ahora is_active (e
  is_working, mismo problema) exige además que status_reported_at sea
  reciente (≤7 días) — umbral elegido porque ningún viaje doméstico
  legítimo debería pasar una semana sin ningún reporte del TMS.

  EXCEPCIÓN CONFIRMADA (sodimac, 2026-08-02, aclarado por el usuario): el
  requisito de recencia de arriba NO aplica a Sodimac (macro
  is_live_tracked_source, lista en dbt_project.yml var
  live_tracked_sources). Sodimac da de alta el viaje en "ASIGNADO" para que
  WebCarga lo pueda operar; "Aceptada" es cuando el operador ya validó un
  conductor disponible — desde ahí el seguimiento pasa a gestión interna de
  WebCarga y el trip_status crudo de Sodimac puede dejar de actualizarse
  aunque el viaje siga vigente. Aplicarle el mismo requisito de recencia
  habría marcado como inactivos viajes reales todavía en curso (58 casos
  reales en "ASIGNADO"/"Aceptada" con 30+ días sin reporte, confirmados
  contra producción). Ver docs/casuistica-negocio-diario.md.

  Estados crudos de Sodimac (Creada/Aceptada/Control de salida/ASIGNADO
  ~pre-viaje-o-en-gestión-interna, Despachada ~en curso, Declinada/Removida
  ~terminal) siguen sin mapear a app.trip_statuses (gap preexistente) —
  tratados con default conservador hasta que Fabián confirme el mapeo
  exacto (insumo pendiente, ver HU Cierre del Día §8).

  WATERMARK:
    - Usa status_reported_at (file_generated_at del TMS)
    - No usa dbt_valid_from (timestamp técnico del pipeline, no de negocio)

  Validado contra la base real (2026-07-02) sobre silver.int_tms_trips_conformed
  ya desplegada: sin errores de tipo, planning_date resuelto para las 3 fuentes,
  milestone_status correctamente exclusivo de qanalytics (SAP no existe para
  sodimac — 0/323 filas con match de milestone, verificado), 1259 stops de
  qanalytics recuperan arrival_date vía fallback a milestone_actual_arrival_at,
  10 stops de wingsuite recuperan departure_date vía fallback a
  planned_departure_at. Trigger de protección probado en vivo sobre una fila real.

  CORRECCIÓN 2026-07-18: el párrafo original acá decía "stops de wingsuite
  filtrados a solo action_type=DELIVERY (antes incluían la parada
  PICKUP/origen mezclada... caso verificado source_system_trip_id='398410')"
  — ese filtro NUNCA existió en este modelo (la subquery de `stops` abajo no
  tiene ningún WHERE por action_type, y de hecho descarta la key
  `action_type`/`raw_action_type` en el remapeo, así que ni siquiera se podía
  filtrar acá con la información disponible). Confirmado como regresión real
  y corregido en la fuente: dbt/tms/models/silver/stg_wingsuite_trips.sql
  ahora excluye accion='Carga' del jsonb_agg de `trip_stops` — este modelo no
  necesita ningún cambio porque nunca vuelve a ver una fila PICKUP.
*/

WITH base AS (
    SELECT *
    FROM {{ ref('int_tms_trips_conformed') }}
    WHERE is_current = true
),

mapped AS (
    SELECT
        -- ── Identidad (mismos nombres que int_tms_trips_conformed) ────────────
        trip_id                                         AS id,
        source_system_trip_id,
        source_system_id,
        source_client_id,
        source_system,
        client_name,

        -- trip_status_normalized ya viene homologado desde int_tms_trips_conformed
        -- (único lugar donde vive esa lógica).
        trip_status_normalized                          AS trip_status,

        -- SAP/cumplimiento es EXCLUSIVO de qanalytics — verificado contra la
        -- base real: silver.tms_milestone_trips solo contiene
        -- source_system='qanalytics' (0 filas de otro TMS). stg_sodimac_trips.sql
        -- tiene un LEFT JOIN a milestones estructuralmente igual al de
        -- qanalytics, pero nunca matchea nada (0/323 filas con
        -- milestone_destination_city no-nulo) porque no existen registros SAP
        -- de sodimac — no es una fuente con datos SAP "vacíos por ahora", es
        -- una fuente que estructuralmente no tiene esa integración. El
        -- contrato de stg_* ya no expone un status de cumplimiento separado
        -- del status Monitor (se coalescen en staging, capa congelada, no
        -- recuperable por separado) — para qanalytics se refleja aquí el
        -- mismo trip_status ya mezclado.
        CASE WHEN source_system = 'qanalytics' THEN trip_status ELSE NULL END
                                                          AS milestone_status,

        cargo_type,

        -- planning_date: planned_departure_at cubre qanalytics/wingsuite;
        -- sodimac no reporta planned_departure_at a nivel de viaje, se cae
        -- al planned_arrival_at de su único stop (campo FECHA del TMS).
        COALESCE(
            planned_departure_at::date,
            (trip_stops->0->>'planned_arrival_at')::date,
            (trip_stops->0->>'actual_arrival_at')::date
        )                                                AS planning_date,

        origin_location_name                             AS origin,

        -- ── Timestamps de negocio ────────────────────────────────────────────
        file_generated_at                                AS status_reported_at,
        dbt_valid_from                                   AS pipeline_updated_at,

        -- ── Bloque de flota tal como lo reportó el TMS (inmutable) ───────────
        jsonb_build_object(
            'driver_name_tms',       driver_name,
            'driver_rut_tms',        driver_document_id,
            'transporter_name_tms',  carrier_name,
            'tractor_plate',         vehicle_plate,
            'trailer_plate',         trailer_plate
        )                                                AS fleet_obj,
        driver_name,
        vehicle_plate,

        -- ── Stops: remapeo de claves de trip_stops (int_tms_trips_conformed)
        --    a la forma que esperan trips.py / lib/types.ts (TripStop) ────────
        -- arrival_date: SOLO lo que reporta el TMS (actual_arrival_at) — ya no
        -- cae a milestone_actual_arrival_at (confirmación SAP). FIX 2026-07-31:
        -- ese fallback hacía que "Llegada TR" mostrara casi siempre el mismo
        -- valor que "GPS Llegada" (3325 de 4356 paradas reales de QAnalytics/
        -- walmart, 93% de las paradas donde el fallback disparaba) porque la
        -- confirmación SAP coincide casi siempre con el GPS — Llegada TR es
        -- híbrido (TMS o carga manual en el Diario), nunca debe heredar un
        -- tercer sistema (SAP). Si QAnalytics no reporta FH Llegada Tr,
        -- arrival_date queda NULL/editable, no auto-poblado.
        -- departure_date: SOLO salida real (actual_departure_at) — nunca cae
        -- a la planificada. departure_date_prog (nuevo, 2026-07-03) guarda la
        -- salida planificada (planned_departure_at, solo existe en paradas de
        -- wingsuite) por separado, para que el frontend pueda distinguir "ya
        -- salió" de "todavía no sale, pero está planificado" — antes se
        -- coalesceaban en un solo campo ambiguo (bug reportado en Wingsuite).
        (
            SELECT jsonb_agg(
                jsonb_build_object(
                    -- FIX 2026-07-28 (bug real: locales duplicados en el detalle
                    -- del viaje): antes stop_id incluía (ord - 1), el índice del
                    -- stop dentro del array de trip_stops. Ese array se ordena en
                    -- stg_qanalytics_trips.sql por raw_llegada_tr ASC NULLS LAST —
                    -- un stop sin llegada todavía ordena al final; en cuanto llega,
                    -- salta antes en el array. Eso cambiaba `ord` para stops que NO
                    -- cambiaron de identidad real, generando stop_id nuevos y filas
                    -- huérfanas en app.trip_stops (75 pares trip_id/stop_order
                    -- duplicados confirmados en producción, ver AGENTLOG.md Ronda
                    -- 58). El nombre del local (`location_name`) es el único campo
                    -- realmente estable por parada en el payload crudo de
                    -- QAnalytics (no hay un ID de parada propio de la TMS) — se usa
                    -- solo eso como identidad. Riesgo aceptado: un viaje que
                    -- visitara el mismo local dos veces colapsaría en una sola
                    -- fila — no observado en los 75 casos reales revisados.
                    -- FIX 2026-07-31 (bug real: duplicate key en trip_stops_pkey,
                    -- viaje IANSA IA152891): el riesgo aceptado arriba se
                    -- manifestó tal cual — el viaje visita el mismo local
                    -- ("ALVI Sucursal Rancagua - 5100266") dos veces, dos
                    -- entregas distintas. md5(trip_id + location_name) colapsaba
                    -- ambas al mismo stop_id, violando la PK al insertar.
                    -- Fix: solo cuando el nombre se repite dentro del MISMO
                    -- viaje (count(*) > 1 en la partición), se agrega un sufijo
                    -- posicional (row_number, no `ord` crudo) para desambiguar.
                    -- La inmensa mayoría de paradas (nombre único por viaje)
                    -- mantiene EXACTAMENTE el hash de antes — ningún stop_id
                    -- existente en app.trip_stops cambia. Para el caso raro de
                    -- nombre repetido no hay forma de preservar una identidad
                    -- estable entre corridas de todos modos (QAnalytics no da
                    -- un ID de parada propio) — se acepta que row_number pueda
                    -- reasignarse entre las paradas duplicadas si su orden
                    -- relativo cambia, mejor que romper el pipeline entero.
                    -- FIX 2026-08-01: Postgres no permite una función de ventana
                    -- (count()/row_number() OVER) anidada dentro de los argumentos
                    -- de una función agregada (jsonb_agg) — "aggregate function
                    -- calls cannot contain window function calls", confirmado en
                    -- vivo (run_id 7600). stop_id_computed se resuelve en la
                    -- subquery de más abajo (columna plana, sin agregado
                    -- envolvente) y acá solo se referencia.
                    'stop_id',              stop_id_computed,
                    'local',                elem->>'location_name',
                    'destination_city',     elem->>'milestone_destination_city',
                    'destination_region',   elem->>'milestone_destination_region',
                    'on_time_status',       elem->>'milestone_on_time_status',
                    -- No hay status de cumplimiento por-parada en el contrato
                    -- nuevo (existe a nivel de viaje en trip_status/milestone_status).
                    'milestone_status',     NULL,
                    's2s',                  elem->>'custom_s2s',
                    -- delivery_numbers: array de nº de entrega de la parada.
                    -- Solo IANSA lo reporta hoy (NULL para el resto, igual que
                    -- cualquier campo propio de una TMS). Una parada puede
                    -- tener varias entregas — es un ARRAY, no un escalar (caso
                    -- real IA153281: 3 entregas al mismo local). Lo usan
                    -- Operaciones y Facturación.
                    'delivery_numbers',     elem->'custom_delivery_numbers',
                    'temperature',          NULLIF(elem->>'custom_temperature', '')::numeric,
                    -- FIX 2026-08-07: antes caía a `actual_arrival_at` cuando
                    -- no había cita por parada. Eso no era una planificación:
                    -- era la llegada REAL mostrada en la columna "Plan.".
                    -- Verificado en producción: de 3087 destinos de Walmart,
                    -- 2775 quedaban NULL y los otros 312 eran exactamente una
                    -- copia de la llegada — CERO tenían una fecha planificada
                    -- distinta, o sea el fallback nunca aportó información,
                    -- solo la disfrazó.
                    --
                    -- Decisión de negocio (Operaciones, 2026-08-07): la
                    -- planificación de un viaje vive UNA vez, en su origen
                    -- (`planned_departure_at` → parada ORIGIN); los destinos
                    -- dependen de ese inicio y no la duplican. Si una TMS sí
                    -- reporta cita por destino (IANSA: 'FH Planificada'), se
                    -- muestra la real. Si no la reporta (Monitor de Viajes de
                    -- Walmart), la columna queda vacía en vez de mentir.
                    -- Misma clase que el bug 1.1A de Sodimac.
                    'planning_date',        NULLIF(elem->>'planned_arrival_at', '')::timestamptz,
                    'arrival_date',         NULLIF(elem->>'actual_arrival_at', '')::timestamptz,
                    -- departure_date: SOLO salida real (actual_departure_at) — ya no cae a
                    -- la planificada. Antes ese fallback dejaba departure_date ambiguo (no se
                    -- podía distinguir "ya salió" de "todavía no sale, pero está planificado"),
                    -- lo que el frontend no podía comunicar bien (bug reportado 2026-07-03 en
                    -- Wingsuite). La planificada ahora vive en su propio campo, ver abajo.
                    'departure_date',       NULLIF(elem->>'actual_departure_at', '')::timestamptz,
                    -- departure_date_prog: salida PLANIFICADA — solo existe en paradas de
                    -- Wingsuite (único TMS que reporta esto por separado). NULL para
                    -- qanalytics/sodimac, igual que cualquier otro campo específico de una TMS.
                    -- Consumido por describeStopTiming() en el frontend (lib/utils/temperature.ts)
                    -- para mostrar "sale ~HH:MM" cuando todavía no hay salida real.
                    'departure_date_prog',  NULLIF(elem->>'planned_departure_at', '')::timestamptz,
                    'gps_arrival_date',     NULLIF(elem->>'custom_gps_arrival_at', '')::timestamptz,
                    'gps_departure_date',   NULLIF(elem->>'custom_gps_departure_at', '')::timestamptz,
                    'unload_start',         NULLIF(elem->>'custom_unload_start_at', '')::timestamptz,
                    'unload_end',           NULLIF(elem->>'custom_unload_end_at', '')::timestamptz
                )
                ORDER BY ord
            )
            FROM (
                SELECT
                    elem, ord,
                    (CASE
                        WHEN count(*) OVER (PARTITION BY COALESCE(elem->>'location_name', '')) > 1
                        THEN md5(base.trip_id::text || COALESCE(elem->>'location_name', '') || '#' ||
                                 (row_number() OVER (PARTITION BY COALESCE(elem->>'location_name', '') ORDER BY ord))::text)
                        ELSE md5(base.trip_id::text || COALESCE(elem->>'location_name', ''))
                    END) AS stop_id_computed
                FROM jsonb_array_elements(base.trip_stops) WITH ORDINALITY AS t(elem, ord)
            ) AS stops_with_id
        )                                                AS stops

    FROM base
),

-- Corte de datos históricos (2026-08-03, pedido explícito del usuario):
-- app.trips solo considera viajes desde `start_date` en adelante — reusa el
-- var `start_date` que dbts/app_trips_update.yaml ya pasaba sin usar
-- (`--vars '{"start_date": "2026-07-01"}'`, vestigial hasta ahora). Default
-- '1900-01-01' si algún día se corre este modelo fuera de ese comando
-- (dbt run directo), para no romper por var faltante.
filtered AS (
    SELECT * FROM mapped
    WHERE planning_date >= '{{ var("start_date", "1900-01-01") }}'::date
)

SELECT
    -- ── Identidad ────────────────────────────────────────────────────────────
    id,
    source_system_trip_id,
    source_system_id,
    source_client_id,
    source_system,
    client_name,
    -- origin_tms: solo aplica a viajes manuales (sistema de origen declarado
    -- al registrarlos) — NULL para todo lo que viene de una TMS integrada.
    NULL::text          AS origin_tms,

    -- ── Estado (pipeline, inmutable) ─────────────────────────────────────────
    trip_status,
    milestone_status,
    cargo_type,
    planning_date,
    -- origin/cag_inicio_at/cag_fin_at REMOVIDOS del output (Fase 1, cutover
    -- final del origen unificado como parada 0, 2026-07-18) — `origin` (el
    -- alias de mapped.origin_location_name) sigue viviendo dentro de la CTE
    -- `mapped` de arriba, sin exponerse acá, porque el watermark
    -- incremental de más abajo ("OR 1") todavía lo necesita para detectar
    -- cumplimiento SAP que llega después. El nombre de origen ahora lo
    -- resuelve trips.py (_attach_origin) desde app.trip_stops.
    --
    -- origin_region / origin_city: ubicación complementaria asignada desde el
    -- Monitor (API) — el pipeline NUNCA las escribe (merge_exclude_columns
    -- arriba, mismo patrón que notes/comments). Solo el INSERT
    -- inicial las deja NULL; migración 20260709000001.
    NULL::text          AS origin_region,
    NULL::text          AS origin_city,
    '{}'::jsonb         AS stop_manual_fields,
    status_reported_at,
    pipeline_updated_at,

    -- ── Flota TMS (pipeline, inmutable) ──────────────────────────────────────
    fleet_obj                                          AS fleet,

    -- ── Stops (pipeline, inmutable) ──────────────────────────────────────────
    stops,

    -- ── Campos operacionales: derivados por defecto, protegidos por el
    --    trigger app.protect_manual_overrides si están en manually_edited_fields.
    -- COALESCE a false: filas de qanalytics_sap_only sin trip_status en
    -- absoluto (gap real de datos SAP) — un boolean NULL en un toggle de
    -- UI es más riesgoso que un false explícito.
    --
    -- FIX 2026-08-02: se agrega el requisito de recencia (status_reported_at
    -- ≤7 días) — sin esto, un viaje que QAnalytics deja de reportar sin
    -- avisar su cierre real quedaba is_active=true/is_working=true para
    -- siempre (ver nota extendida más arriba). El backfill de los viajes ya
    -- existentes lo hace el OR 3 del watermark incremental más abajo, no
    -- este COALESCE por sí solo (un viaje viejo nunca vuelve a pasar por acá
    -- si no lo re-selecciona el WHERE incremental).
    --
    -- El requisito de recencia SOLO aplica a fuentes de seguimiento en vivo
    -- (macro is_live_tracked_source, lista en dbt_project.yml) — Sodimac
    -- queda afuera a propósito: su seguimiento pasa a gestión manual interna
    -- de WebCarga apenas el viaje se acepta ("Aceptada"), así que el estado
    -- crudo puede dejar de actualizarse sin que eso signifique abandono (ver
    -- docs/casuistica-negocio-diario.md).
    COALESCE(
        trip_status NOT LIKE 'CERRADO%'
        AND trip_status NOT IN ('CANCELADO', 'Declinada', 'Removida')
        AND (
            NOT {{ is_live_tracked_source('source_system') }}
            OR status_reported_at > now() - interval '7 days'
        ),
        false
    )                                                   AS is_active,
    COALESCE(
        trip_status IN ('RUTA', 'EN LOCAL', 'RETORNANDO')
        AND (
            NOT {{ is_live_tracked_source('source_system') }}
            OR status_reported_at > now() - interval '7 days'
        ),
        false
    )                                                   AS is_working,
    (
        COALESCE(trip_status NOT IN ('Creada', 'Aceptada', 'Control de salida'), true)
        AND (NULLIF(vehicle_plate, '') IS NOT NULL OR NULLIF(driver_name, '') IS NOT NULL)
    )                                                   AS is_assigned,
    false               AS is_first_leg,
    NULL::varchar       AS manual_status,

    -- ── Nunca tocados en UPDATE (merge_exclude_columns arriba) ────────────────
    NULL::text          AS notes,
    NULL::text          AS comments,
    -- unassigned_reason_id (motivo de no asignación, Fase 1.5d): mismo
    -- patrón que notes/comments — solo lo setea el operador
    -- desde la API, el pipeline nunca lo escribe.
    -- Tipo uuid desde Ronda 43 (migración status_taxonomies,
    -- 20260722040000): antes referenciaba app.unassigned_reasons(id) (text),
    -- ahora app.status_taxonomies(id) (uuid) — coordinado con esa migración,
    -- ambos lados del UNION ALL de abajo deben resolver al mismo tipo.
    NULL::uuid          AS unassigned_reason_id,
    ARRAY[]::text[]     AS manually_edited_fields,
    NULL::uuid          AS fleet_link_id,
    NULL::uuid          AS edited_by,
    NULL::timestamptz   AS edited_at,

    now()               AS created_at,
    now()               AS updated_at

FROM filtered

{% if is_incremental() %}
-- Watermark por (source_system, client_name): cada TMS **y cada cliente**
-- tiene su propio watermark independiente. Sin esto, el TMS/cliente que corre
-- más frecuente sube el watermark y deja fuera a los demás con fechas más
-- antiguas.
--
-- El nivel `client_name` se agregó el 2026-08-07: el watermark era solo por
-- source_system y walmart (1093 viajes, scrape continuo) tapaba a iansa
-- dentro del MISMO source_system='qanalytics'. Al repoblar IANSA desde cero
-- entraron 6 de 88 viajes — los únicos cuyo archivo era más nuevo que el
-- último scrape de Walmart. Es exactamente el mismo razonamiento que ya
-- justificaba separar por source_system, un nivel más fino.
WHERE status_reported_at > (
    SELECT COALESCE(MAX(status_reported_at), '1900-01-01')
    FROM {{ this }}
    WHERE source_system = filtered.source_system
      AND client_name   = filtered.client_name
)
-- OR 1: qanalytics sin origen aún resuelto → cumplimiento-SAP llegó después
-- del watermark. FIX 2026-07-18 (cutover final del origen unificado): antes
-- comparaba contra app.trips.origin IS NULL (columna eliminada); ahora
-- contra si ya existe la parada ORIGIN en app.trip_stops — mismo criterio,
-- consistente con que esa tabla es la única fuente de verdad del origen.
OR (
    source_system = 'qanalytics'
    AND origin IS NOT NULL
    AND id IN (
        SELECT t2.id FROM {{ this }} t2
        WHERE t2.source_system = 'qanalytics'
          AND NOT EXISTS (
              SELECT 1 FROM app.trip_stops ts WHERE ts.trip_id = t2.id AND ts.stop_type = 'ORIGIN'
          )
    )
)
-- OR 2: qanalytics con status de cumplimiento CERRADO/CANCELADO que aún no
-- se actualizó en app.trips
OR (
    source_system = 'qanalytics'
    AND (milestone_status LIKE 'CERRADO%' OR milestone_status = 'CANCELADO')
    AND id IN (
        SELECT id FROM {{ this }}
        WHERE source_system = 'qanalytics'
          AND trip_status NOT LIKE 'CERRADO%'
          AND trip_status != 'CANCELADO'
    )
)
-- OR 3 (2026-08-02, backfill del FIX de is_active/is_working de arriba):
-- viajes que HOY están is_active=true en app.trips pero cuyo último
-- reporte real ya pasó el umbral de recencia (>7 días) — deben
-- re-evaluarse contra la regla nueva aunque su status_reported_at no haya
-- cambiado. Sin este OR, el watermark por source_system de arriba nunca
-- los volvería a seleccionar (su propio status_reported_at ya quedó más
-- viejo que el watermark de su fuente) y quedarían is_active=true para
-- siempre, sin importar cuántas veces se ajuste la fórmula. Restringido a
-- fuentes de seguimiento en vivo (mismo criterio que el COALESCE de
-- arriba) — Sodimac no entra acá, su staleness no significa abandono.
--
-- FIX 2026-08-02 (bis, mismo día): "status_reported_at < now() - interval
-- '7 days'" NO capturaba las filas con status_reported_at NULL (7 viajes
-- reales de wingsuite, planning_date de abril-junio) — una comparación con
-- NULL nunca es true, así que esas filas nunca volvían a pasar por el
-- watermark y quedaron con su is_active=true de ANTES del fix (evidencia:
-- manually_edited_fields=[] y updated_at sin cambios desde antes de esta
-- ronda — nunca las tocó el run que corrigió las otras ~698). NULL es al
-- menos tan "no reciente" como una fecha vieja, así que entra al mismo OR.
OR id IN (
    SELECT id FROM {{ this }}
    WHERE is_active = true
      AND {{ is_live_tracked_source('source_system') }}
      AND (status_reported_at < now() - interval '7 days' OR status_reported_at IS NULL)
)
-- OR 4 (Ronda 142, multiorigen de Sodimac): el viaje DECLARA más orígenes de
-- los que tiene materializados en app.trip_stops.
--
-- Misma escotilla y mismo razonamiento que OR 1 y OR 3: un viaje viejo queda
-- por debajo del watermark de `status_reported_at` y no vuelve a entrar NUNCA,
-- así que si su segunda parada de carga no llegó a la tabla, ninguna corrida lo
-- arregla solo. Medido al aparecer: al habilitar el multiorigen, 4 viajes de
-- julio/agosto se quedaron con UNA fila ORIGIN mientras el conformado ya
-- declaraba DOS, y el test `assert_trip_stops_no_aplana_los_origenes` ponía el
-- bloque en rojo en cada corrida sin que hubiera forma de destrabarlo.
--
-- SE APAGA SOLO: en cuanto `app/trip_stops` materializa las filas que faltan,
-- la condición deja de cumplirse y el viaje sale del incremental. Esa es la
-- diferencia con un backfill a mano — la escotilla sana exactamente lo que el
-- test marca, y ninguno de los dos queda encendido cuando el dato está bien.
--
-- EXIGE al menos UNA fila ORIGIN ya materializada, a propósito. Sin ese
-- requisito entraban también 2 viajes de qanalytics con CERO filas ORIGIN, que
-- son otro hueco —no "el modelo aplanó los tramos" sino "este viaje no tiene
-- origen"— y que ya tiene su propia escotilla en OR 1. Con `> 0` la condición
-- se apagaría sola; sin él, un viaje que no puede resolver su origen reentra en
-- cada corrida para siempre.
OR id IN (
    SELECT c.trip_id
    FROM {{ ref('int_tms_trips_conformed') }} c
    WHERE c.is_current = true
      AND c.origin_locations IS NOT NULL
      AND EXISTS (
          SELECT 1 FROM app.trip_stops ts
          WHERE ts.trip_id = c.trip_id AND ts.stop_type = 'ORIGIN'
      )
      AND jsonb_array_length(c.origin_locations) > (
          -- Se mide por ÓRDENES DISTINTOS, no por filas, y cubre los DOS
          -- síntomas con una sola condición: "falta el segundo origen" (1 fila)
          -- y "los dos están en el mismo stop_order" (2 filas que el dedupe del
          -- backend colapsa a una, así que la pantalla sigue mostrando uno).
          -- Este último es el estado en que quedaron 3 viajes de cuando el
          -- modelo leía una posición del arreglo.
          --
          -- Y es lo que evita que la escotilla se quede encendida: el huérfano
          -- del viaje 830021 —dos filas ORIGIN, un solo origen declarado— NO
          -- entra, porque su cuenta de órdenes distintos ya iguala lo
          -- declarado. Con `count(*)` habría reentrado en cada corrida para
          -- siempre, porque esa fila no se borra a propósito (es historial).
          SELECT count(DISTINCT ts.stop_order) FROM app.trip_stops ts
          WHERE ts.trip_id = c.trip_id AND ts.stop_type = 'ORIGIN'
      )
)
{% endif %}

UNION ALL

-- ── Viajes manuales (app.trips_manual, escrita por la API del Monitor) ───────
-- Fuente de verdad de los viajes registrados a mano (registro único + carga
-- masiva CSV). Esta rama los RECONSTRUYE en cada corrida — antes de existir,
-- un --full-refresh los borraba definitivamente (vivían solo en app.trips).
--
-- Anti-join por id: si el viaje manual usó id canónico
-- md5(origin_tms|cliente|trip_id) (mismo que stg_*_trips) y la TMS ya lo
-- reportó, gana la rama TMS — reconciliación automática, sin duplicados.
SELECT
    m.id,
    m.source_system_trip_id::varchar                    AS source_system_trip_id,
    NULL::uuid                                          AS source_system_id,
    NULL::uuid                                          AS source_client_id,
    'manual'::varchar                                   AS source_system,
    m.client_name::varchar                              AS client_name,
    m.origin_tms                                        AS origin_tms,

    m.trip_status                                       AS trip_status,
    NULL::text                                          AS milestone_status,
    m.cargo_type::varchar                               AS cargo_type,
    m.planning_date                                     AS planning_date,
    -- origin/cag_inicio_at/cag_fin_at removidos (Fase 1, cutover final,
    -- 2026-07-18) — mismo motivo que la rama TMS de arriba: app.trips_manual
    -- ya no tiene estas columnas, el origen del viaje manual se inserta
    -- directo en app.trip_stops al crearlo (_insert_trip_stops en trips.py).
    m.origin_region                                     AS origin_region,
    m.origin_city                                       AS origin_city,
    '{}'::jsonb                                         AS stop_manual_fields,
    m.updated_at::timestamp                             AS status_reported_at,
    now()::timestamp                                    AS pipeline_updated_at,

    m.fleet                                             AS fleet,
    m.stops                                             AS stops,

    m.is_active                                         AS is_active,
    m.is_working                                        AS is_working,
    m.is_assigned                                       AS is_assigned,
    m.is_first_leg                                      AS is_first_leg,
    m.manual_status::varchar                            AS manual_status,

    m.notes                                             AS notes,
    m.comments                                          AS comments,
    m.unassigned_reason_id                              AS unassigned_reason_id,
    m.manually_edited_fields                            AS manually_edited_fields,
    m.fleet_link_id                                     AS fleet_link_id,
    NULL::uuid                                          AS edited_by,
    NULL::timestamptz                                   AS edited_at,

    m.created_at                                        AS created_at,
    m.updated_at                                        AS updated_at

FROM app.trips_manual m
WHERE NOT EXISTS (SELECT 1 FROM mapped c WHERE c.id = m.id)
  AND m.planning_date >= '{{ var("start_date", "1900-01-01") }}'::date
{% if is_incremental() %}
  -- Ya reconciliado en corridas anteriores: existe en app.trips como viaje TMS
  AND NOT EXISTS (
      SELECT 1 FROM {{ this }} t
      WHERE t.id = m.id AND t.source_system != 'manual'
  )
{% endif %}
