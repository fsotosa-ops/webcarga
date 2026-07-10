-- ==============================================================================
-- PIPELINE: centralizer_to_app — 21_upsert_drivers.sql
-- Plan §2.5. Requiere los modelos dbt silver.stg_centralizer_drivers /
-- silver.stg_centralizer_driver_docs (VISTAS materializadas por dbt en Mage)
-- y 20_upsert_transporters.sql ejecutados antes (necesita app.transporters
-- ya actualizado para resolver rut_empresa → id). Solo LEE de silver.stg_*.
--
-- Dominio de sync: 'drivers' (tabla + asignaciones/transferencias) y
-- 'compliance_docs' (documentos de driver).
-- ==============================================================================

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('centralizer_to_app'));

-- ══════════════════════════════════════════════════════════════════════════
-- Dominio: drivers
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_batch bigint;
BEGIN
  v_batch := (SELECT max(batch_id) FROM ops.pipeline_runs WHERE pipeline = 'centralizer_to_app');

  IF NOT EXISTS (SELECT 1 FROM app.sync_config WHERE domain = 'drivers' AND sync_enabled) THEN
    RAISE NOTICE 'sync off: drivers';
  ELSE

    -- (a) Upsert app.drivers por rut
    INSERT INTO app.drivers (rut, dv, rut_dv_valid, full_name, id_expiry, license_expiry, avance_total, source, last_seen_batch)
    SELECT s.rut, s.dv_conductor, s.rut_dv_valid, s.full_name, s.id_expiry, s.license_expiry, s.avance_total, 'centralizer', v_batch
    FROM silver.stg_centralizer_drivers s
    ON CONFLICT (rut) DO UPDATE SET
      dv             = CASE WHEN 'dv' = ANY (app.drivers.manually_edited_fields) THEN app.drivers.dv ELSE excluded.dv END,
      rut_dv_valid   = CASE WHEN 'rut_dv_valid' = ANY (app.drivers.manually_edited_fields) THEN app.drivers.rut_dv_valid ELSE excluded.rut_dv_valid END,
      full_name      = CASE WHEN 'full_name' = ANY (app.drivers.manually_edited_fields) THEN app.drivers.full_name ELSE excluded.full_name END,
      id_expiry      = CASE WHEN 'id_expiry' = ANY (app.drivers.manually_edited_fields) THEN app.drivers.id_expiry ELSE excluded.id_expiry END,
      license_expiry = CASE WHEN 'license_expiry' = ANY (app.drivers.manually_edited_fields) THEN app.drivers.license_expiry ELSE excluded.license_expiry END,
      avance_total   = CASE WHEN 'avance_total' = ANY (app.drivers.manually_edited_fields) THEN app.drivers.avance_total ELSE excluded.avance_total END,
      last_seen_batch = v_batch;

    -- (b1) Transferencias: cerrar la asignación vigente cuya empresa difiere
    -- del stg y auditar. Idempotente: si la vigente ya apunta a la empresa
    -- del stg, IS DISTINCT FROM es false y no hace nada.
    WITH driver_target AS (
      SELECT d.id AS driver_id, t.id AS transporter_id
      FROM silver.stg_centralizer_drivers s
      JOIN app.drivers d ON d.rut = s.rut
      JOIN app.transporters t ON t.rut = s.rut_empresa
    ),
    ca AS (
      SELECT da.id AS assignment_id, da.driver_id, da.transporter_id AS old_transporter_id, dt.transporter_id AS new_transporter_id
      FROM app.driver_assignments da
      JOIN driver_target dt ON dt.driver_id = da.driver_id
      WHERE da.valid_to IS NULL
        AND da.transporter_id IS DISTINCT FROM dt.transporter_id
    ),
    closed AS (
      UPDATE app.driver_assignments da
      SET valid_to = current_date
      FROM ca
      WHERE da.id = ca.assignment_id
      RETURNING da.driver_id, ca.old_transporter_id, ca.new_transporter_id
    )
    INSERT INTO app.audit_log (actor, entity_type, entity_id, action, field, old_value, new_value, source)
    SELECT NULL, 'driver', c.driver_id, 'transfer', 'transporter_id',
           jsonb_build_object('transporter_id', c.old_transporter_id),
           jsonb_build_object('transporter_id', c.new_transporter_id), 'pipeline'
    FROM closed c;

    -- (b2) Abrir asignación nueva/objetivo si no existe una vigente que ya
    -- matchee la empresa del stg (cubre tanto "sin asignación previa" como
    -- "recién cerrada por transferencia en el paso anterior").
    INSERT INTO app.driver_assignments (driver_id, transporter_id, valid_from)
    SELECT dt.driver_id, dt.transporter_id, current_date
    FROM (
      SELECT d.id AS driver_id, t.id AS transporter_id
      FROM silver.stg_centralizer_drivers s
      JOIN app.drivers d ON d.rut = s.rut
      JOIN app.transporters t ON t.rut = s.rut_empresa
    ) dt
    WHERE NOT EXISTS (
      SELECT 1 FROM app.driver_assignments da
      WHERE da.driver_id = dt.driver_id AND da.valid_to IS NULL AND da.transporter_id = dt.transporter_id
    );

  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════════════
-- Dominio: compliance_docs (documentos de driver)
-- ══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.sync_config WHERE domain = 'compliance_docs' AND sync_enabled) THEN
    RAISE NOTICE 'sync off: compliance_docs (drivers)';
  ELSE
    INSERT INTO app.compliance_documents (entity_type, entity_id, doc_code, status, expiry_date, source, updated_by)
    SELECT 'driver', dr.id, d.doc_code, d.status, d.expiry_date, 'centralizer', NULL
    FROM silver.stg_centralizer_driver_docs d
    JOIN app.drivers dr ON dr.rut = d.driver_rut
    ON CONFLICT (entity_type, entity_id, doc_code) DO UPDATE SET
      status      = excluded.status,
      expiry_date = excluded.expiry_date,
      source      = 'centralizer',
      updated_by  = NULL
    WHERE NOT app.compliance_documents.manual_override;
  END IF;
END $$;

COMMIT;
