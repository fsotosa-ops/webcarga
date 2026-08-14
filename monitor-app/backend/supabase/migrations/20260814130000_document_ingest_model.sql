-- ==============================================================================
-- Bandeja de ingesta de documentos (carga masiva con match automático)
-- ==============================================================================
--
-- Es el modelo de datos que el tab "Documentos Sin Clasificar" de Certificación
-- (hoy deshabilitado con title="Próximamente") siempre necesitó.
--
-- Principio: NADA toca public.compliance_records hasta el commit explícito del
-- batch. Los archivos viven en staging y el match se propone, se revisa y recién
-- después se aplica. Ningún archivo se descarta: lo que no matchea queda en
-- UNMATCHED para asignación manual.
-- ==============================================================================

BEGIN;

-- ── Lote de ingesta ─────────────────────────────────────────────────────────
CREATE TABLE public.document_ingest_batches (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- NULL = lote multi-empresa (típico del backfill de SharePoint). Cuando
    -- viene seteado, acota el universo del matcher a esa empresa.
    carrier_id    UUID REFERENCES public.carriers(id) ON DELETE SET NULL,
    -- Solo 'UPLOAD': todo entra por arrastre desde la app. La ingesta desde
    -- SharePoint quedó fuera de alcance (ver épica Red de Transporte).
    source        TEXT NOT NULL DEFAULT 'UPLOAD' CHECK (source IN ('UPLOAD')),
    status        TEXT NOT NULL DEFAULT 'DRAFT'
                  CHECK (status IN ('DRAFT','MATCHING','REVIEW','COMMITTED','CANCELLED')),
    created_by    UUID,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    committed_at  TIMESTAMPTZ,
    -- Instrumentación: con estos contadores decidimos, sobre datos reales del
    -- backfill, si hace falta sumar OCR/LLM más adelante.
    total_files   INTEGER NOT NULL DEFAULT 0,
    matched_auto  INTEGER NOT NULL DEFAULT 0,
    matched_review INTEGER NOT NULL DEFAULT 0,
    unmatched     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_ingest_batches_status ON public.document_ingest_batches (status, created_at DESC);
CREATE INDEX idx_ingest_batches_carrier ON public.document_ingest_batches (carrier_id)
    WHERE carrier_id IS NOT NULL;

-- ── Archivo individual dentro del lote ──────────────────────────────────────
CREATE TABLE public.document_ingest_items (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id      UUID NOT NULL REFERENCES public.document_ingest_batches(id) ON DELETE CASCADE,

    storage_path  TEXT NOT NULL,        -- staging/{batch_id}/{uuid}_{safe_name}
    file_name     TEXT NOT NULL,
    mime_type     TEXT,
    size_bytes    BIGINT,
    -- Idempotencia: permite re-correr la sync de SharePoint durante la
    -- convivencia sin volver a subir lo mismo.
    content_sha256 TEXT,

    match_status  TEXT NOT NULL DEFAULT 'UNMATCHED'
                  CHECK (match_status IN ('AUTO','SUGGESTED','AMBIGUOUS','UNMATCHED','COMMITTED','DISCARDED')),
    entity_type   TEXT CHECK (entity_type IN ('CARRIER','DRIVER','ASSET')),
    entity_id     UUID,                 -- polimórfico, igual que compliance_records
    requirement_id UUID REFERENCES public.compliance_requirements(id) ON DELETE SET NULL,
    compliance_record_id UUID,          -- se puebla al confirmar el commit
    expiration_date DATE,

    confidence    NUMERIC(4,3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    -- {entity: {via, score, raw}, type: {via, score, alias}} — se muestra al
    -- revisor para que entienda POR QUÉ se propuso este match.
    match_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Top-N alternativas, para el <select> de corrección sin ida y vuelta al server.
    candidates    JSONB NOT NULL DEFAULT '[]'::jsonb,
    error         TEXT,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ingest_items_batch ON public.document_ingest_items (batch_id, match_status);
CREATE INDEX idx_ingest_items_sha ON public.document_ingest_items (content_sha256)
    WHERE content_sha256 IS NOT NULL;

-- ── Diccionario de alias: nombre de archivo → tipo de documento ─────────────
-- Catálogo en tabla, NO hardcodeado en código: mismo criterio ya adoptado para
-- los campos documentales (HU-18-24). Operaciones puede agregar alias nuevos
-- cuando aparece una forma de escribir que el matcher no reconoce, sin deploy.
CREATE TABLE public.requirement_filename_aliases (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requirement_id UUID NOT NULL REFERENCES public.compliance_requirements(id) ON DELETE CASCADE,
    -- Se compara normalizado (upper, sin tildes, sin puntuación) contra el
    -- nombre del archivo. La normalización la hace el motor, no la tabla.
    alias          TEXT NOT NULL,
    -- Mayor prioridad gana ante alias que se solapan: "USO Y MANTENCION EPP"
    -- (CAPACITACION_EPP) debe ganarle a "EPP" (ENTREGA_EPP), que es substring.
    priority       INTEGER NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (requirement_id, alias)
);

CREATE INDEX idx_req_aliases_priority ON public.requirement_filename_aliases (priority DESC, alias);

COMMIT;
