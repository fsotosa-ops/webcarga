-- ==============================================================================
-- PIPELINE: centralizer_to_app — 15_rejects.sql
-- Plan §2.2-2.4 (rejects). Corre DESPUÉS de los modelos dbt (dbt/) y ANTES
-- de los upserts (20-23).
--
-- Los modelos dbt son declarativos (un SELECT): no pueden escribir en
-- ops.pipeline_rejects. Este bloque re-detecta y loguea todo lo que los
-- modelos excluyen o marcan:
--   rut_dv_invalido  — transporters y drivers (fila SIGUE en el stg)
--   duplicado        — perdedores del dedupe de drivers (rut) y vehicles (patente)
--   huerfano         — drivers/vehicles cuyo rut_empresa no está en
--                      silver.stg_centralizer_transporters
--   fecha_invalida   — columnas de fecha de bronze con valor no vacío / no '-'
--                      cuyo parse da NULL (enumeradas una a una)
--   valor_no_mapeado — columnas de status con valor no vacío que
--                      silver.map_doc_status deja NULL (EXCEPTO
--                      "creación_en_gc" de vehicles, que se salta silenciosa),
--                      tipo_de_equipo no reconocido, y filas de seguros sin
--                      póliza o sin número de cuota numérico
--
-- DUPLICACIÓN DELIBERADA: los predicados de dedupe/huérfano/parse se
-- re-declaran acá con la MISMA lógica que los modelos dbt (mismo ranking por
-- ctid, misma normalización). Es el costo aceptado del formato híbrido: si
-- se cambia un predicado en un modelo dbt, hay que cambiarlo también acá
-- (están señalados sección por sección). Los conteos de este bloque deben
-- cuadrar con las filas que faltan en las vistas respecto de bronze.
--
-- Semántica heredada del formato anterior (bloques 10-13):
--   - fecha_invalida de drivers/vehicles se evalúa sobre las filas ganadoras
--     del dedupe (rn=1), incluyendo huérfanos.
--   - valor_no_mapeado de docs se evalúa solo sobre filas presentes en el
--     stg final (excluye huérfanos y duplicados perdedores).
-- ==============================================================================

-- ── rut_dv_invalido: transporters (desde la vista; la fila sigue) ────────────
INSERT INTO ops.pipeline_rejects (batch_id, source_table, reason, raw_row)
SELECT
  (SELECT max(batch_id) FROM ops.pipeline_runs WHERE pipeline = 'centralizer_to_app'),
  'raw_centralizer_transporter',
  'rut_dv_invalido',
  jsonb_build_object('rut', rut, 'dv', dv, 'dv_esperado', app.rut_dv(rut))
FROM silver.stg_centralizer_transporters
WHERE dv IS NOT NULL AND rut_dv_valid IS FALSE;

-- ── rut_dv_invalido: drivers (desde la vista; la fila sigue) ─────────────────
INSERT INTO ops.pipeline_rejects (batch_id, source_table, reason, raw_row)
SELECT
  (SELECT max(batch_id) FROM ops.pipeline_runs WHERE pipeline = 'centralizer_to_app'),
  'raw_centralizer_drivers',
  'rut_dv_invalido',
  jsonb_build_object('rut', rut, 'dv', dv_conductor, 'dv_esperado', app.rut_dv(rut))
FROM silver.stg_centralizer_drivers
WHERE dv_conductor IS NOT NULL AND rut_dv_valid IS FALSE;

-- ── duplicado: drivers (mismo ranking que dbt/stg_centralizer_drivers.sql) ──
INSERT INTO ops.pipeline_rejects (batch_id, source_table, reason, raw_row)
SELECT
  (SELECT max(batch_id) FROM ops.pipeline_runs WHERE pipeline = 'centralizer_to_app'),
  'raw_centralizer_drivers',
  'duplicado',
  jsonb_build_object('rut_conductor', rut_norm, 'rut_empresa', rut_empresa_norm, 'nombre_completo', nombre_completo)
