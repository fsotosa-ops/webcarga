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

TRACTOREO_ROSTER_CTE = """
    active_roster AS (
        SELECT DISTINCT d.id AS driver_id, da.carrier_id AS home_carrier_id
        FROM public.drivers d
        JOIN public.driver_assignments da ON da.driver_id = d.id AND da.status = 'ACTIVE'
        JOIN public.carriers c ON c.id = da.carrier_id AND c.operational_status = 'ACTIVE'
        JOIN public.asset_assignments aa ON aa.carrier_id = c.id AND aa.status = 'ACTIVE'
        JOIN public.assets a ON a.id = aa.asset_id AND a.operational_status = 'ACTIVE' AND a.asset_type = 'TRACTOCAMION'
        JOIN app.status_taxonomies wot ON wot.id = a.webcarga_operation_type_id AND wot.label = 'Tractoreo'
    )
"""
