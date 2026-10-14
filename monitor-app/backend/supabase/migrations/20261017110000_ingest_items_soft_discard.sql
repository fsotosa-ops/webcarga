-- Cert 2a mínima (Entrega A, criterio S1): descartar un documento de Sin clasificar es
-- un borrado lógico. Hasta acá el blob se borraba de Storage y la fila quedaba en
-- DISCARDED sin quién ni por qué: no había vuelta atrás (85 descartados sin archivo,
-- medido el 14/10). Ahora el archivo se conserva y se puede restaurar.
ALTER TABLE public.document_ingest_items
    ADD COLUMN IF NOT EXISTS discarded_at          timestamptz,
    ADD COLUMN IF NOT EXISTS discarded_by          uuid REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS discard_reason        text,
    -- El estado al que vuelve al restaurar (AUTO, SUGGESTED, AMBIGUOUS o UNMATCHED).
    ADD COLUMN IF NOT EXISTS discarded_from_status text;

CREATE INDEX IF NOT EXISTS document_ingest_items_content_sha256
    ON public.document_ingest_items (content_sha256) WHERE content_sha256 IS NOT NULL;
