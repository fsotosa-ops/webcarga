-- ==============================================================================
-- FIX: app.v_sync_divergence fue eliminada por CASCADE durante la migración
-- de renombre de doc_code (20260710120001_rename_gc_doc_codes / el DROP VIEW
-- silver.stg_centralizer_transporters CASCADE ejecutado como parte de esa
-- fase también dropeó esta vista, que dependía de esa vista silver). Se
-- recrea idéntica a la definición original (20260709100008), sin cambios de
-- lógica — no referenciaba ningún doc_code hardcodeado.
-- ==============================================================================

CREATE OR REPLACE VIEW app.v_sync_divergence AS
WITH transporter_field_diff AS (
  SELECT
    'transporter'::text AS entity_type,
    t.id                AS entity_id,
    t.rut               AS entity_label,
    f.field,
    f.app_value,
    f.source_value
  FROM app.transporters t
  JOIN silver.stg_centralizer_transporters s ON s.rut = t.rut
  CROSS JOIN LATERAL (
    VALUES
      ('business_name', t.business_name::text, s.business_name::text),
      ('avance_80_20',  t.avance_80_20::text,  s.avance_80_20::text),
      ('avance_total',  t.avance_total::text,  s.avance_total::text),
      ('account_stage', t.account_stage::text, 'Operational'::text)
  ) AS f(field, app_value, source_value)
  WHERE f.field = ANY (t.manually_edited_fields)
    AND f.app_value IS DISTINCT FROM f.source_value
),
transporter_doc_diff AS (
  SELECT
    'transporter'::text                AS entity_type,
    cd.entity_id                       AS entity_id,
    t.rut                              AS entity_label,
    'doc:' || cd.doc_code              AS field,
    cd.status::text                    AS app_value,
    d.status::text                     AS source_value
  FROM app.compliance_documents cd
  JOIN app.transporters t ON t.id = cd.entity_id
  JOIN silver.stg_centralizer_transporter_docs d ON d.rut = t.rut AND d.doc_code = cd.doc_code
  WHERE cd.entity_type = 'transporter'
    AND cd.manual_override
    AND cd.status IS DISTINCT FROM d.status
),
driver_doc_diff AS (
  SELECT
    'driver'::text                     AS entity_type,
    cd.entity_id                       AS entity_id,
    dr.rut                             AS entity_label,
    'doc:' || cd.doc_code              AS field,
    cd.status::text                    AS app_value,
    d.status::text                     AS source_value
  FROM app.compliance_documents cd
  JOIN app.drivers dr ON dr.id = cd.entity_id
  JOIN silver.stg_centralizer_driver_docs d ON d.driver_rut = dr.rut AND d.doc_code = cd.doc_code
  WHERE cd.entity_type = 'driver'
    AND cd.manual_override
    AND cd.status IS DISTINCT FROM d.status
),
vehicle_doc_diff AS (
  SELECT
    'vehicle'::text                    AS entity_type,
    cd.entity_id                       AS entity_id,
    v.plate                            AS entity_label,
    'doc:' || cd.doc_code              AS field,
    cd.status::text                    AS app_value,
    d.status::text                     AS source_value
  FROM app.compliance_documents cd
  JOIN app.vehicles v ON v.id = cd.entity_id
  JOIN silver.stg_centralizer_vehicle_docs d ON d.plate = v.plate AND d.doc_code = cd.doc_code
  WHERE cd.entity_type = 'vehicle'
    AND cd.manual_override
    AND cd.status IS DISTINCT FROM d.status
)
SELECT * FROM transporter_field_diff
UNION ALL
SELECT * FROM transporter_doc_diff
UNION ALL
SELECT * FROM driver_doc_diff
UNION ALL
SELECT * FROM vehicle_doc_diff;

COMMENT ON VIEW app.v_sync_divergence IS
  'Reporte de reconciliación: filas donde manually_edited_fields/manual_override impidió que el pipeline pisara un valor editado en la app, y ese valor difiere del que trae el origen (silver.stg_centralizer_*). entity_label = rut (transporter/driver) o plate (vehicle). Requiere que el pipeline centralizer_to_app haya corrido al menos una vez.';
