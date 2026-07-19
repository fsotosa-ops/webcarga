-- "Vuelta N" por conductor/día — fuente única de verdad, reusable por el
-- futuro reporte de monitoreo diario/semanal/mensual (fast-follow "contexto
-- de tendencia" del spec 2026-07-18-diario-assign-dialog-redesign-design.md)
-- sin duplicar esta lógica de conteo. Vista simple (no materializada): se
-- recalcula en vivo en cada lectura, mismo criterio "resolución en vivo" ya
-- usado esta sesión — sin job de refresco, sin riesgo de watermark
-- incremental (el mismo tipo de bug que esta sesión encontró 2 veces con
-- modelos dbt incrementales).
--
-- Solo incluye viajes con trip_fleet_links.driver_id explícito (92% de los
-- vínculos, Ronda 18 del hardening del Diario) — no intenta reproducir acá
-- el fallback de resolución en vivo por patente que sí usa trips.py para
-- otros campos.
CREATE VIEW app.v_driver_daily_trip_legs AS
SELECT
    fl.trip_id,
    fl.driver_id,
    t.planning_date,
    ROW_NUMBER() OVER (
        PARTITION BY fl.driver_id, t.planning_date
        ORDER BY COALESCE(
            ots.departure_date, ots.gps_departure_date, ots.desc_inicio_manual,
            ots.departure_date_prog, ots.planning_date, t.created_at
        )
    ) AS leg_number
FROM app.trip_fleet_links fl
JOIN app.trips t ON t.id = fl.trip_id
LEFT JOIN app.trip_stops ots ON ots.trip_id = t.id AND ots.stop_type = 'ORIGIN'
WHERE fl.driver_id IS NOT NULL;
