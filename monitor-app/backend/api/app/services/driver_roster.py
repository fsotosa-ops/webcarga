"""Roster de conductores que caen en el cierre ACTIVO de Tractoreo (minuta
2026-08-03): conductor con asignación activa a una empresa ACTIVE que
opera al menos un tracto (TRACTOCAMION) clasificado como Tractoreo
(assets.webcarga_operation_type_id). Equipo Completo queda explícitamente
fuera de este cierre (sigue siendo pasivo por tracto, ver
equipment_closures.py) — una empresa puede operar ambos tipos, por eso el
filtro es "opera AL MENOS UN tracto Tractoreo", no "toda su flota es
Tractoreo". DISTINCT porque una empresa puede tener varios tractos
Tractoreo sin que el conductor se duplique.

Extraído de daily_closures.py (Tarea 6, plan 2.3, minuta 2026-08-03) —
pasa a ser público (sin guion bajo) porque ahora lo importan 2 routers:
daily_closures.py (cuadratura por conductor) y status_report.py (Sección
4 del reporte, agrupada por conductor)."""

def tractoreo_roster_select(day: str = "public.hoy_chile()") -> str:
    """El SELECT del roster de Tractoreo de un día (`day`: expresión SQL de tipo date)."""
    return """
        -- home_location_id (HU-28): el origen habitual viaja con el roster porque la
        -- línea del cierre lo copia. DISTINCT no cambia de cardinalidad: es
        -- una columna de la propia fila de `drivers`.
        SELECT DISTINCT d.id AS driver_id, da.counterpart_id AS home_carrier_id,
               d.home_location_id
        FROM public.drivers d
        -- FIX 2026-08-18: faltaba filtrar al CONDUCTOR por operational_status.
        -- Se filtraba la empresa (c) y el activo (a), pero no a él, mientras
        -- fleet_driver_gap.py:22 sí lo hace — o sea el mismo conductor de baja
        -- contaba distinto en dos secciones del mismo reporte. Hoy no cambia
        -- ningún número (los 87 de public.drivers están ACTIVE, roster 44 → 44);
        -- es un defecto latente que aparece el día que operaciones dé una baja.
        -- D2 (14/10): la empresa del conductor y la del tracto son las de ESE día
        -- (app.fleet_assignment_periods), no las de hoy.
        JOIN app.fleet_assignment_periods da ON da.relation = 'DRIVER_CARRIER' AND da.subject_id = d.id
             AND da.valid_during @> {day} AND d.operational_status = 'ACTIVE'
        JOIN public.carriers c ON c.id = da.counterpart_id AND c.operational_status = 'ACTIVE'
        JOIN app.fleet_assignment_periods aa ON aa.relation = 'ASSET_CARRIER' AND aa.counterpart_id = c.id
             AND aa.valid_during @> {day}
        JOIN public.assets a ON a.id = aa.subject_id AND a.operational_status = 'ACTIVE' AND a.asset_type = 'TRACTOCAMION'
        JOIN app.status_taxonomies wot ON wot.id = a.webcarga_operation_type_id AND wot.code = 'TRACTOREO'
""".format(day=day)


def tractoreo_roster_cte(day: str = "public.hoy_chile()") -> str:
    """El roster de Tractoreo de un día, como CTE `active_roster`."""
    return f"""
    active_roster AS ({tractoreo_roster_select(day)}    )
"""


def tractoreo_roster_by_day_cte(desde: str, hasta: str) -> str:
    """El roster de cada día de un rango, como CTE `active_roster` con `business_date`
    (D2: el reporte junta días distintos y cada uno tiene su roster)."""
    return f"""
    active_roster AS (
        SELECT dias.day AS business_date, r.*
        FROM (SELECT generate_series({desde}::date, {hasta}::date, interval '1 day')::date AS day) dias
        CROSS JOIN LATERAL ({tractoreo_roster_select('dias.day')}) r
    )
"""


TRACTOREO_ROSTER_CTE = tractoreo_roster_cte()
