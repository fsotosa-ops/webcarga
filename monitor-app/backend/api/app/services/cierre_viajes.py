"""Los cuatro grupos del paso "Viajes" del Cierre (spec §6.1).

UNA sola definicion. La Ronda 123 cerro cuatro defectos de conteo que existian
porque "el universo de viajes del dia" esta escrito a mano en 14 lugares; esta
no nace repetida.

Los tres primeros grupos salen de columnas que ya existen y estan pobladas:
`app_trips.sql` deriva is_assigned como
  trip_status NOT IN ('Creada','Aceptada','Control de salida') AND (patente O conductor)
que es literalmente la definicion que dio Pablo.

El cuarto NO se deriva de is_active, y ese es el punto: is_active exige que el
TMS haya reportado en los ultimos 7 dias, asi que un viaje que QAnalytics
abandona sin cerrar sale solo del Monitor justo cuando empieza a importar —
sin cierre en el TMS no llega la orden de compra. Es la regla 5 de Pablo.
"""

# Sin confirmar con operaciones (spec §11 item 5). Empata con el umbral de
# recencia de is_active a proposito: por debajo de eso el viaje sigue vivo en
# el Monitor y no hay nada que declarar.
DIAS_SIN_NOVEDAD = 7

# `problema` queda afuera a proposito: mezcla Cancelado y Sin Registros
# (terminales) con En Pana (que no lo es). Medido el 2026-08-18, excluirlo no
# cuesta nada — ninguna fila En Pana supera los 7 dias. Separar esa mezcla es
# un arreglo de catalogo, no de este servicio.
GRUPOS_NO_TERMINALES = ("en_ruta", "retornando", "en_local", "otro")

# El universo del dia "posterior al cierre" (Importante 4, revision de rama
# 2026-08-18): app/routers/daily_closures.py lo necesitaba en DOS lugares
# (guardar total_trips al firmar, y volver a contarlo despues para el delta)
# y las dos veces estaba escrito a mano. Un solo lugar, consumido por los dos.
SQL_TOTAL_TRIPS_DEL_DIA = "SELECT count(*) FROM app.trips WHERE planning_date = $1"

SQL_BASE = """    SELECT t.id AS trip_id, t.planning_date,
           -- El nombre prolijo, no el crudo del TMS. Visto en pantalla el
           -- 14/09: esta pestana mostraba "walmart"/"sodimac" en minusculas
           -- mientras "Flota del dia" -que resuelve por public.shippers-
           -- mostraba "Walmart" en la columna que se llama IGUAL. La misma
           -- columna diciendo dos cosas distintas segun la pestana.
           COALESCE(sh.name, t.client_name) AS client_name,
           t.source_system_trip_id, t.trip_status, t.unassigned_reason_id,
           t.is_active, t.is_assigned,
           round((EXTRACT(EPOCH FROM (now() - t.status_reported_at)) / 86400)::numeric, 1)
               AS dias_sin_novedad,
           s.group_id,
           -- Contexto del Monitor (HU-D2, minuta 02/10): con el número solo,
           -- el coordinador copiaba el ID e iba a buscarlo al Monitor. Mismas
           -- expresiones que _TRIP_SELECT (routers/trips.py): primero el dato
           -- resuelto contra el maestro, después el vínculo, después el TMS.
           t.source_system,
           COALESCE(ta.license_plate, fl.tractor_plate, t.fleet->>'tractor_plate') AS tractor_plate,
           COALESCE(d.full_name, fl.driver_name_raw, t.fleet->>'driver_name_tms')  AS driver_name,
           COALESCE(c.business_name, t.fleet->>'transporter_name_tms')             AS carrier_name,
           -- D4 (minuta 02/10): la reconciliación diaria marcó que el TMS ya no lo
           -- trae (dbt: stg_tms_presence → app.trips), y el catálogo de estados
           -- dice qué significa:
           --   eliminado       → sale del cierre; sigue en el historial.
           --   oferta_retirada → una oferta (Publicada de Sodimac) que WebCarga
           --                     no tomó. Va a su grupo, donde se declara el
           --                     motivo (Pablo: el "acusete" de operaciones).
           (t.tms_missing_since IS NOT NULL
            AND COALESCE(t.tms_absence_kind, 'eliminado') = 'eliminado') AS eliminado_en_tms,
           (t.tms_absence_kind = 'oferta_retirada') AS oferta_retirada,
           -- D5: la última entrega en destino, sólo si TODOS los destinos tienen
           -- una. Mismo orden que _cargo_delivered en trips.py: lo manual, después
           -- el GPS, después el TMS.
           entrega.ultima AS ultima_entrega
    FROM app.trips t
    LEFT JOIN app.trip_statuses s ON s.id = t.trip_status
    -- 1:1 por trip_id (uq_trip_fleet_link y la vista devuelve una fila por
    -- viaje): no multiplican filas.
    LEFT JOIN app.trip_fleet_links fl ON fl.trip_id = t.id
    LEFT JOIN app.v_trip_fleet_resolution vfr ON vfr.trip_id = t.id
    LEFT JOIN public.carriers c ON c.id = vfr.resolved_carrier_id
    LEFT JOIN public.drivers d ON d.id = vfr.resolved_driver_id
    LEFT JOIN public.assets ta ON ta.id = vfr.resolved_tractor_asset_id
    LEFT JOIN LATERAL (
        SELECT CASE WHEN bool_and(x.ts IS NOT NULL) THEN max(x.ts) END AS ultima
        FROM (
            SELECT COALESCE(st.departure_date_manual, st.gps_departure_date, st.departure_date,
                            st.desc_fin_manual, st.unload_end) AS ts
            FROM app.trip_stops st
            WHERE st.trip_id = t.id AND st.stop_type = 'DESTINATION'
        ) x
    ) entrega ON true
    LEFT JOIN public.shippers sh
           ON lower(trim(sh.name)) = lower(trim(t.client_name)) AND sh.status = 'ACTIVE'
    -- planning_date IS NULL sólo entra si NOT is_active: así el único grupo
    -- que puede alcanzar (abandonado, que no exige fecha) queda disponible
    -- para él, pero un viaje activo sin fecha sigue sin calzar en ningún
    -- grupo (hoy/rezago/en_curso sí exigen fecha, eso no cambia).
    WHERE t.planning_date <= $1::date OR (t.planning_date IS NULL AND NOT t.is_active)
"""

