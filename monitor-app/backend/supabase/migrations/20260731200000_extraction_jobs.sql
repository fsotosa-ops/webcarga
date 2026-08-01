-- 20260731200000_extraction_jobs.sql
-- Job store compartido de extraction_service — reemplaza el dict en memoria
-- por-instancia (bug real 2026-07-31: KeyError en producción con maxScale=3,
-- ver docs/superpowers/specs/2026-07-31-extraction-service-hardening-design.md).
-- Nunca se expone al cliente Supabase público — RLS sin policies, solo el
-- rol de servicio de extraction_service la toca vía conexión directa.

CREATE TABLE IF NOT EXISTS ops.extraction_jobs (
    job_id        uuid PRIMARY KEY,
    source        text NOT NULL,
    product       text NOT NULL,
    client_name   text NOT NULL,
    status        text NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
    request       jsonb NOT NULL,
    result        jsonb,
    error         text,
    queued_at     timestamptz NOT NULL DEFAULT now(),
    started_at    timestamptz,
    completed_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_extraction_jobs_status ON ops.extraction_jobs (status);

ALTER TABLE ops.extraction_jobs ENABLE ROW LEVEL SECURITY;
