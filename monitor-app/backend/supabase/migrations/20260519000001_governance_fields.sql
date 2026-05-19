-- Add company_governance to transporter_profiles
ALTER TABLE app.transporter_profiles
  ADD COLUMN IF NOT EXISTS company_governance JSONB DEFAULT '{}'::jsonb;

-- Document expected JSONB shapes via comments
COMMENT ON COLUMN app.transporter_profiles.drivers IS
'Array per item: {id, rut, name,
 id_expiry (ISO date), license_expiry (ISO date),
 anexo_3_walmart, epp, das_odi, hoja_de_vida, cert_antecedentes,
 validado_walmart, contrato_trabajo, creacion_walmart (ok|pendiente|actualizar|n_a),
 avance_total (float)}';

COMMENT ON COLUMN app.transporter_profiles.vehicles IS
'Array per item: {id, type, plate, year (int),
 circ_permit_expiry, tech_inspection_expiry,
 gas_emissions_expiry, soap_insurance_expiry (ISO dates),
 poliza_rc, gps, seguro_carga, mantencion_camara_frio, creacion_walmart
 (ok|pendiente|actualizar|n_a)}';

-- Compliance alerts view (expired or expiring within 30 days)
CREATE OR REPLACE VIEW app.v_compliance_alerts AS
WITH driver_dates AS (
  SELECT
    tp.id            AS transporter_id,
    tp.business_name,
    tp.rut           AS company_rut,
    d.value->>'name' AS entity_name,
    d.value->>'rut'  AS entity_rut,
    NULL::TEXT        AS entity_plate,
    'driver'          AS entity_type,
    u.doc_label,
    u.doc_key,
    u.expiry_date
  FROM app.transporter_profiles tp,
       LATERAL jsonb_array_elements(COALESCE(tp.drivers, '[]'::jsonb)) d,
       LATERAL (VALUES
         ('Copia C.I.',  'id_expiry',      (d.value->>'id_expiry')::DATE),
         ('Licencia',    'license_expiry',  (d.value->>'license_expiry')::DATE)
       ) AS u(doc_label, doc_key, expiry_date)
  WHERE u.expiry_date IS NOT NULL
),
vehicle_dates AS (
  SELECT
    tp.id,
    tp.business_name,
    tp.rut,
    v.value->>'plate' AS entity_name,
    NULL::TEXT         AS entity_rut,
    v.value->>'plate'  AS entity_plate,
    'vehicle'          AS entity_type,
    u.doc_label,
    u.doc_key,
    u.expiry_date
  FROM app.transporter_profiles tp,
       LATERAL jsonb_array_elements(COALESCE(tp.vehicles, '[]'::jsonb)) v,
       LATERAL (VALUES
         ('Permiso Circulación', 'circ_permit_expiry',     (v.value->>'circ_permit_expiry')::DATE),
         ('Revisión Técnica',    'tech_inspection_expiry', (v.value->>'tech_inspection_expiry')::DATE),
         ('Gases Contaminantes', 'gas_emissions_expiry',   (v.value->>'gas_emissions_expiry')::DATE),
         ('Seguro SOAP',         'soap_insurance_expiry',  (v.value->>'soap_insurance_expiry')::DATE)
       ) AS u(doc_label, doc_key, expiry_date)
  WHERE u.expiry_date IS NOT NULL
)
SELECT
  transporter_id,
  business_name,
  company_rut,
  entity_name,
  entity_rut,
  entity_plate,
  entity_type::TEXT,
  doc_label,
  doc_key,
  expiry_date,
  CASE
    WHEN expiry_date < CURRENT_DATE                       THEN 'expired'
    WHEN expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'expiring_soon'
    ELSE 'ok'
  END AS alert_status
FROM (
  SELECT * FROM driver_dates
  UNION ALL
  SELECT * FROM vehicle_dates
) combined
WHERE expiry_date <= CURRENT_DATE + INTERVAL '30 days';

GRANT SELECT ON app.v_compliance_alerts TO authenticated;
