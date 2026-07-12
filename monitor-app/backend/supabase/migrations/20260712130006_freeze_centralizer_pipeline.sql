UPDATE app.sync_config
SET sync_enabled = false,
    note = 'Congelado 2026-07-12 — reemplazado por app.centralizer_uploads (upload manual con aprobación). Ver docs/superpowers/plans/2026-07-12-empresas-seguros-checkpoint-a-schema.md'
WHERE domain IN ('transporters','drivers','vehicles','compliance_docs','insurance');

COMMENT ON TABLE bronze.raw_centralizer_transporter IS 'CONGELADO 2026-07-12 — ya no alimenta app.*. Fallback histórico/lectura únicamente.';
COMMENT ON TABLE bronze.raw_centralizer_drivers IS 'CONGELADO 2026-07-12 — ya no alimenta app.*. Fallback histórico/lectura únicamente.';
COMMENT ON TABLE bronze.raw_centralizer_vehicles IS 'CONGELADO 2026-07-12 — ya no alimenta app.*. Fallback histórico/lectura únicamente.';
COMMENT ON TABLE bronze.raw_insurance_vehicles IS 'CONGELADO 2026-07-12 — ya no alimenta app.*. Fallback histórico/lectura únicamente.';
COMMENT ON TABLE ops.pipeline_runs IS 'CONGELADO 2026-07-12 — histórico del pipeline Mage retirado.';
COMMENT ON TABLE ops.pipeline_rejects IS 'CONGELADO 2026-07-12 — histórico del pipeline Mage retirado.';
