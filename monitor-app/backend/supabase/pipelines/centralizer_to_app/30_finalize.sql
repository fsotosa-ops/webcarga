-- ==============================================================================
-- PIPELINE: centralizer_to_app — 30_finalize.sql
-- Plan §2.5 (cierre) / §1.6. Cierra la fila 'running' de ops.pipeline_runs
-- abierta por 00_gate.sql con conteos de bronze/app/rejects.
-- ==============================================================================

DO $$
DECLARE
  v_batch          bigint;
  v_run_id         bigint;
  v_rows_in        jsonb;
  v_rows_upserted  jsonb;
  v_rows_rejected  jsonb;
BEGIN
  v_batch := (SELECT max(batch_id) FROM ops.pipeline_runs WHERE pipeline = 'centralizer_to_app');

  SELECT id INTO v_run_id
  FROM ops.pipeline_runs
  WHERE pipeline = 'centralizer_to_app' AND batch_id = v_batch AND status = 'running'
  ORDER BY id DESC
  LIMIT 1;

  IF v_run_id IS NULL THEN
    RAISE EXCEPTION 'centralizer_to_app: no se encontró una corrida en estado running para batch %', v_batch;
  END IF;

  v_rows_in := jsonb_build_object(
    'raw_centralizer_transporter', (SELECT count(*) FROM bronze.raw_centralizer_transporter),
    'raw_centralizer_drivers',     (SELECT count(*) FROM bronze.raw_centralizer_drivers),
    'raw_centralizer_vehicles',    (SELECT count(*) FROM bronze.raw_centralizer_vehicles),
    'raw_info_contacto',           (SELECT count(*) FROM bronze.raw_info_contacto),
    'raw_insurance_vehicles',      (SELECT count(*) FROM bronze.raw_insurance_vehicles)
  );

  v_rows_upserted := jsonb_build_object(
    'transporters',            (SELECT count(*) FROM app.transporters WHERE last_seen_batch = v_batch),
    'drivers',                 (SELECT count(*) FROM app.drivers WHERE last_seen_batch = v_batch),
    'vehicles',                (SELECT count(*) FROM app.vehicles WHERE last_seen_batch = v_batch),
    'insurance_policies',      (SELECT count(*) FROM app.insurance_policies),
    'insurance_installments',  (SELECT count(*) FROM app.insurance_installments)
  );

  SELECT coalesce(jsonb_object_agg(reason, cnt), '{}'::jsonb) INTO v_rows_rejected
  FROM (
    SELECT reason, count(*) AS cnt
    FROM ops.pipeline_rejects
    WHERE batch_id = v_batch
    GROUP BY reason
  ) r;

  UPDATE ops.pipeline_runs
  SET
    finished_at   = now(),
    status        = 'ok',
    rows_in       = v_rows_in,
    rows_upserted = v_rows_upserted,
    rows_rejected = v_rows_rejected
  WHERE id = v_run_id;
END $$;
