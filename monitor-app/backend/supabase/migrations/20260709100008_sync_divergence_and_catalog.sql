-- ==============================================================================
-- MIGRACIÓN: MÓDULO EMPRESAS EETT + SEGUROS — FASE 3 (H) CATÁLOGO + DIVERGENCIA
-- Plan: monitor-app/docs/plan-modulo-empresas-seguros.md §2.6 / §1.7
--
-- (1) Agrega el doc_code 'validado_gc' al catálogo de transporter — nuevo,
--     sin equivalente en la migración 20260709100003 (mapea
--     bronze.raw_centralizer_transporter.validado_por_gc, ver modelo dbt
--     pipelines/centralizer_to_app/dbt/stg_centralizer_transporter_docs.sql).
-- (2) Crea app.v_sync_divergence, deliberadamente NO creada en 20260709100006
--     porque depende de la capa silver del pipeline
--     (silver.stg_centralizer_transporters / _transporter_docs / _driver_docs
--     / _vehicle_docs — VISTAS materializadas por dbt en Mage Pro, o por
--     local_apply_views.sql en validación local), que recién existe después
--     del primer dbt run del pipeline
--     monitor-app/backend/supabase/pipelines/centralizer_to_app/.
--
-- IMPORTANTE: esta migración debe aplicarse DESPUÉS de materializar las
-- vistas silver.stg_* al menos una vez (dbt run o local_apply_views.sql).
-- Si se aplica antes, la CREATE VIEW falla por relaciones inexistentes.
--
-- Nota de diseño — divergencia de documentos (driver/vehicle): el plan
-- describe la salida como una fila (transporter_id, rut, field, app_value,
-- source_value), pero eso solo tiene sentido literal para transporters. Para
-- generalizar a compliance_documents con manual_override=true en driver y
-- vehicle (que no tienen "transporter_id"/"rut" propios), esta vista usa un
-- esquema más general: (entity_type, entity_id, entity_label, field,
-- app_value, source_value), donde entity_label = rut (transporter/driver) o
-- plate (vehicle). Es una generalización fiel a la intención del plan
-- (reporte de reconciliación consumible desde la UI y por Fabián), no un
-- cambio de alcance.
-- ==============================================================================

-- ── (1) Catálogo: doc_code nuevo ──────────────────────────────────────────────
INSERT INTO app.compliance_doc_catalog (doc_code, entity_type, label, has_expiry, weight_80_20, sort_order)
VALUES ('validado_gc', 'transporter', 'Validado por gran cuenta', false, 0, 125)
ON CONFLICT (doc_code) DO NOTHING;

-- ── (2) app.v_sync_divergence ─────────────────────────────────────────────────
CREATE OR REPLACE VIEW app.v_sync_divergence AS
WITH transporter_field_diff AS (
  -- Campos de app.transporters protegidos (manually_edited_fields) que
  -- divergen del valor que el pipeline traería del origen.
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
