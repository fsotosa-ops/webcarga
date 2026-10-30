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

# Los viajes del día D: los planificados para D y sin anular. Es el universo que firma
# el Cierre (app.closure_signature_trips, totals.viajes) y contra el que se calculan
# los ajustes posteriores. Una sola definición (Importante 4, revisión de rama
# 2026-08-18; spec 2026-10-10 anulación §3). Parámetro: $1 = D.
from .cliente_del_viaje import join_cliente, nombre_del_cliente

SQL_VIAJES_DEL_DIA = "SELECT t.id FROM app.trips t WHERE t.planning_date = $1 AND t.voided_at IS NULL"

SQL_BASE = f"""    SELECT t.id AS trip_id, t.planning_date,
           -- El nombre prolijo, no el crudo del TMS. Visto en pantalla el
           -- 14/09: esta pestana mostraba "walmart"/"sodimac" en minusculas
           -- mientras "Flota del dia" -que resuelve por public.shippers-
           -- mostraba "Walmart" en la columna que se llama IGUAL. La misma
           -- columna diciendo dos cosas distintas segun la pestana.
           {nombre_del_cliente('t', 'sh')} AS client_name,
           t.source_system_trip_id, t.trip_status, t.unassigned_reason_id,
           t.is_active, t.is_assigned,
           -- Un estado que no es carga (cancelado, declinado) no se regulariza.
           COALESCE(s.counts_as_load, true) AS counts_as_load,
           round((EXTRACT(EPOCH FROM (now() - t.status_reported_at)) / 86400)::numeric, 1)
               AS dias_sin_novedad,
           s.group_id,
           -- Contexto del Monitor (HU-D2, minuta 02/10): con el número solo,
           -- el coordinador copiaba el ID e iba a buscarlo al Monitor. Mismas
           -- expresiones que _TRIP_SELECT (routers/trips.py): primero el dato
           -- resuelto contra el maestro, después el vínculo, después el TMS.
           t.source_system,
           COALESCE(ta.license_plate, fl.tractor_plate, t.fleet->>'tractor_plate') AS tractor_plate,
           COALESCE(d.full_name,
                    app.tms_driver_name(COALESCE(fl.driver_name_raw, t.fleet->>'driver_name_tms'))) AS driver_name,
           -- El nombre que informó el TMS, aparte del resuelto: con él se busca a la
           -- persona en el Directorio (el mismo emparejamiento del Monitor). Sin los
           -- rellenos ("POR CONFIRMAR /"), que no son una persona: app.tms_driver_name.
           app.tms_driver_name(COALESCE(fl.driver_name_raw, t.fleet->>'driver_name_tms')) AS driver_name_tms,
           COALESCE(c.business_name, t.fleet->>'transporter_name_tms')             AS carrier_name,
           -- Las entidades resueltas contra el directorio, para abrirlas en la vista
           -- rápida (HU 20261011/01). NULL = lo que se ve viene del TMS sin cruzar.
           vfr.resolved_carrier_id::text      AS carrier_id,
           vfr.resolved_driver_id::text       AS driver_id,
           vfr.resolved_tractor_asset_id::text AS tractor_asset_id,
           -- El tipo de operación del VIAJE (declarado, del cliente o del tracto) y de
           -- dónde sale; la regla está en la vista (plan 2026-10-21).
           vfr.resolved_operation_type_id::text AS operation_type_id,
           vfr.operation_type_source,
           COALESCE(vfr.operation_type_conflict, false) AS operation_type_conflict,
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
           -- Asignación incompleta (minuta 09/10 §2.4): lo que le falta al viaje
           -- resuelto contra el directorio, con la misma fuente que Flota del día.
           -- Sin empresa resuelta es el "asignado a WebCarga" sin un tercero (30/10).
           array_remove(ARRAY[
               CASE WHEN vfr.resolved_tractor_asset_id IS NULL THEN 'tractor' END,
               CASE WHEN vfr.resolved_driver_id IS NULL THEN 'driver' END,
               CASE WHEN vfr.resolved_carrier_id IS NULL THEN 'carrier' END
           ], NULL) AS missing_fleet,
           -- La empresa del viaje no es la del conductor ese día (o el conductor no
           -- tiene empresa): el MISMATCH de Tractoreo, dicho por el viaje y para los
           -- dos alcances. La empresa del conductor a esa fecha ya la trae la vista.
           (vfr.resolved_driver_id IS NOT NULL AND vfr.resolved_carrier_id IS NOT NULL
            AND vfr.resolved_driver_home_carrier_id IS DISTINCT FROM vfr.resolved_carrier_id) AS carrier_mismatch,
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
    {join_cliente('t', 'sh')}
    -- planning_date IS NULL sólo entra si NOT is_active: así el único grupo
    -- que puede alcanzar (abandonado, que no exige fecha) queda disponible
    -- para él, pero un viaje activo sin fecha sigue sin calzar en ningún
    -- grupo (hoy/rezago/en_curso sí exigen fecha, eso no cambia).
    WHERE (t.planning_date <= $1::date OR (t.planning_date IS NULL AND NOT t.is_active))
      -- Los anulados no se cierran (spec 2026-10-10 anulación §2.2).
      AND t.voided_at IS NULL
"""

