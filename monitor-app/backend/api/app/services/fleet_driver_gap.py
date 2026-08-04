"""Inconsistencias de dotación (minuta 2026-08-03): por empresa que opera
Tractoreo, cruza tractos activos vs. conductores activos. Cálculo en vivo,
sin tabla de persistencia diaria (mismo patrón que Centro de Flota) — es un
indicador estructural que se resuelve por gestión externa (contactar al
transportista), no una acción del sistema con estado propio que haya que
'cerrar'. Equipo Completo queda fuera del cruce (la minuta lo excluye
explícitamente: 'no aplica este control')."""


_FLEET_DRIVER_GAP_SQL = """
WITH tractoreo_assets AS (
    SELECT aa.carrier_id, count(*) AS n_tractos
    FROM public.asset_assignments aa
    JOIN public.assets a ON a.id = aa.asset_id AND a.operational_status = 'ACTIVE' AND a.asset_type = 'TRACTOCAMION'
    JOIN app.status_taxonomies wot ON wot.id = a.webcarga_operation_type_id AND wot.label = 'Tractoreo'
    WHERE aa.status = 'ACTIVE'
    GROUP BY aa.carrier_id
),
tractoreo_drivers AS (
    SELECT da.carrier_id, count(DISTINCT d.id) AS n_conductores
    FROM public.driver_assignments da
    JOIN public.drivers d ON d.id = da.driver_id AND d.operational_status = 'ACTIVE'
    WHERE da.status = 'ACTIVE' AND da.carrier_id IN (SELECT carrier_id FROM tractoreo_assets)
    GROUP BY da.carrier_id
)
SELECT c.id AS carrier_id, c.business_name,
       COALESCE(ta.n_tractos, 0) AS n_tractos,
       COALESCE(td.n_conductores, 0) AS n_conductores,
       COALESCE(ta.n_tractos, 0) - COALESCE(td.n_conductores, 0) AS gap
FROM public.carriers c
JOIN tractoreo_assets ta ON ta.carrier_id = c.id
LEFT JOIN tractoreo_drivers td ON td.carrier_id = c.id
WHERE c.operational_status = 'ACTIVE' AND COALESCE(ta.n_tractos, 0) != COALESCE(td.n_conductores, 0)
ORDER BY abs(COALESCE(ta.n_tractos, 0) - COALESCE(td.n_conductores, 0)) DESC, c.business_name
"""


async def compute_fleet_driver_gap(pool) -> list[dict]:
    rows = await pool.fetch(_FLEET_DRIVER_GAP_SQL)
    return [dict(r) for r in rows]
