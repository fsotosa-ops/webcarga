-- ==============================================================================
-- PIPELINE: centralizer_to_app — 23_upsert_insurance.sql
-- Plan §2.5. Requiere el modelo dbt silver.stg_insurance_vehicles (VISTA
-- materializada por dbt en Mage) y 20_upsert_transporters.sql ejecutados
-- antes (re-vincula transporter_id por rut, contra el app.transporters ya
-- actualizado). Solo LEE de silver.stg_*.
--
-- Dominio de sync: 'insurance' (pólizas + cuotas + re-vínculo).
--
-- payment_url/file_url/storage_path de app.insurance_policies NO se tocan
-- acá: no tienen columna origen en bronze.raw_insurance_vehicles (se cargan
-- desde la app vía upload/link — plan §4.3), así que simplemente no forman
-- parte del INSERT/UPDATE de este archivo.
-- ==============================================================================

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('centralizer_to_app'));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.sync_config WHERE domain = 'insurance' AND sync_enabled) THEN
    RAISE NOTICE 'sync off: insurance';
  ELSE

    -- (a) Upsert de pólizas. stg está a grano cuota (N filas por póliza);
    -- DISTINCT ON por la clave de póliza evita que el mismo INSERT intente
    -- afectar la misma fila de conflicto dos veces (error de Postgres) si
    -- dos cuotas de la misma póliza llegaran con algún campo no-clave
    -- distinto — gana la de installment_number más bajo, determinístico.
    INSERT INTO app.insurance_policies (
      rut, contractor_name, client_group, company, policy_number, endorsement,
      coverage, plate, policy_type, valid_from, valid_to, source
    )
    SELECT DISTINCT ON (s.rut_norm, s.company, s.policy_number, coalesce(s.endorsement, ''))
      s.rut_norm, s.contractor_name, s.client_group, s.company, s.policy_number, s.endorsement,
      s.coverage, s.plate, s.policy_type, s.valid_from, s.valid_to, 'pipeline'
    FROM silver.stg_insurance_vehicles s
    ORDER BY s.rut_norm, s.company, s.policy_number, coalesce(s.endorsement, ''), s.installment_number
    ON CONFLICT (rut, company, policy_number, coalesce(endorsement, '')) DO UPDATE SET
      contractor_name = excluded.contractor_name,
      client_group    = excluded.client_group,
      coverage        = excluded.coverage,
      plate           = excluded.plate,
      policy_type     = excluded.policy_type,
      valid_from      = excluded.valid_from,
      valid_to        = excluded.valid_to;

    -- (b) Re-vincular transporter_id por rut para pólizas sin vínculo
    UPDATE app.insurance_policies p
    SET transporter_id = t.id
    FROM app.transporters t
    WHERE t.rut = p.rut AND p.transporter_id IS NULL;

    -- (c) Upsert de cuotas. Nunca degrada una cuota ya 'pagada', y respeta
    -- manual_override (pago marcado a mano en la app).
    INSERT INTO app.insurance_installments (
      policy_id, installment_number, total_installments, amount_uf, due_date, status
    )
    SELECT
      p.id, s.installment_number, s.total_installments, s.amount_uf, s.due_date, s.status
    FROM silver.stg_insurance_vehicles s
    JOIN app.insurance_policies p
      ON p.rut = s.rut_norm
     AND p.company = s.company
     AND p.policy_number = s.policy_number
     AND coalesce(p.endorsement, '') = coalesce(s.endorsement, '')
    ON CONFLICT (policy_id, installment_number, due_date) DO UPDATE SET
      amount_uf           = excluded.amount_uf,
      total_installments  = excluded.total_installments,
      status              = excluded.status,
      updated_by          = NULL
    WHERE NOT app.insurance_installments.manual_override
      AND app.insurance_installments.status <> 'pagada';

  END IF;
END $$;

COMMIT;