FROM (
  SELECT
    d.nombre_completo,
    app.normalize_rut(d.rut_conductor) AS rut_norm,
    app.normalize_rut(d.rut_empresa)   AS rut_empresa_norm,
    row_number() OVER (PARTITION BY app.normalize_rut(d.rut_conductor) ORDER BY d.ctid) AS rn
  FROM bronze.raw_centralizer_drivers d
  WHERE nullif(trim(d.rut_conductor), '') IS NOT NULL
) r
WHERE rn > 1;

-- ── duplicado: vehicles (mismo ranking que dbt/stg_centralizer_vehicles.sql) ─
INSERT INTO ops.pipeline_rejects (batch_id, source_table, reason, raw_row)
SELECT
  (SELECT max(batch_id) FROM ops.pipeline_runs WHERE pipeline = 'centralizer_to_app'),
  'raw_centralizer_vehicles',
  'duplicado',
  jsonb_build_object('patente', plate_norm, 'rut_empresa', rut_empresa_norm)
FROM (
  SELECT
    upper(replace(v.patente, ' ', ''))  AS plate_norm,
    app.normalize_rut(v.rut_empresa)    AS rut_empresa_norm,
    row_number() OVER (PARTITION BY upper(replace(v.patente, ' ', '')) ORDER BY v.ctid) AS rn
  FROM bronze.raw_centralizer_vehicles v
  WHERE nullif(trim(v.patente), '') IS NOT NULL
) r
WHERE rn > 1;

-- ── huerfano: drivers (rut_empresa sin match en la vista de transporters) ───
INSERT INTO ops.pipeline_rejects (batch_id, source_table, reason, raw_row)
SELECT
  (SELECT max(batch_id) FROM ops.pipeline_runs WHERE pipeline = 'centralizer_to_app'),
  'raw_centralizer_drivers',
  'huerfano',
  jsonb_build_object('rut_conductor', r.rut_norm, 'rut_empresa', r.rut_empresa_norm, 'nombre_completo', r.nombre_completo)
FROM (
  SELECT
    d.nombre_completo,
    app.normalize_rut(d.rut_conductor) AS rut_norm,
    app.normalize_rut(d.rut_empresa)   AS rut_empresa_norm,
    row_number() OVER (PARTITION BY app.normalize_rut(d.rut_conductor) ORDER BY d.ctid) AS rn
  FROM bronze.raw_centralizer_drivers d
  WHERE nullif(trim(d.rut_conductor), '') IS NOT NULL
) r
LEFT JOIN silver.stg_centralizer_transporters t ON t.rut = r.rut_empresa_norm
WHERE r.rn = 1 AND t.rut IS NULL;

-- ── huerfano: vehicles ────────────────────────────────────────────────────────
INSERT INTO ops.pipeline_rejects (batch_id, source_table, reason, raw_row)
SELECT
  (SELECT max(batch_id) FROM ops.pipeline_runs WHERE pipeline = 'centralizer_to_app'),
  'raw_centralizer_vehicles',
  'huerfano',
  jsonb_build_object('patente', r.plate_norm, 'rut_empresa', r.rut_empresa_norm)
FROM (
  SELECT
    upper(replace(v.patente, ' ', ''))  AS plate_norm,
    app.normalize_rut(v.rut_empresa)    AS rut_empresa_norm,
    row_number() OVER (PARTITION BY upper(replace(v.patente, ' ', '')) ORDER BY v.ctid) AS rn
  FROM bronze.raw_centralizer_vehicles v
  WHERE nullif(trim(v.patente), '') IS NOT NULL
) r
LEFT JOIN silver.stg_centralizer_transporters t ON t.rut = r.rut_empresa_norm
WHERE r.rn = 1 AND t.rut IS NULL;

-- ── fecha_invalida: drivers (2 columnas de fecha, filas rn=1) ─────────────────
INSERT INTO ops.pipeline_rejects (batch_id, source_table, reason, raw_row)
SELECT
  (SELECT max(batch_id) FROM ops.pipeline_runs WHERE pipeline = 'centralizer_to_app'),
  'raw_centralizer_drivers',
  'fecha_invalida',
  jsonb_build_object('rut', r.rut_norm, 'campo', c.campo, 'valor_crudo', c.raw_value)
