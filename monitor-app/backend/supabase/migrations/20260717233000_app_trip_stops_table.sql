-- Fase 2 del hardening del modelo de datos del Diario (H2.6): normaliza
-- `stops` de JSONB a tabla relacional. Alcance acotado a la capa app.* —
-- lee de app.trips.stops (ya remapeado por app_trips.sql), no toca las
-- capas stg_*/int_tms_trips_conformed (marcadas congeladas, origen de 4 de
-- los 5 incidentes reales documentados en trips_context.md).
--
-- stop_id se REUSA tal cual viene del jsonb (md5(trip_id || location_name
-- || ordinal), calculado en app_trips.sql) — no se recalcula acá, la
-- fórmula sigue viviendo en un solo lugar. Invariante de continuidad,
-- mismo criterio que trip_id (ver feedback_webcarga_traceability).
--
-- desc_inicio_manual/desc_fin_manual reemplazan el parche
-- app.trips.stop_manual_fields (jsonb keyed por stop_id) por columnas
-- reales — mismo patrón que ya protege notes/fleet_link_id en app.trips.
-- Verificado en vivo: 0/2724 viajes tienen stop_manual_fields poblado hoy,
-- no hay dato real que migrar en ese campo específico.
--
-- app.trips.stops/stop_manual_fields quedan intactas sin uso (decisión
-- explícita del usuario) — red de seguridad para el cambio más riesgoso
-- del proyecto: si algo sale mal, alcanza con revertir el backend, sin
-- pérdida de datos posible.
CREATE TABLE app.trip_stops (
  stop_id              text PRIMARY KEY,
  trip_id              uuid NOT NULL REFERENCES app.trips(id),
  stop_order           int NOT NULL,
  local                text,
  destination_city     text,
  destination_region   text,
  on_time_status       text,
  milestone_status     text,
  s2s                  text,
  temperature          numeric,
  planning_date        timestamptz,
  arrival_date         timestamptz,
  departure_date       timestamptz,
  departure_date_prog  timestamptz,
  gps_arrival_date     timestamptz,
  gps_departure_date   timestamptz,
  unload_start         timestamptz,
  unload_end           timestamptz,
  desc_inicio_manual   timestamptz,
  desc_fin_manual      timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_trip_stops_trip_id ON app.trip_stops (trip_id);

ALTER TABLE app.trip_stops ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Trip stops are viewable by authenticated users" ON app.trip_stops;
CREATE POLICY "Trip stops are viewable by authenticated users" ON app.trip_stops FOR SELECT TO authenticated USING (true);

-- Carga inicial: misma extracción exacta que hará el modelo dbt
-- app/trip_stops.sql cuando el pipeline vuelva a correr, para que ese
-- primer MERGE encuentre los mismos stop_id y actualice en vez de duplicar.
INSERT INTO app.trip_stops (
  stop_id, trip_id, stop_order, local, destination_city, destination_region,
  on_time_status, milestone_status, s2s, temperature, planning_date,
  arrival_date, departure_date, departure_date_prog, gps_arrival_date,
  gps_departure_date, unload_start, unload_end
)
SELECT
  elem->>'stop_id',
  t.id,
  (ord - 1),
  elem->>'local',
  elem->>'destination_city',
  elem->>'destination_region',
  elem->>'on_time_status',
  elem->>'milestone_status',
  elem->>'s2s',
  NULLIF(elem->>'temperature', '')::numeric,
  NULLIF(elem->>'planning_date', '')::timestamptz,
  NULLIF(elem->>'arrival_date', '')::timestamptz,
  NULLIF(elem->>'departure_date', '')::timestamptz,
  NULLIF(elem->>'departure_date_prog', '')::timestamptz,
  NULLIF(elem->>'gps_arrival_date', '')::timestamptz,
  NULLIF(elem->>'gps_departure_date', '')::timestamptz,
  NULLIF(elem->>'unload_start', '')::timestamptz,
  NULLIF(elem->>'unload_end', '')::timestamptz
FROM app.trips t
CROSS JOIN LATERAL jsonb_array_elements(t.stops) WITH ORDINALITY AS s(elem, ord)
WHERE t.stops IS NOT NULL;
