-- ==============================================================================
-- MIGRACIÓN: BITÁCORA V2 — tipos de nota, pin y adjuntos
--
-- - note_type: categoriza la nota (observacion/llamada/whatsapp/incidente) y
--   reserva 'sistema' para eventos automáticos generados por la API (override,
--   vínculo de empresa, creación manual). El cliente no puede crear 'sistema'.
-- - pinned: nota destacada, se muestra arriba del feed.
-- - app.trip_note_attachments: archivos por nota (PDF/imágenes), almacenados en
--   el bucket privado 'trip-attachments'; se sirven con signed URLs desde la API.
-- ==============================================================================

ALTER TABLE app.trip_notes
  ADD COLUMN note_type text NOT NULL DEFAULT 'observacion'
    CHECK (note_type IN ('observacion', 'llamada', 'whatsapp', 'incidente', 'sistema')),
  ADD COLUMN pinned boolean NOT NULL DEFAULT false;

CREATE TABLE app.trip_note_attachments (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id      uuid        NOT NULL REFERENCES app.trip_notes(id) ON DELETE CASCADE,
  storage_path text        NOT NULL,
  file_name    text        NOT NULL,
  mime_type    text        NOT NULL,
  size_bytes   bigint      NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX trip_note_attachments_note_idx ON app.trip_note_attachments (note_id);

ALTER TABLE app.trip_note_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trip_note_attachments_read"
  ON app.trip_note_attachments FOR SELECT USING (true);

-- Bucket privado para los archivos (los objetos se suben/firman vía service role)
INSERT INTO storage.buckets (id, name, public)
VALUES ('trip-attachments', 'trip-attachments', false)
ON CONFLICT (id) DO NOTHING;