FROM (
  SELECT
    d.*,
    app.normalize_rut(d.rut_conductor) AS rut_norm,
    row_number() OVER (PARTITION BY app.normalize_rut(d.rut_conductor) ORDER BY d.ctid) AS rn
  FROM bronze.raw_centralizer_drivers d
  WHERE nullif(trim(d.rut_conductor), '') IS NOT NULL
) r
CROSS JOIN LATERAL (VALUES
  ('copia_c_i__vencimiento_', r."copia_c_i__vencimiento_"),
  ('licencia__vencimiento_',  r."licencia__vencimiento_")
) AS c(campo, raw_value)
WHERE r.rn = 1
  AND nullif(trim(c.raw_value), '') IS NOT NULL AND trim(c.raw_value) <> '-'
  AND silver.parse_centralizer_date(c.raw_value) IS NULL;

-- ── fecha_invalida: vehicles (4 columnas de fecha, filas rn=1) ────────────────
INSERT INTO ops.pipeline_rejects (batch_id, source_table, reason, raw_row)
SELECT
  (SELECT max(batch_id) FROM ops.pipeline_runs WHERE pipeline = 'centralizer_to_app'),
  'raw_centralizer_vehicles',
  'fecha_invalida',
  jsonb_build_object('patente', r.plate_norm, 'campo', c.campo, 'valor_crudo', c.raw_value)
FROM (
  SELECT
    v.*,
    upper(replace(v.patente, ' ', '')) AS plate_norm,
    row_number() OVER (PARTITION BY upper(replace(v.patente, ' ', '')) ORDER BY v.ctid) AS rn
  FROM bronze.raw_centralizer_vehicles v
  WHERE nullif(trim(v.patente), '') IS NOT NULL
) r
CROSS JOIN LATERAL (VALUES
  ('p__circulación',      r."p__circulación"),
  ('re__técnica',         r."re__técnica"),
  ('gases_contaminantes', r.gases_contaminantes),
  ('seguro__soap_',       r."seguro__soap_")
) AS c(campo, raw_value)
WHERE r.rn = 1
  AND nullif(trim(c.raw_value), '') IS NOT NULL AND trim(c.raw_value) <> '-'
  AND silver.parse_centralizer_date(c.raw_value) IS NULL;

-- ── fecha_invalida: insurance (3 columnas de fecha, filas que entran al stg) ─
INSERT INTO ops.pipeline_rejects (batch_id, source_table, reason, raw_row)
SELECT
  (SELECT max(batch_id) FROM ops.pipeline_runs WHERE pipeline = 'centralizer_to_app'),
  'raw_insurance_vehicles',
  'fecha_invalida',
  jsonb_build_object('rut', r.rut_norm, 'policy_number', r.policy_number_clean, 'campo', c.campo, 'valor_crudo', c.raw_value)
FROM (
  SELECT
    iv.*,
    app.normalize_rut(iv.rut)                              AS rut_norm,
    nullif(trim(iv."póliza"), '')                          AS policy_number_clean,
    nullif(split_part(iv."cuota__número_", ' de ', 1), '') AS installment_number_raw
  FROM bronze.raw_insurance_vehicles iv
) r
CROSS JOIN LATERAL (VALUES
  ('vigencia__desde_', r.vigencia__desde_),
  ('vigencia__hasta_', r.vigencia__hasta_),
  ('vencimiento',      r.vencimiento)
) AS c(campo, raw_value)
WHERE r.policy_number_clean IS NOT NULL
  AND r.installment_number_raw IS NOT NULL AND r.installment_number_raw ~ '^\d+$'
  AND nullif(trim(c.raw_value), '') IS NOT NULL AND trim(c.raw_value) <> '-'
  AND silver.parse_insurance_date(c.raw_value) IS NULL;

-- ── valor_no_mapeado: docs de transporter (14 columnas, fila ganadora) ───────
INSERT INTO ops.pipeline_rejects (batch_id, source_table, reason, raw_row)
SELECT
  (SELECT max(batch_id) FROM ops.pipeline_runs WHERE pipeline = 'centralizer_to_app'),
  'raw_centralizer_transporter',
  'valor_no_mapeado',
  jsonb_build_object('rut', r.rut_norm, 'doc_code', c.doc_code, 'valor_crudo', c.raw_value)
