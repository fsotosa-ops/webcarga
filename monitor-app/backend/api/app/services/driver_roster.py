"""Roster de conductores que caen en el cierre ACTIVO de Tractoreo (minuta
2026-08-03): conductor con asignación activa a una empresa ACTIVE que
opera al menos un tracto (public.is_power_unit) clasificado como Tractoreo
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
    """El SELECT del roster de Tractoreo de un día (`day`: expresión SQL de tipo date).
    La regla vive en la base, `app.tractoreo_roster` (migración 20261106090000), porque la
    analítica (dbt) también la lee: el origen habitual (HU-28) viaja con el roster porque la
    línea del cierre lo copia, y la empresa y el tracto son los de ESE día (D2, 14/10)."""
    return f"""
        SELECT r.driver_id, r.home_carrier_id, r.home_location_id FROM app.tractoreo_roster(({day})::date) r
"""


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
