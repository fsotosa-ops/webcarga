-- ==============================================================================
-- MIGRACIÓN: BITÁCORA DE VIAJES CON HISTORIAL
-- app.trip_notes
--
-- Feed cronológico inmutable de notas por viaje (autor + timestamp), reemplaza
-- en la UI a los campos planos observaciones/comentarios de app.trips (que se
-- conservan por compatibilidad y se muestran como entrada legacy de solo lectura).
--
-- trip_id NO tiene FK hacia app.trips: dbt --full-refresh recrea esa tabla
-- físicamente (patrón documentado 4 veces: ya borró RLS/PK/índices) y una FK
-- entrante bloquearía el DROP del pipeline. La integridad se garantiza en el
-- endpoint (verifica existencia del viaje antes de insertar).
-- ==============================================================================

CREATE TABLE app.trip_notes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id    uuid        NOT NULL,
  author_id  uuid        NOT NULL REFERENCES public.profiles(id),
  body       text        NOT NULL CHECK (char_length(trim(body)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX trip_notes_trip_created_idx ON app.trip_notes (trip_id, created_at DESC);

-- Accedida exclusivamente a través del backend FastAPI (service_role bypasses RLS).
-- RLS habilitada como defensa en profundidad; solo lectura, escritura vía API.
ALTER TABLE app.trip_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trip_notes_read"
  ON app.trip_notes FOR SELECT USING (true);
