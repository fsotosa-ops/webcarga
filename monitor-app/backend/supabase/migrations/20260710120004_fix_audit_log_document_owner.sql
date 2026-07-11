-- ==============================================================================
-- AUDITORÍA 2026-07-10 — FASE 4: corregir app.audit_log
--
-- (1) El trigger de compliance_documents grababa entity_type='compliance_document'
--     y entity_id=NEW.id (el id del documento) en vez del DUEÑO real
--     (transporter/driver/vehicle + su id, que SÍ vienen en NEW.entity_type/
--     NEW.entity_id). Esto rompía el propósito del índice
--     idx_audit_log_entity(entity_type, entity_id, ...) para la consulta más
--     obvia ("todo lo que le pasó a la empresa X") — quedaba enterrado en el
--     jsonb. Se agrega una columna doc_code para no perder CUÁL documento
--     cambió, y el trigger usa el dueño real como entity_type/entity_id.
-- (2) ops.pipeline_runs.domains_skipped: hace visible qué dominios de
--     app.sync_config estaban desactivados durante la corrida (principio de
--     arquitectura #4, "toda divergencia queda visible, nunca silenciosa") —
--     se calcula en 30_finalize.sql, no requiere que cada bloque de upsert lo
--     señale individualmente.
-- ==============================================================================

ALTER TABLE app.audit_log ADD COLUMN doc_code text;

CREATE OR REPLACE FUNCTION app.audit_compliance_document_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.expiry_date IS DISTINCT FROM OLD.expiry_date
     OR NEW.file_url IS DISTINCT FROM OLD.file_url
     OR NEW.storage_path IS DISTINCT FROM OLD.storage_path THEN
    INSERT INTO app.audit_log (actor, entity_type, entity_id, doc_code, action, field, old_value, new_value, source)
    VALUES (
      NEW.updated_by,
      NEW.entity_type,
      NEW.entity_id,
      NEW.doc_code,
      'update',
      'status',
      jsonb_build_object(
        'status', OLD.status, 'expiry_date', OLD.expiry_date,
        'file_url', OLD.file_url, 'storage_path', OLD.storage_path,
        'document_id', OLD.id
      ),
      jsonb_build_object(
        'status', NEW.status, 'expiry_date', NEW.expiry_date,
        'file_url', NEW.file_url, 'storage_path', NEW.storage_path,
        'document_id', NEW.id
      ),
      CASE WHEN NEW.updated_by IS NULL THEN 'pipeline' ELSE 'api' END
    );
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION app.audit_compliance_document_change() IS
  'entity_type/entity_id = dueño real (transporter/driver/vehicle), no el id del documento — permite consultar idx_audit_log_entity por empresa/conductor/vehículo. doc_code identifica cuál documento cambió; document_id (el id de compliance_documents) queda en old_value/new_value para trazabilidad completa.';

ALTER TABLE ops.pipeline_runs ADD COLUMN domains_skipped text[];

COMMENT ON COLUMN ops.pipeline_runs.domains_skipped IS
  'Dominios de app.sync_config con sync_enabled=false durante esta corrida — hace visible que el pipeline los saltó (principio #4: ninguna divergencia queda silenciosa), calculado en 30_finalize.sql.';