# La misma cota de días que usa app.trips_del_dia: más atrás, el Cierre no mira.
HORIZONTE_DIAS = 45

# POR REGULARIZAR (reunión del 30/10): todo viaje con datos incompletos, del día o
# pendiente de antes, que el coordinador tiene que resolver antes de firmar —
# completar la asignación o declarar que no se tomará—. Junta lo que eran tres
# grupos de esta pestaña ("hoy", "rezago" y "asignación incompleta") y suma lo que
# no se veía: la empresa que falta (asignado a WebCarga sin un tercero) y la
# empresa distinta a la del conductor. Una sola definición, usada en el CASE, en el
# WHERE y en la firma (`cierre_lineas.cerrar`).
TO_REGULARIZE = (
    f"(planning_date BETWEEN $1::date - {HORIZONTE_DIAS} AND $1::date AND counts_as_load "
    "AND ((is_active AND NOT is_assigned) "
    "OR (is_assigned AND (cardinality(missing_fleet) > 0 OR carrier_mismatch))))"
)

SQL_GRUPOS_CIERRE = f"""
WITH base AS (
{SQL_BASE}
)
SELECT trip_id, planning_date, client_name, source_system_trip_id, trip_status,
       unassigned_reason_id, dias_sin_novedad,
       source_system, tractor_plate, driver_name, driver_name_tms, carrier_name,
       missing_fleet, carrier_mismatch, is_assigned,
       carrier_id, driver_id, tractor_asset_id,
       operation_type_id, operation_type_source, operation_type_conflict,
       CASE
           WHEN oferta_retirada THEN 'oferta_sin_declarar'
           -- Va antes que "Espera cierre del TMS": un Sodimac con solo la rampla
           -- primero se completa (minuta 09/10 §2.3).
           WHEN {TO_REGULARIZE} THEN 'por_regularizar'
           -- Ítem 6 (minuta 09/10): asignado, pero el TMS del cliente todavía no lo
           -- cierra. Va aparte, sin importar la fecha ni si el TMS dejó de reportar
           -- (Sodimac puede tardar hasta el martes siguiente): no es "en curso" ni
           -- "abandonado", y no pide motivo. Lo decide el grupo del estado en el
           -- catálogo (Configuración › Estados), no una lista de estados en el código.
           WHEN is_assigned AND group_id = 'pendiente_cierre_tms' THEN 'pendiente_cierre_tms'
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
   OR {TO_REGULARIZE}
   OR (is_assigned AND group_id = 'pendiente_cierre_tms')
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
       b.source_system, b.tractor_plate, b.driver_name, b.driver_name_tms, b.carrier_name,
       b.missing_fleet, b.carrier_mismatch, b.is_assigned,
       b.carrier_id, b.driver_id, b.tractor_asset_id,
       b.operation_type_id, b.operation_type_source, b.operation_type_conflict,
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