FROM (
  SELECT
    t.*,
    app.normalize_rut(t.rut) AS rut_norm,
    row_number() OVER (
      PARTITION BY app.normalize_rut(t.rut)
      ORDER BY (t.gc = 'Walmart') DESC, t.ctid
    ) AS rn
  FROM bronze.raw_centralizer_transporter t
  WHERE nullif(trim(t.rut), '') IS NOT NULL
) r
CROSS JOIN LATERAL (VALUES
  ('rol_sii',            r.rol_sii),
  ('copia_ci_rep_legal', r.copia_c_i_rep__legal),
  ('anexo_2_walmart',    r.anexo_repleg__gc_),
  ('validado_gc',        r.validado_por_gc),
  ('contrato_webcarga',  r.contrato_webcarga),
  ('f30_multas',         r.f30__multas_),
  ('f43',                r.f43),
  ('politica_seguridad', r."política_de_seguridad"),
  ('cert_mutual',        r."cert__afiliación_mutual"),
  ('riohs_timbrado',     r.riohs_timbrado),
  ('carpeta_tributaria', r.carpeta_tributaria),
  ('cuenta_empresa',     r.cuenta_banco_empresa),
  ('pts_contratista',    r.procedimiento_de_trabajo_seguro_del_contratista),
  ('creacion_walmart',   r."creación__en_gc")
) AS c(doc_code, raw_value)
WHERE r.rn = 1
  AND nullif(trim(c.raw_value), '') IS NOT NULL
  AND silver.map_doc_status(c.raw_value) IS NULL;

-- ── valor_no_mapeado: docs de driver (12 columnas de status, filas en el stg) ─
INSERT INTO ops.pipeline_rejects (batch_id, source_table, reason, raw_row)
SELECT
  (SELECT max(batch_id) FROM ops.pipeline_runs WHERE pipeline = 'centralizer_to_app'),
  'raw_centralizer_drivers',
  'valor_no_mapeado',
  jsonb_build_object('rut', r.rut_norm, 'doc_code', c.doc_code, 'valor_crudo', c.raw_value)
FROM (
  SELECT
    d.*,
    app.normalize_rut(d.rut_conductor) AS rut_norm,
    row_number() OVER (PARTITION BY app.normalize_rut(d.rut_conductor) ORDER BY d.ctid) AS rn
  FROM bronze.raw_centralizer_drivers d
  WHERE nullif(trim(d.rut_conductor), '') IS NOT NULL
) r
JOIN silver.stg_centralizer_drivers s ON s.rut = r.rut_norm
CROSS JOIN LATERAL (VALUES
  ('anexo_3_walmart',            r.anexo_gc_para_conductor),
  ('epp',                        r.epp),
  ('das_odi',                    r.das___odi),
  ('hoja_de_vida',               r.hoja_de_vida),
  ('cert_antecedentes',          r."cert__antecedentes"),
  ('validado_walmart',           r.validado_por_gc),
  ('contrato_trabajo',           r.contrato_de_trabajo),
  ('toma_conoc_plan_emergencia', r.toma_conoc__trab__plan_de_emergencia_del_mandante),
  ('toma_conoc_pts',             r.toma_conoc__trab__procedimiento_de_trabajo_seguro),
  ('capacitacion_epp',           r."capacitación_uso_y_mantención_de_epp"),
  ('creacion_walmart_driver',    r."creación_en_gc"),
  ('f30_1',                      r.f30_1)
) AS c(doc_code, raw_value)
WHERE r.rn = 1
  AND nullif(trim(c.raw_value), '') IS NOT NULL
  AND silver.map_doc_status(c.raw_value) IS NULL;

