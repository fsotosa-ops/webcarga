{{
    config(
        materialized='incremental',
        unique_key='id',
        incremental_strategy='merge',
        on_schema_change='sync_all_columns',
        merge_exclude_columns=[
            'observaciones', 'comentarios', 'fleet_link_id',
            'manually_edited_fields', 'edited_by', 'edited_at', 'created_at',
            'origin_region', 'origin_city',
            'cag_inicio_at', 'cag_fin_at', 'stop_manual_fields'
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
            "CREATE INDEX IF NOT EXISTS idx_trips_fleet_rut ON {{ this }} ((fleet->>'driver_rut_tms'))"
        ]
    )
}}

/*
  POST-HOOKS (PK / RLS / índices) — FIX DEFINITIVO del patrón recurrente:
  un --full-refresh hace DROP + CREATE TABLE AS SELECT, y la tabla nueva nace
  sin PK, sin RLS, sin políticas y sin índices (se perdieron 6 veces entre
  2026-05 y 2026-07, restauradas a mano cada vez: 20260618000001,
  20260702000005, 20260707000001). Los post-hooks re-aplican todo después de
  CADA corrida (idempotentes: IF NOT EXISTS / DROP POLICY IF EXISTS), así el
  full-refresh deja de ser destructivo para las protecciones.
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
  monitor-app/backend/supabase/migrations/20260702000002_protect_manual_overrides_trigger.sql):

  1. `merge_exclude_columns` (arriba): observaciones, comentarios,
     fleet_link_id, manually_edited_fields, edited_by, edited_at, created_at
     — el pipeline los incluye en el SELECT (para el INSERT inicial) pero
     dbt NUNCA los toca en el UPDATE del MERGE. Sin esto, cada corrida
     pisaría observaciones/comentarios reales con NULL y created_at con
     el timestamp de esa corrida — bug real detectado en una versión
     anterior de este archivo, donde el SELECT emitía NULL/now() para
     estas columnas en CADA fila, no solo en el INSERT.

  2. Trigger `app.protect_manual_overrides` (BEFORE UPDATE en app.trips):
     activo, trabajando, asignado, estado_manual, primera_vuelta SÍ están
     en el MERGE (el pipeline los recalcula cada corrida para reflejar el
     estado real del viaje — ver derivación abajo), pero el trigger
     revierte al valor anterior si ese campo específico está en
     manually_edited_fields (lo pone la API en el mismo UPDATE que cambia
     el valor, así que ese UPDATE puntual no se ve afectado — solo las
     corridas siguientes del pipeline quedan bloqueadas para ese campo).
     Estos campos deben reflejar por defecto lo que reporta la TMS, y solo
     quedar en manual cuando operaciones confirma algo distinto con el
     transportista (WhatsApp/llamada) o para viajes cargados a mano sin
     fuente TMS.

  DERIVACIÓN DE CAMPOS OPERATIVOS (valor por defecto, sobreescribible):
    - activo: true mientras el viaje no esté en un estado terminal
      (CERRADO* / CANCELADO / Declinada / Removida de sodimac) — mismo
      criterio que ya usa el watermark incremental más abajo.
    - asignado: true si la TMS ya reportó tractor o conductor (forzado a
      false para los estados pre-viaje de sodimac Creada/Aceptada/Control
      de salida).
    - trabajando: true si el estado normalizado indica movimiento activo
      (RUTA, EN LOCAL, RETORNANDO). SUPUESTO A CONFIRMAR: no hay una
      definición explícita de "trabajando" en el código existente más
      allá del toggle manual.

  SUPUESTO A CONFIRMAR (sodimac): Creada/Aceptada/Control de salida
  (~pre-viaje) y Declinada/Removida (~terminal) son 5 estados crudos de
  sodimac nunca mapeados a la lista canónica de app.trip_statuses (gap
  preexistente, no introducido en esta reescritura) — tratados aquí con
  default conservador hasta confirmar el significado real del flujo.

  WATERMARK:
    - Usa status_reported_at (file_generated_at del TMS)
    - No usa dbt_valid_from (timestamp técnico del pipeline, no de negocio)

  Validado contra la base real (2026-07-02) sobre silver.int_tms_trips_conformed
  ya desplegada: sin errores de tipo, planning_date resuelto para las 3 fuentes,
  milestone_status correctamente exclusivo de qanalytics (SAP no existe para
  sodimac — 0/323 filas con match de milestone, verificado), 1259 stops de
  qanalytics recuperan arrival_date vía fallback a milestone_actual_arrival_at,
  10 stops de wingsuite recuperan departure_date vía fallback a
  planned_departure_at, stops de wingsuite filtrados a solo action_type=DELIVERY
  (antes incluían la parada PICKUP/origen mezclada con las de entrega — caso
  verificado source_system_trip_id='398410'). Trigger de protección probado
  en vivo sobre una fila real.
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
        -- arrival_date: prioriza el arribo reportado por el TMS
        -- (actual_arrival_at); si falta, cae al arribo confirmado por SAP
        -- (milestone_actual_arrival_at, solo existe en paradas de qanalytics
        -- con match de milestone).
        -- departure_date: SOLO salida real (actual_departure_at) — nunca cae
        -- a la planificada. departure_date_prog (nuevo, 2026-07-03) guarda la
        -- salida planificada (planned_departure_at, solo existe en paradas de
        -- wingsuite) por separado, para que el frontend pueda distinguir "ya
        -- salió" de "todavía no sale, pero está planificado" — antes se
        -- coalesceaban en un solo campo ambiguo (bug reportado en Wingsuite).
        (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'stop_id',              md5(base.trip_id::text || COALESCE(elem->>'location_name', '') || (ord - 1)::text),
                    'local',                elem->>'location_name',
                    'destination_city',     elem->>'milestone_destination_city',
                    'destination_region',   elem->>'milestone_destination_region',
                    'on_time_status',       elem->>'milestone_on_time_status',
                    -- No hay status de cumplimiento por-parada en el contrato
                    -- nuevo (existe a nivel de viaje en trip_status/milestone_status).
                    'milestone_status',     NULL,
                    's2s',                  elem->>'custom_s2s',
                    'temperature',          NULLIF(elem->>'custom_temperature', '')::numeric,
                    'planning_date',        COALESCE(elem->>'planned_arrival_at', elem->>'actual_arrival_at'),
                    'arrival_date',         COALESCE(
                                                 NULLIF(elem->>'actual_arrival_at', '')::timestamptz,
                                                 NULLIF(elem->>'milestone_actual_arrival_at', '')::timestamptz
                                             ),
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
            FROM jsonb_array_elements(base.trip_stops) WITH ORDINALITY AS t(elem, ord)
        )                                                AS stops

    FROM base
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
    origin,
    -- origin_region / origin_city: ubicación complementaria asignada desde el
    -- Monitor (API) — el pipeline NUNCA las escribe (merge_exclude_columns
    -- arriba, mismo patrón que observaciones/comentarios). Solo el INSERT
    -- inicial las deja NULL; migración 20260709000001.
    NULL::text          AS origin_region,
    NULL::text          AS origin_city,
    -- cag_inicio_at / cag_fin_at (Carga Inicio/Fin, origen) y stop_manual_fields
    -- (override manual de Desc. Inicio/Fin por parada): mismo patrón que
    -- origin_region/origin_city — el pipeline nunca los escribe
    -- (merge_exclude_columns arriba). Esquema de fechas 2026-07-17,
    -- migración 20260717190246_trip_hybrid_date_fields.
    NULL::timestamptz   AS cag_inicio_at,
    NULL::timestamptz   AS cag_fin_at,
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
    COALESCE(
        trip_status NOT LIKE 'CERRADO%'
        AND trip_status NOT IN ('CANCELADO', 'Declinada', 'Removida'),
        false
    )                                                   AS activo,
    COALESCE(trip_status IN ('RUTA', 'EN LOCAL', 'RETORNANDO'), false)
                                                        AS trabajando,
    (
        COALESCE(trip_status NOT IN ('Creada', 'Aceptada', 'Control de salida'), true)
        AND (NULLIF(vehicle_plate, '') IS NOT NULL OR NULLIF(driver_name, '') IS NOT NULL)
    )                                                   AS asignado,
    false               AS primera_vuelta,
    NULL::varchar       AS estado_manual,

    -- ── Nunca tocados en UPDATE (merge_exclude_columns arriba) ────────────────
    NULL::text          AS observaciones,
    NULL::text          AS comentarios,
    ARRAY[]::text[]     AS manually_edited_fields,
    NULL::uuid          AS fleet_link_id,
    NULL::uuid          AS edited_by,
    NULL::timestamptz   AS edited_at,

    now()               AS created_at,
    now()               AS updated_at

FROM mapped

{% if is_incremental() %}
-- Watermark por source_system: cada TMS tiene su propio watermark
-- independiente. Sin esto, qanalytics (que corre más frecuente) sube el
-- watermark global y deja fuera los trips de wingsuite/sodimac con fechas
-- más antiguas.
WHERE status_reported_at > (
    SELECT COALESCE(MAX(status_reported_at), '1900-01-01')
    FROM {{ this }}
    WHERE source_system = mapped.source_system
)
-- OR 1: qanalytics sin origin → cumplimiento-SAP llegó después del watermark
OR (
    source_system = 'qanalytics'
    AND origin IS NOT NULL
    AND id IN (SELECT id FROM {{ this }} WHERE source_system = 'qanalytics' AND origin IS NULL)
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
    m.origin                                            AS origin,
    m.origin_region                                     AS origin_region,
    m.origin_city                                       AS origin_city,
    m.updated_at::timestamp                             AS status_reported_at,
    now()::timestamp                                    AS pipeline_updated_at,

    m.fleet                                             AS fleet,
    m.stops                                             AS stops,

    m.activo                                            AS activo,
    m.trabajando                                        AS trabajando,
    m.asignado                                          AS asignado,
    m.primera_vuelta                                    AS primera_vuelta,
    m.estado_manual::varchar                            AS estado_manual,

    m.observaciones                                     AS observaciones,
    m.comentarios                                       AS comentarios,
    m.manually_edited_fields                            AS manually_edited_fields,
    m.fleet_link_id                                     AS fleet_link_id,
    NULL::uuid                                          AS edited_by,
    NULL::timestamptz                                   AS edited_at,

    m.created_at                                        AS created_at,
    m.updated_at                                        AS updated_at

FROM app.trips_manual m
WHERE NOT EXISTS (SELECT 1 FROM mapped c WHERE c.id = m.id)
{% if is_incremental() %}
  -- Ya reconciliado en corridas anteriores: existe en app.trips como viaje TMS
  AND NOT EXISTS (
      SELECT 1 FROM {{ this }} t
      WHERE t.id = m.id AND t.source_system != 'manual'
  )
{% endif %}
