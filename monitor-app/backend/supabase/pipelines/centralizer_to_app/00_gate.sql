-- ==============================================================================
-- PIPELINE: centralizer_to_app — 00_gate.sql
-- Plan: monitor-app/docs/plan-modulo-empresas-seguros.md §2.1
--
-- (1) Funciones de parsing/mapeo compartidas por los modelos dbt (dbt/) y
--     por 15_rejects.sql:
--       silver.parse_centralizer_date  — fechas mixtas ISO / M-D-YYYY gringo
--       silver.parse_insurance_date    — variante que prioriza DD/MM/YYYY
--       silver.map_doc_status          — mapeo de estado de documento → app.compliance_status
--     Este bloque corre ANTES de dbt en el DAG de Mage: los modelos (vistas)
--     invocan estas funciones, así que deben existir antes del primer dbt run.
-- (2) Bloque DO de arranque de corrida:
--       - resuelve batch_id = max(batch_id) + 1 sobre ops.pipeline_runs
--       - inserta la fila 'running' en ops.pipeline_runs
--       - valida schema drift de las 5 tablas bronze contra la lista de
--         columnas EXACTA esperada (information_schema.columns); si difiere,
--         marca la corrida 'schema_drift' con el detalle en `error` y aborta
--         con RAISE EXCEPTION (rollback total, no toca silver/app).
--
-- NOTA bronze.batch_id/loaded_at: bronze AÚN NO tiene estas columnas (las
-- agrega el loader de Pablo/Fabián más adelante — ver README). batch_id acá
-- es el contador propio del pipeline en ops.pipeline_runs, no una columna de
-- bronze.
-- ==============================================================================

CREATE SCHEMA IF NOT EXISTS silver;