-- ── valor_no_mapeado: docs de vehicle (6 columnas de status, filas en el stg;
--    EXCLUYE "creación_en_gc" — trae 'Sodimac', se salta silenciosa) ──────────
INSERT INTO ops.pipeline_rejects (batch_id, source_table, reason, raw_row)
SELECT
  (SELECT max(batch_id) FROM ops.pipeline_runs WHERE pipeline = 'centralizer_to_app'),
  'raw_centralizer_vehicles',
  'valor_no_mapeado',
  jsonb_build_object('patente', r.plate_norm, 'doc_code', c.doc_code, 'valor_crudo', c.raw_value)
FROM (
  SELECT
    v.*,
    upper(replace(v.patente, ' ', '')) AS plate_norm,
    row_number() OVER (PARTITION BY upper(replace(v.patente, ' ', '')) ORDER BY v.ctid) AS rn
  FROM bronze.raw_centralizer_vehicles v
  WHERE nullif(trim(v.patente), '') IS NOT NULL
) r
JOIN silver.stg_centralizer_vehicles s ON s.plate = r.plate_norm
CROSS JOIN LATERAL (VALUES
  ('padron',                 r."padrón"),
  ('gps',                    r.gps),
  ('mantencion_camara_frio', r."mantención_cámara_frío"),
  ('resolucion_sanitaria',   r.resolucion_sanitaria),
  ('poliza_rc',              r."póliza_vehicular_con_rc"),
  ('seguro_carga',           r.seguro_de_carga)
) AS c(doc_code, raw_value)
WHERE r.rn = 1
  AND nullif(trim(c.raw_value), '') IS NOT NULL
  AND silver.map_doc_status(c.raw_value) IS NULL;

-- ── valor_no_mapeado: tipo_de_equipo no reconocido (kind='otro') ──────────────
INSERT INTO ops.pipeline_rejects (batch_id, source_table, reason, raw_row)
SELECT
  (SELECT max(batch_id) FROM ops.pipeline_runs WHERE pipeline = 'centralizer_to_app'),
  'raw_centralizer_vehicles',
  'valor_no_mapeado',
  jsonb_build_object('patente', r.plate_norm, 'campo', 'tipo_de_equipo', 'valor_crudo', r.tipo_de_equipo)
FROM (
  SELECT
    v.tipo_de_equipo,
    upper(replace(v.patente, ' ', '')) AS plate_norm,
    row_number() OVER (PARTITION BY upper(replace(v.patente, ' ', '')) ORDER BY v.ctid) AS rn
  FROM bronze.raw_centralizer_vehicles v
  WHERE nullif(trim(v.patente), '') IS NOT NULL
) r
WHERE r.rn = 1
  AND nullif(trim(r.tipo_de_equipo), '') IS NOT NULL
  AND upper(trim(r.tipo_de_equipo)) NOT IN ('TRACTOCAMION', 'RAMPLA');

-- ── valor_no_mapeado: insurance sin número de póliza ──────────────────────────
INSERT INTO ops.pipeline_rejects (batch_id, source_table, reason, raw_row)
SELECT
  (SELECT max(batch_id) FROM ops.pipeline_runs WHERE pipeline = 'centralizer_to_app'),
  'raw_insurance_vehicles',
  'valor_no_mapeado',
  jsonb_build_object('rut', app.normalize_rut(rut), 'campo', 'póliza', 'valor_crudo', "póliza")
FROM bronze.raw_insurance_vehicles
WHERE nullif(trim("póliza"), '') IS NULL;

-- ── valor_no_mapeado: insurance con cuota sin número (vacío o no numérico) ───
INSERT INTO ops.pipeline_rejects (batch_id, source_table, reason, raw_row)
SELECT
  (SELECT max(batch_id) FROM ops.pipeline_runs WHERE pipeline = 'centralizer_to_app'),
  'raw_insurance_vehicles',
  'valor_no_mapeado',
  jsonb_build_object('rut', app.normalize_rut(rut), 'campo', 'cuota__número_', 'valor_crudo', "cuota__número_")
FROM bronze.raw_insurance_vehicles
WHERE nullif(trim("póliza"), '') IS NOT NULL
  AND (
    nullif(split_part("cuota__número_", ' de ', 1), '') IS NULL
    OR nullif(split_part("cuota__número_", ' de ', 1), '') !~ '^\d+$'
  );