SQL_GRUPOS_CIERRE = f"""
WITH base AS (
{SQL_BASE}
)
SELECT trip_id, planning_date, client_name, source_system_trip_id, trip_status,
       unassigned_reason_id, dias_sin_novedad,
       source_system, tractor_plate, driver_name, carrier_name,
       CASE
           WHEN oferta_retirada THEN 'oferta_sin_declarar'
           WHEN is_active AND NOT is_assigned AND planning_date = $1::date THEN 'hoy'
           WHEN is_active AND NOT is_assigned AND planning_date < $1::date THEN 'rezago'
           WHEN is_active AND is_assigned     AND planning_date < $1::date THEN 'en_curso'
           ELSE 'abandonado'
       END AS grupo
FROM base
-- Un viaje declarado sale de los CUATRO grupos: eso es lo que significa
-- "resuelto". La regla estaba escrita desde el 18/08 pero aplicada solo a la
-- rama "abandonado", asi que valia unicamente para bulk-close -que ademas
-- apaga is_active- y no para el motivo puesto desde el detalle del viaje en
-- el Monitor, que escribe la misma columna y nada mas. Ese viaje se quedaba
-- en hoy/rezago/en_curso y seguia contando en `bloquean`.
-- Sigue visible en el historial via el filtro no_asignado_webcarga.
WHERE unassigned_reason_id IS NULL
  AND NOT eliminado_en_tms
  AND (oferta_retirada
   OR (is_active AND NOT is_assigned)
   OR (is_active AND is_assigned AND planning_date < $1::date)
   OR (NOT is_active
       AND group_id IN {GRUPOS_NO_TERMINALES}
       -- mismo valor redondeado que se devuelve en el SELECT: filtrar sobre
       -- el crudo y mostrar el redondeado dejaba pasar filas de 7.0x que el
       -- resultado mostraba como 7.0 exactos (parecia violar > 7 sin bug real).
       AND dias_sin_novedad > {DIAS_SIN_NOVEDAD}
       -- D5 (minuta 02/10): entregado y sin cierre del TMS por más de
       -- stale_trip_days sale del cierre. Sin umbral definido, no oculta nada.
       AND NOT COALESCE(ultima_entrega < now() - make_interval(days => (
               SELECT stale_trip_days FROM app.monitor_alert_rules WHERE id = 1)), false)))
ORDER BY grupo, planning_date DESC
"""

# "Con motivo" (HU-D3, minuta 02/10): los viajes que se declararon desde el
# cierre de este día o después, para que el coordinador vea dónde quedaron y
# pueda deshacer. Antes, poner el motivo los sacaba de los cuatro grupos y no
# aparecían en ninguna parte del cierre. "Desde D" y no "el día D" porque el
# cierre de un día se hace a menudo a la mañana siguiente. La fecha es la de
# Chile, la misma en que el coordinador piensa el día.
SQL_CON_MOTIVO = f"""
SELECT b.trip_id, b.planning_date, b.client_name, b.source_system_trip_id, b.trip_status,
       b.unassigned_reason_id, b.dias_sin_novedad,
       b.source_system, b.tractor_plate, b.driver_name, b.carrier_name,
       'con_motivo' AS grupo
FROM ({SQL_BASE}) b
WHERE b.unassigned_reason_id IS NOT NULL
  AND EXISTS (
      SELECT 1 FROM public.audit_log a
      WHERE a.entity_type = 'TRIP' AND a.entity_id = b.trip_id
        AND a.action = 'no_asignado_por_webcarga'
        AND (a.occurred_at AT TIME ZONE 'America/Santiago')::date >= $1::date
  )
"""