-- ── silver.parse_centralizer_date ────────────────────────────────────────────
-- Fechas mixtas verificadas en bronze.raw_centralizer_*: ISO ('2027-01-07T00:00:00')
-- y gringo M/D/YYYY ('8/29/2030'). NULL si vacío/NULL/'-'. Si el primer número
-- del patrón M/D/YYYY es > 12, se reinterpreta como D/M/YYYY (día primero).
-- Cualquier otro patrón → NULL (el caller decide si eso amerita reject).
CREATE OR REPLACE FUNCTION silver.parse_centralizer_date(input text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v      text := nullif(trim(input), '');
  parts  text[];
  v_a    int;
  v_b    int;
  v_c    int;
BEGIN
  IF v IS NULL OR v = '-' THEN
    RETURN NULL;
  END IF;

  IF v ~ '^\d{4}-\d{2}-\d{2}' THEN
    BEGIN
      RETURN substring(v FROM 1 FOR 10)::date;
    EXCEPTION WHEN OTHERS THEN
      RETURN NULL;
    END;
  END IF;

  IF v ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN
    parts := regexp_split_to_array(v, '/');
    BEGIN
      v_a := parts[1]::int;  -- por defecto: mes
      v_b := parts[2]::int;  -- por defecto: día
      v_c := parts[3]::int;  -- año
      IF v_a > 12 THEN
        -- el primer número no puede ser mes → es D/M/YYYY
        RETURN make_date(v_c, v_b, v_a);
      ELSE
        RETURN make_date(v_c, v_a, v_b);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RETURN NULL;
    END;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION silver.parse_centralizer_date(text) IS
  'Parser de fechas mixtas de bronze.raw_centralizer_* (ISO y M/D/YYYY gringo con heurística de ambigüedad). NULL = vacío o no parseable (reject fecha_invalida a cargo del caller).';

-- ── silver.parse_insurance_date ──────────────────────────────────────────────
-- Variante para bronze.raw_insurance_vehicles: fechas confirmadas en formato
-- chileno DD/MM/YYYY ('23/03/2025'). A diferencia de parse_centralizer_date,
-- NO aplica heurística de ambigüedad: siempre día primero.
CREATE OR REPLACE FUNCTION silver.parse_insurance_date(input text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v      text := nullif(trim(input), '');
  parts  text[];
  v_d    int;
  v_m    int;
  v_y    int;
BEGIN
  IF v IS NULL OR v = '-' THEN
    RETURN NULL;
  END IF;

  IF v ~ '^\d{4}-\d{2}-\d{2}' THEN
    BEGIN
      RETURN substring(v FROM 1 FOR 10)::date;
    EXCEPTION WHEN OTHERS THEN
      RETURN NULL;
    END;
  END IF;

  IF v ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN
    parts := regexp_split_to_array(v, '/');
    BEGIN
      v_d := parts[1]::int;
      v_m := parts[2]::int;
      v_y := parts[3]::int;
      RETURN make_date(v_y, v_m, v_d);
    EXCEPTION WHEN OTHERS THEN
      RETURN NULL;
    END;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION silver.parse_insurance_date(text) IS
  'Parser de fechas de bronze.raw_insurance_vehicles: prioriza DD/MM/YYYY (formato confirmado en los datos). NULL = vacío o no parseable.';

-- ── silver.map_doc_status ────────────────────────────────────────────────────
-- Mapeo case-insensitive/trim de estado de documento del centralizer →
-- app.compliance_status. NULL para vacío/NULL Y para valores no reconocidos
-- (el caller distingue "vacío" de "no reconocido" comparando contra el crudo
-- y genera el reject valor_no_mapeado solo en el segundo caso).
CREATE OR REPLACE FUNCTION silver.map_doc_status(input text)
RETURNS app.compliance_status
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(trim(coalesce(input, '')))
    WHEN ''          THEN NULL
    WHEN 'ok'         THEN 'ok'::app.compliance_status
    WHEN 'pendiente'  THEN 'pendiente'::app.compliance_status
    WHEN 'factible'   THEN 'factible'::app.compliance_status
    WHEN 'actualizar' THEN 'actualizar'::app.compliance_status
    WHEN 'n/a'        THEN 'n_a'::app.compliance_status
    WHEN 'na'         THEN 'n_a'::app.compliance_status
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION silver.map_doc_status(text) IS
  'ok→ok, pendiente→pendiente, factible→factible, actualizar→actualizar, n/a|na→n_a, vacío/NULL→NULL. Cualquier otro valor no vacío → NULL (el caller genera reject valor_no_mapeado).';

-- ── Arranque de corrida: batch_id + schema drift gate ────────────────────────
DO $$
DECLARE
  v_batch_id bigint;
  v_run_id   bigint;
  v_drift    jsonb := '[]'::jsonb;
  v_expected text[];
  v_actual   text[];
  v_missing  text[];
  v_extra    text[];
BEGIN
  v_batch_id := (
    SELECT coalesce(max(batch_id), 0) + 1
    FROM ops.pipeline_runs
    WHERE pipeline = 'centralizer_to_app'
  );

  INSERT INTO ops.pipeline_runs (pipeline, batch_id, started_at, status)
  VALUES ('centralizer_to_app', v_batch_id, now(), 'running')
  RETURNING id INTO v_run_id;

  -- ── bronze.raw_centralizer_transporter (27 columnas) ───────────────────────
  v_expected := ARRAY[
    'nombre___razón_social','rut','dv','rol_sii','copia_c_i_rep__legal',
    'anexo_repleg__gc_','validado_por_gc','contrato_webcarga','f30__multas_','f43',
    'política_de_seguridad','cert__afiliación_mutual','riohs_timbrado','carpeta_tributaria',
    'cuenta_banco_empresa','procedimiento_de_trabajo_seguro_del_contratista',
    'creación__en_gc','gc','seguro_eett__rc__en_uf','cobertura_rc','cuotas',
    'vencimiento_cuota','estado','link_de_pago','link_de_sharepoint','avance_80_20','avance_total'
  ];
  SELECT array_agg(column_name) INTO v_actual
  FROM information_schema.columns
  WHERE table_schema = 'bronze' AND table_name = 'raw_centralizer_transporter';
  v_missing := (SELECT coalesce(array_agg(c), '{}') FROM unnest(v_expected) c WHERE NOT (c = ANY (coalesce(v_actual, '{}'))));
  v_extra   := (SELECT coalesce(array_agg(c), '{}') FROM unnest(coalesce(v_actual, '{}')) c WHERE NOT (c = ANY (v_expected)));
  IF array_length(v_missing, 1) IS NOT NULL OR array_length(v_extra, 1) IS NOT NULL THEN
    v_drift := v_drift || jsonb_build_object(
      'table', 'bronze.raw_centralizer_transporter',
      'missing', to_jsonb(v_missing), 'extra', to_jsonb(v_extra)
    );
  END IF;

  -- ── bronze.raw_centralizer_drivers (21 columnas) ───────────────────────────
  v_expected := ARRAY[
    'rut_empresa','dv_empresa','nombre_completo','rut_conductor','dv_conductor',
    'copia_c_i__vencimiento_','licencia__vencimiento_','anexo_gc_para_conductor','epp',
    'das___odi','hoja_de_vida','cert__antecedentes','validado_por_gc','contrato_de_trabajo',
    'toma_conoc__trab__plan_de_emergencia_del_mandante',
    'toma_conoc__trab__procedimiento_de_trabajo_seguro',
    'capacitación_uso_y_mantención_de_epp','creación_en_gc','gc','f30_1','avance_total'
  ];
  SELECT array_agg(column_name) INTO v_actual
  FROM information_schema.columns
  WHERE table_schema = 'bronze' AND table_name = 'raw_centralizer_drivers';
  v_missing := (SELECT coalesce(array_agg(c), '{}') FROM unnest(v_expected) c WHERE NOT (c = ANY (coalesce(v_actual, '{}'))));
  v_extra   := (SELECT coalesce(array_agg(c), '{}') FROM unnest(coalesce(v_actual, '{}')) c WHERE NOT (c = ANY (v_expected)));
  IF array_length(v_missing, 1) IS NOT NULL OR array_length(v_extra, 1) IS NOT NULL THEN
    v_drift := v_drift || jsonb_build_object(
      'table', 'bronze.raw_centralizer_drivers',
      'missing', to_jsonb(v_missing), 'extra', to_jsonb(v_extra)
    );
  END IF;

  -- ── bronze.raw_centralizer_vehicles (26 columnas) ──────────────────────────
  v_expected := ARRAY[
    'rut_empresa','dv_empresa','tipo_de_equipo','patente','año','padrón',
    'p__circulación','re__técnica','gases_contaminantes','seguro__soap_','gps',
    'mantención_cámara_frío','resolucion_sanitaria','póliza_vehicular_con_rc',
    'cobertura_rc','cuotas','vencimiento_cuota','estado','link_de_pago_rc_vehicular',
    'seguro_de_carga','cobertura_sc','cuotas_1','vencimiento_cuota_1','estado_1',
    'link_de_pago_seguro_de_carga','creación_en_gc'
  ];
  SELECT array_agg(column_name) INTO v_actual
  FROM information_schema.columns
  WHERE table_schema = 'bronze' AND table_name = 'raw_centralizer_vehicles';
  v_missing := (SELECT coalesce(array_agg(c), '{}') FROM unnest(v_expected) c WHERE NOT (c = ANY (coalesce(v_actual, '{}'))));
  v_extra   := (SELECT coalesce(array_agg(c), '{}') FROM unnest(coalesce(v_actual, '{}')) c WHERE NOT (c = ANY (v_expected)));
  IF array_length(v_missing, 1) IS NOT NULL OR array_length(v_extra, 1) IS NOT NULL THEN
    v_drift := v_drift || jsonb_build_object(
      'table', 'bronze.raw_centralizer_vehicles',
      'missing', to_jsonb(v_missing), 'extra', to_jsonb(v_extra)
    );
  END IF;

  -- ── bronze.raw_info_contacto (32 columnas) ─────────────────────────────────
  v_expected := ARRAY[
    'validador','id_cuenta_eett','id_interno_admin','nombre_empresa','razon_social','rut',
    'representante_legal','teléfono_rl','correo_rl','contacto_operacional','tel__contacto_ops',
    'correo_contacto_operacional','contacto_finanzas','tel_finanzas','correo_finanzas',
    'contacto_documentos','telefono_documentos','correo_documentos','contrato_entre_empresas',
    'flota_potencial','flota_webcarga','destinos_favoritos','cliente_1','botellero','sider',
    'furgon_28_pallet','plano','camión_carro','chasis_14_pallets','chasis_12_pallets',
    'chasis_10_pallets','unnamed__31'
  ];
  SELECT array_agg(column_name) INTO v_actual
  FROM information_schema.columns
  WHERE table_schema = 'bronze' AND table_name = 'raw_info_contacto';
  v_missing := (SELECT coalesce(array_agg(c), '{}') FROM unnest(v_expected) c WHERE NOT (c = ANY (coalesce(v_actual, '{}'))));
  v_extra   := (SELECT coalesce(array_agg(c), '{}') FROM unnest(coalesce(v_actual, '{}')) c WHERE NOT (c = ANY (v_expected)));
  IF array_length(v_missing, 1) IS NOT NULL OR array_length(v_extra, 1) IS NOT NULL THEN
    v_drift := v_drift || jsonb_build_object(
      'table', 'bronze.raw_info_contacto',
      'missing', to_jsonb(v_missing), 'extra', to_jsonb(v_extra)
    );
  END IF;

  -- ── bronze.raw_insurance_vehicles (13 columnas) ────────────────────────────
  v_expected := ARRAY[
    'contratante','rut','grupo','compañía','póliza','endoso','vigencia__desde_',
    'vigencia__hasta_','cobertura','cuota__número_','valor_cuota_uf','vencimiento','estado'
  ];
  SELECT array_agg(column_name) INTO v_actual
  FROM information_schema.columns
  WHERE table_schema = 'bronze' AND table_name = 'raw_insurance_vehicles';
  v_missing := (SELECT coalesce(array_agg(c), '{}') FROM unnest(v_expected) c WHERE NOT (c = ANY (coalesce(v_actual, '{}'))));
  v_extra   := (SELECT coalesce(array_agg(c), '{}') FROM unnest(coalesce(v_actual, '{}')) c WHERE NOT (c = ANY (v_expected)));
  IF array_length(v_missing, 1) IS NOT NULL OR array_length(v_extra, 1) IS NOT NULL THEN
    v_drift := v_drift || jsonb_build_object(
      'table', 'bronze.raw_insurance_vehicles',
      'missing', to_jsonb(v_missing), 'extra', to_jsonb(v_extra)
    );
  END IF;

  -- ── Veredicto ───────────────────────────────────────────────────────────────
  IF jsonb_array_length(v_drift) > 0 THEN
    UPDATE ops.pipeline_runs
    SET status = 'schema_drift', finished_at = now(), error = v_drift::text
    WHERE id = v_run_id;

    RAISE EXCEPTION 'centralizer_to_app: schema drift detectado (batch %): %', v_batch_id, v_drift::text;
  END IF;
END $$;
