-- ==============================================================================
-- MIGRACIÓN: MÓDULO EMPRESAS EETT + SEGUROS — FASE 1 (E) AUDITORÍA + NOTIFICACIONES
-- Plan: monitor-app/docs/plan-modulo-empresas-seguros.md §1.6, §3
--
-- app.audit_log: append-only de todo cambio de estado relevante (Principio de
-- arquitectura #6). Poblado por triggers AFTER UPDATE en insurance_installments
-- (pagos) y compliance_documents (status/vencimiento/archivo); las
-- transferencias y overrides los escribe el API directamente (Fase 3+).
--
-- app.notifications: alimentada por el job diario de notificaciones (§3,
-- Fase 3+); la tabla se crea ahora para no bloquear ese trabajo después.
-- ==============================================================================

-- ── app.audit_log ──────────────────────────────────────────────────────────
CREATE TABLE app.audit_log (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor       uuid,                 -- NULL = pipeline
  entity_type text        NOT NULL,
  entity_id   uuid        NOT NULL,
  action      text        NOT NULL, -- insert | update | transfer | mark_paid | override | sync_skip
  field       text,
  old_value   jsonb,
  new_value   jsonb,
  source      text        NOT NULL  -- pipeline | api
);

CREATE INDEX idx_audit_log_entity ON app.audit_log (entity_type, entity_id, occurred_at DESC);

-- ── Trigger: auditar cambios de estado de pago en cuotas ──────────────────
CREATE OR REPLACE FUNCTION app.audit_insurance_installment_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN
    INSERT INTO app.audit_log (actor, entity_type, entity_id, action, field, old_value, new_value, source)
    VALUES (
      NEW.updated_by,
      'insurance_installment',
      NEW.id,
      CASE WHEN NEW.status = 'pagada' AND OLD.status IS DISTINCT FROM 'pagada' THEN 'mark_paid' ELSE 'update' END,
      'status',
      jsonb_build_object('status', OLD.status, 'paid_at', OLD.paid_at),
      jsonb_build_object('status', NEW.status, 'paid_at', NEW.paid_at),
      CASE WHEN NEW.updated_by IS NULL THEN 'pipeline' ELSE 'api' END
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER insurance_installments_audit
  AFTER UPDATE ON app.insurance_installments
  FOR EACH ROW EXECUTE FUNCTION app.audit_insurance_installment_change();

-- ── Trigger: auditar cambios de estado/vencimiento/archivo en documentos ──
CREATE OR REPLACE FUNCTION app.audit_compliance_document_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.expiry_date IS DISTINCT FROM OLD.expiry_date
     OR NEW.file_url IS DISTINCT FROM OLD.file_url
     OR NEW.storage_path IS DISTINCT FROM OLD.storage_path THEN
    INSERT INTO app.audit_log (actor, entity_type, entity_id, action, field, old_value, new_value, source)
    VALUES (
      NEW.updated_by,
      'compliance_document',
      NEW.id,
      'update',
      'status',
      jsonb_build_object(
        'status', OLD.status, 'expiry_date', OLD.expiry_date,
        'file_url', OLD.file_url, 'storage_path', OLD.storage_path,
        'entity_type', OLD.entity_type, 'entity_id', OLD.entity_id, 'doc_code', OLD.doc_code
      ),
      jsonb_build_object(
        'status', NEW.status, 'expiry_date', NEW.expiry_date,
        'file_url', NEW.file_url, 'storage_path', NEW.storage_path,
        'entity_type', NEW.entity_type, 'entity_id', NEW.entity_id, 'doc_code', NEW.doc_code
      ),
      CASE WHEN NEW.updated_by IS NULL THEN 'pipeline' ELSE 'api' END
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER compliance_documents_audit
  AFTER UPDATE ON app.compliance_documents
  FOR EACH ROW EXECUTE FUNCTION app.audit_compliance_document_change();

-- ── app.notifications ───────────────────────────────────────────────────────
CREATE TABLE app.notifications (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text        NOT NULL,
  entity_type      text,
  entity_id        uuid,
  message          text        NOT NULL,
  due_date         date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  acknowledged_by  uuid,
  acknowledged_at  timestamptz
);

CREATE INDEX idx_notifications_unacknowledged ON app.notifications (acknowledged_at) WHERE acknowledged_at IS NULL;
