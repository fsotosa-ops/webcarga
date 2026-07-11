-- ==============================================================================
-- PIPELINE: centralizer_to_app — 22_upsert_vehicles.sql
-- Plan §2.5. Requiere los modelos dbt silver.stg_centralizer_vehicles /
-- silver.stg_centralizer_vehicle_docs (VISTAS materializadas por dbt en Mage)
-- y 20_upsert_transporters.sql ejecutados antes. Solo LEE de silver.stg_*.
--
-- Dominio de sync: 'vehicles' (tabla + asignaciones/transferencias) y
-- 'compliance_docs' (documentos de vehicle). Misma estructura que
-- 21_upsert_drivers.sql, por patente en vez de rut.
-- ==============================================================================

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('centralizer_to_app'));

-- ══════════════════════════════════════════════════════════════════════════
-- Dominio: vehicles
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_batch bigint;
BEGIN
  v_batch := (SELECT max(batch_id) FROM ops.pipeline_runs WHERE pipeline = 'centralizer_to_app');

  IF NOT EXISTS (SELECT 1 FROM app.sync_config WHERE domain = 'vehicles' AND sync_enabled) THEN
    RAISE NOTICE 'sync off: vehicles';
  ELSE

    -- (a) Upsert app.vehicles por plate
    INSERT INTO app.vehicles (plate, kind, type_label, year, circ_permit_expiry, tech_inspection_expiry, gas_emissions_expiry, soap_insurance_expiry, source, last_seen_batch)
    SELECT s.plate, s.kind, s.type_label, s.year, s.circ_permit_expiry, s.tech_inspection_expiry, s.gas_emissions_expiry, s.soap_insurance_expiry, 'centralizer', v_batch
    FROM silver.stg_centralizer_vehicles s
    ON CONFLICT (plate) DO UPDATE SET
      kind                    = CASE WHEN 'kind' = ANY (app.vehicles.manually_edited_fields) THEN app.vehicles.kind ELSE excluded.kind END,
      type_label              = CASE WHEN 'type_label' = ANY (app.vehicles.manually_edited_fields) THEN app.vehicles.type_label ELSE excluded.type_label END,
      year                    = CASE WHEN 'year' = ANY (app.vehicles.manually_edited_fields) THEN app.vehicles.year ELSE excluded.year END,
      circ_permit_expiry      = CASE WHEN 'circ_permit_expiry' = ANY (app.vehicles.manually_edited_fields) THEN app.vehicles.circ_permit_expiry ELSE excluded.circ_permit_expiry END,
      tech_inspection_expiry  = CASE WHEN 'tech_inspection_expiry' = ANY (app.vehicles.manually_edited_fields) THEN app.vehicles.tech_inspection_expiry ELSE excluded.tech_inspection_expiry END,
      gas_emissions_expiry    = CASE WHEN 'gas_emissions_expiry' = ANY (app.vehicles.manually_edited_fields) THEN app.vehicles.gas_emissions_expiry ELSE excluded.gas_emissions_expiry END,
      soap_insurance_expiry   = CASE WHEN 'soap_insurance_expiry' = ANY (app.vehicles.manually_edited_fields) THEN app.vehicles.soap_insurance_expiry ELSE excluded.soap_insurance_expiry END,
      last_seen_batch         = v_batch;

    -- (b1) Transferencias
    WITH vehicle_target AS (
      SELECT v.id AS vehicle_id, t.id AS transporter_id
      FROM silver.stg_centralizer_vehicles s
      JOIN app.vehicles v ON v.plate = s.plate
      JOIN app.transporters t ON t.rut = s.transporter_rut
    ),
    ca AS (
      SELECT va.id AS assignment_id, va.vehicle_id, va.transporter_id AS old_transporter_id, vt.transporter_id AS new_transporter_id
      FROM app.vehicle_assignments va
      JOIN vehicle_target vt ON vt.vehicle_id = va.vehicle_id
      WHERE va.valid_to IS NULL
        AND va.transporter_id IS DISTINCT FROM vt.transporter_id
    ),
    closed AS (
      UPDATE app.vehicle_assignments va
      SET valid_to = current_date
      FROM ca
      WHERE va.id = ca.assignment_id
      RETURNING va.vehicle_id, ca.old_transporter_id, ca.new_transporter_id
    )
    INSERT INTO app.audit_log (actor, entity_type, entity_id, action, field, old_value, new_value, source)
    SELECT NULL, 'vehicle', c.vehicle_id, 'transfer', 'transporter_id',
           jsonb_build_object('transporter_id', c.old_transporter_id),
           jsonb_build_object('transporter_id', c.new_transporter_id), 'pipeline'
    FROM closed c;

    -- (b2) Abrir asignación nueva/objetivo
    INSERT INTO app.vehicle_assignments (vehicle_id, transporter_id, valid_from)
    SELECT vt.vehicle_id, vt.transporter_id, current_date
    FROM (
      SELECT v.id AS vehicle_id, t.id AS transporter_id
      FROM silver.stg_centralizer_vehicles s
      JOIN app.vehicles v ON v.plate = s.plate
      JOIN app.transporters t ON t.rut = s.transporter_rut
    ) vt
    WHERE NOT EXISTS (
      SELECT 1 FROM app.vehicle_assignments va
      WHERE va.vehicle_id = vt.vehicle_id AND va.valid_to IS NULL AND va.transporter_id = vt.transporter_id
    );

  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════════════
-- Dominio: compliance_docs (documentos de vehicle)
-- ══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.sync_config WHERE domain = 'compliance_docs' AND sync_enabled) THEN
    RAISE NOTICE 'sync off: compliance_docs (vehicles)';
  ELSE
    INSERT INTO app.compliance_documents (entity_type, entity_id, doc_code, status, expiry_date, source, updated_by)
    SELECT 'vehicle', v.id, d.doc_code, d.status, d.expiry_date, 'centralizer', NULL
    FROM silver.stg_centralizer_vehicle_docs d
    JOIN app.vehicles v ON v.plate = d.plate
    ON CONFLICT (entity_type, entity_id, doc_code) DO UPDATE SET
      status      = excluded.status,
      expiry_date = excluded.expiry_date,
      source      = 'centralizer',
      updated_by  = NULL
    WHERE NOT app.compliance_documents.manual_override;
  END IF;
END $$;

COMMIT;
