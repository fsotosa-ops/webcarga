-- ==============================================================================
-- PIPELINE: centralizer_to_app — 20_upsert_transporters.sql
-- Plan §2.5. Requiere los modelos dbt silver.stg_centralizer_transporters /
-- silver.stg_centralizer_transporter_docs (VISTAS materializadas por dbt en
-- Mage) y 15_rejects.sql ejecutados antes. Este bloque solo LEE de
-- silver.stg_* — funciona igual sobre vista que sobre tabla física.
--
-- Dominio de sync: 'transporters' (tabla + contactos + regla N=2) y
-- 'compliance_docs' (upsert de documentos de transporter) — cada uno con su
-- propio guard, ambos dentro de la MISMA transacción/advisory lock.
-- ==============================================================================

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('centralizer_to_app'));

-- ══════════════════════════════════════════════════════════════════════════
-- Dominio: transporters
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_batch bigint;
BEGIN
  v_batch := (SELECT max(batch_id) FROM ops.pipeline_runs WHERE pipeline = 'centralizer_to_app');

  IF NOT EXISTS (SELECT 1 FROM app.sync_config WHERE domain = 'transporters' AND sync_enabled) THEN
    RAISE NOTICE 'sync off: transporters';
  ELSE

    -- (a1) Caso Lumiliz: si el admin_internal_id matchea un transporter
    -- existente con RUT distinto, se corrige el RUT de ESE registro (no se
    -- crea uno nuevo) — solo si 'rut' no está protegido.
    UPDATE app.transporters t
    SET
      rut          = s.rut,
      dv           = CASE WHEN 'dv' = ANY (t.manually_edited_fields) THEN t.dv ELSE s.dv END,
      rut_dv_valid = CASE WHEN 'rut_dv_valid' = ANY (t.manually_edited_fields) THEN t.rut_dv_valid ELSE s.rut_dv_valid END
    FROM silver.stg_centralizer_transporters s
    WHERE s.admin_internal_id IS NOT NULL
      AND t.admin_internal_id = s.admin_internal_id
      AND t.rut IS DISTINCT FROM s.rut
      AND NOT ('rut' = ANY (t.manually_edited_fields));

    -- (a2) Upsert normal por rut (incluye los recién realineados por (a1),
    -- que ahora matchean por rut, y todos los demás).
    INSERT INTO app.transporters (
      rut, dv, rut_dv_valid, business_name, clients, avance_80_20, avance_total,
      sharepoint_url, payment_url, account_stage, is_active,
      in_admin, admin_internal_id, admin_account_id, source, last_seen_batch
    )
    SELECT
      s.rut, s.dv, s.rut_dv_valid, s.business_name, s.clients, s.avance_80_20, s.avance_total,
      s.sharepoint_url, s.payment_url, 'Operational', true,
      s.in_admin, s.admin_internal_id, s.admin_account_id, 'centralizer', v_batch
    FROM silver.stg_centralizer_transporters s
    ON CONFLICT (rut) DO UPDATE SET
      business_name = CASE WHEN 'business_name' = ANY (app.transporters.manually_edited_fields) THEN app.transporters.business_name ELSE excluded.business_name END,
      dv            = CASE WHEN 'dv' = ANY (app.transporters.manually_edited_fields) THEN app.transporters.dv ELSE excluded.dv END,
      rut_dv_valid  = CASE WHEN 'rut_dv_valid' = ANY (app.transporters.manually_edited_fields) THEN app.transporters.rut_dv_valid ELSE excluded.rut_dv_valid END,
      clients       = (SELECT array_agg(DISTINCT c) FROM unnest(app.transporters.clients || excluded.clients) c),
      avance_80_20  = CASE WHEN 'avance_80_20' = ANY (app.transporters.manually_edited_fields) THEN app.transporters.avance_80_20 ELSE excluded.avance_80_20 END,
      avance_total  = CASE WHEN 'avance_total' = ANY (app.transporters.manually_edited_fields) THEN app.transporters.avance_total ELSE excluded.avance_total END,
      sharepoint_url = CASE WHEN 'sharepoint_url' = ANY (app.transporters.manually_edited_fields) THEN app.transporters.sharepoint_url ELSE excluded.sharepoint_url END,
      payment_url   = CASE WHEN 'payment_url' = ANY (app.transporters.manually_edited_fields) THEN app.transporters.payment_url ELSE excluded.payment_url END,
      account_stage = 'Operational',
      is_active     = true,
      source        = app.transporters.source,
      in_admin      = (app.transporters.in_admin OR excluded.in_admin),
      admin_internal_id = coalesce(excluded.admin_internal_id, app.transporters.admin_internal_id),
      admin_account_id  = coalesce(excluded.admin_account_id, app.transporters.admin_account_id),
      last_seen_batch   = v_batch;

    -- (b) Contactos por rol (4 tarjetas) — solo si hay al menos un dato
    INSERT INTO app.transporter_contacts (transporter_id, role, name, phone, email)
    SELECT t.id, 'rep_legal', s.rep_legal_name, s.rep_legal_phone, s.rep_legal_email
    FROM silver.stg_centralizer_transporters s
    JOIN app.transporters t ON t.rut = s.rut
    WHERE s.rep_legal_name IS NOT NULL OR s.rep_legal_phone IS NOT NULL OR s.rep_legal_email IS NOT NULL
    ON CONFLICT (transporter_id, role) DO UPDATE SET
      name = excluded.name, phone = excluded.phone, email = excluded.email;

    INSERT INTO app.transporter_contacts (transporter_id, role, name, phone, email)
    SELECT t.id, 'operacional', s.operacional_name, s.operacional_phone, s.operacional_email
    FROM silver.stg_centralizer_transporters s
    JOIN app.transporters t ON t.rut = s.rut
    WHERE s.operacional_name IS NOT NULL OR s.operacional_phone IS NOT NULL OR s.operacional_email IS NOT NULL
    ON CONFLICT (transporter_id, role) DO UPDATE SET
      name = excluded.name, phone = excluded.phone, email = excluded.email;

    INSERT INTO app.transporter_contacts (transporter_id, role, name, phone, email)
    SELECT t.id, 'finanzas', s.finanzas_name, s.finanzas_phone, s.finanzas_email
    FROM silver.stg_centralizer_transporters s
    JOIN app.transporters t ON t.rut = s.rut
    WHERE s.finanzas_name IS NOT NULL OR s.finanzas_phone IS NOT NULL OR s.finanzas_email IS NOT NULL
    ON CONFLICT (transporter_id, role) DO UPDATE SET
      name = excluded.name, phone = excluded.phone, email = excluded.email;

    INSERT INTO app.transporter_contacts (transporter_id, role, name, phone, email)
    SELECT t.id, 'documentos', s.documentos_name, s.documentos_phone, s.documentos_email
    FROM silver.stg_centralizer_transporters s
    JOIN app.transporters t ON t.rut = s.rut
    WHERE s.documentos_name IS NOT NULL OR s.documentos_phone IS NOT NULL OR s.documentos_email IS NOT NULL
    ON CONFLICT (transporter_id, role) DO UPDATE SET
      name = excluded.name, phone = excluded.phone, email = excluded.email;

    -- (c) Regla N=2: desactivar ausentes >= 2 batches consecutivos, auditado.
    WITH deactivated AS (
      UPDATE app.transporters
      SET is_active = false
      WHERE source = 'centralizer' AND last_seen_batch <= v_batch - 2 AND is_active
      RETURNING id
    )
    INSERT INTO app.audit_log (actor, entity_type, entity_id, action, field, old_value, new_value, source)
    SELECT NULL, 'transporter', id, 'update', 'is_active',
           jsonb_build_object('is_active', true), jsonb_build_object('is_active', false), 'pipeline'
    FROM deactivated;

  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════════════
-- Dominio: compliance_docs (documentos de transporter)
-- ══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.sync_config WHERE domain = 'compliance_docs' AND sync_enabled) THEN
    RAISE NOTICE 'sync off: compliance_docs (transporters)';
  ELSE
    INSERT INTO app.compliance_documents (entity_type, entity_id, doc_code, status, source, updated_by)
    SELECT 'transporter', t.id, d.doc_code, d.status, 'centralizer', NULL
    FROM silver.stg_centralizer_transporter_docs d
    JOIN app.transporters t ON t.rut = d.rut
    ON CONFLICT (entity_type, entity_id, doc_code) DO UPDATE SET
      status     = excluded.status,
      source     = 'centralizer',
      updated_by = NULL
    WHERE NOT app.compliance_documents.manual_override;
  END IF;
END $$;

COMMIT;
