-- Pasada única: los viajes de Sodimac que ya estaban en app.trips con la
-- traducción vieja ('ASIGNADO') toman el estado que hoy da la homologación
-- (Publicada/Presentada, ver 20261007100000 e int_tms_trips_conformed).
-- El incremental de app.trips no los vuelve a procesar solo: su archivo no
-- cambió, sólo la regla. No inventa nada: copia lo que dice
-- silver.int_tms_trips_conformed, que es lo que el TMS reportó.
UPDATE app.trips t
SET trip_status = c.trip_status_normalized,
    -- Una oferta nunca es un viaje asignado (misma regla que app/trips.sql).
    is_assigned = CASE WHEN c.trip_status_normalized = 'Publicada' THEN false ELSE t.is_assigned END,
    updated_at  = now()
FROM silver.int_tms_trips_conformed c
WHERE c.trip_id = t.id
  AND c.is_current
  AND t.source_system = 'sodimac'
  AND t.trip_status = 'ASIGNADO'
  AND c.trip_status_normalized IN ('Publicada', 'Presentada');
