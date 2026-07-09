-- ==============================================================================
-- MIGRACIÓN: MÓDULO EMPRESAS EETT + SEGUROS — FASE 1 (C) CUMPLIMIENTO
-- Plan: monitor-app/docs/plan-modulo-empresas-seguros.md §1.4
--
-- Catálogo dirigido por datos (agregar un cliente GC con exigencias distintas
-- = INSERT, no deploy), documentos por entidad (transporter/driver/vehicle) y
-- versionado de archivos generalizado (app.stored_files, owner_type/owner_id
-- polimórfico — cubre tanto compliance_documents como insurance_policies).
--
-- doc_code / labels: mapeo bronze→frontend acordado en la reunión 2026-07-08
-- (ver plan, sección de instrucciones de esta fase). sort_order incremental
-- por entity_type. weight_80_20=1 marca la aproximación del corte 80/20 de
-- ingreso (ajustable por UPDATE posterior, no es definitivo).
-- ==============================================================================

-- ── app.compliance_doc_catalog ─────────────────────────────────────────────
CREATE TABLE app.compliance_doc_catalog (
  doc_code             text    PRIMARY KEY,
  entity_type          text    NOT NULL CHECK (entity_type IN ('transporter', 'driver', 'vehicle')),
  label                text    NOT NULL,
  required_for_clients text[]  NOT NULL DEFAULT '{Walmart}',
  has_expiry           boolean NOT NULL DEFAULT false,
  weight_80_20         numeric NOT NULL DEFAULT 0,
  sort_order           int     NOT NULL DEFAULT 0
);

COMMENT ON COLUMN app.compliance_doc_catalog.weight_80_20 IS
  'Marca (>0) los documentos que aproximan el corte 80/20 de avance de ingreso del Excel origen. Aproximación editable, no fórmula definitiva.';

INSERT INTO app.compliance_doc_catalog (doc_code, entity_type, label, has_expiry, weight_80_20, sort_order) VALUES
  -- transporter (13 docs del mapeo bronze→frontend)
  ('rol_sii',             'transporter', 'Rol SII',                              false, 1, 10),
  ('copia_ci_rep_legal',  'transporter', 'Copia cédula de identidad rep. legal', false, 1, 20),
  ('anexo_2_walmart',     'transporter', 'Anexo 2 Walmart',                      false, 0, 30),
  ('contrato_webcarga',   'transporter', 'Contrato Webcarga',                    false, 1, 40),
  ('f30_multas',          'transporter', 'F30 - Multas',                         false, 0, 50),
  ('f43',                 'transporter', 'F43',                                  false, 0, 60),
  ('politica_seguridad',  'transporter', 'Política de seguridad',                false, 0, 70),
  ('cert_mutual',         'transporter', 'Certificado de afiliación mutual',     false, 0, 80),
  ('riohs_timbrado',      'transporter', 'RIOHS timbrado',                       false, 0, 90),
  ('carpeta_tributaria',  'transporter', 'Carpeta tributaria',                   false, 0, 100),
  ('cuenta_empresa',      'transporter', 'Cuenta de la empresa',                 false, 1, 110),
  ('creacion_walmart',    'transporter', 'Creación en Walmart',                  false, 0, 120),
  ('pts_contratista',     'transporter', 'PTS contratista',                      false, 0, 130),

  -- driver (15 docs)
  ('copia_ci',                   'driver', 'Copia cédula de identidad',                 true,  1, 10),
  ('licencia',                   'driver', 'Licencia de conducir',                      true,  1, 20),
  ('anexo_3_walmart',            'driver', 'Anexo 3 Walmart',                           false, 0, 30),
  ('epp',                        'driver', 'EPP (elementos de protección personal)',    false, 0, 40),
  ('das_odi',                    'driver', 'DAS / ODI',                                 false, 0, 50),
  ('hoja_de_vida',                'driver', 'Hoja de vida del conductor',                false, 0, 60),
  ('cert_antecedentes',          'driver', 'Certificado de antecedentes',               false, 0, 70),
  ('validado_walmart',           'driver', 'Validado por Walmart',                      false, 0, 80),
  ('contrato_trabajo',           'driver', 'Contrato de trabajo',                       false, 0, 90),
  ('creacion_walmart_driver',    'driver', 'Creación en Walmart (conductor)',           false, 0, 100),
  ('toma_conoc_plan_emergencia', 'driver', 'Toma de conocimiento plan de emergencia',   false, 0, 110),
  ('toma_conoc_pts',             'driver', 'Toma de conocimiento PTS',                  false, 0, 120),
  ('capacitacion_epp',           'driver', 'Capacitación EPP',                          false, 0, 130),
  ('gc_driver',                  'driver', 'Gran cuenta (conductor)',                   false, 0, 140),
  ('f30_1',                      'driver', 'F30-1',                                     false, 0, 150),

  -- vehicle (11 docs)
  ('padron',                   'vehicle', 'Padrón',                              false, 1, 10),
  ('permiso_circulacion',      'vehicle', 'Permiso de circulación',              true,  1, 20),
  ('revision_tecnica',         'vehicle', 'Revisión técnica',                    true,  1, 30),
  ('gases',                    'vehicle', 'Certificado de gases',                true,  0, 40),
  ('soap',                     'vehicle', 'SOAP',                                true,  1, 50),
  ('gps',                      'vehicle', 'GPS',                                 false, 0, 60),
  ('poliza_rc',                'vehicle', 'Póliza RC vehicular',                 false, 0, 70),
  ('seguro_carga',             'vehicle', 'Seguro de carga',                     false, 0, 80),
  ('mantencion_camara_frio',   'vehicle', 'Mantención cámara de frío',           false, 0, 90),
  ('resolucion_sanitaria',     'vehicle', 'Resolución sanitaria',                false, 0, 100),
  ('creacion_walmart_vehicle', 'vehicle', 'Creación en Walmart (vehículo)',      false, 0, 110)
ON CONFLICT (doc_code) DO NOTHING;

-- ── app.compliance_documents ────────────────────────────────────────────────
CREATE TABLE app.compliance_documents (
  id              uuid                  PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     text                  NOT NULL CHECK (entity_type IN ('transporter', 'driver', 'vehicle')),
  entity_id       uuid                  NOT NULL,
  doc_code        text                  NOT NULL REFERENCES app.compliance_doc_catalog(doc_code),
  status          app.compliance_status,
  expiry_date     date,
  file_url        text,
  storage_path    text,
  notes           text,
  source          text                  NOT NULL DEFAULT 'centralizer',
  manual_override boolean               NOT NULL DEFAULT false,
  updated_by      uuid,
  updated_at      timestamptz           NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id, doc_code)
);

COMMENT ON COLUMN app.compliance_documents.manual_override IS
  'true = editado manualmente en la app; el upsert del pipeline (§2.5) no pisa esta fila mientras esté en true.';

CREATE INDEX idx_compliance_documents_entity ON app.compliance_documents (entity_type, entity_id);

CREATE TRIGGER compliance_documents_set_updated_at
  BEFORE UPDATE ON app.compliance_documents
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- ── app.stored_files (versionado generalizado) ─────────────────────────────
-- Owner polimórfico: cubre tanto compliance_documents como insurance_policies
-- (plan §1.5 nota — "implementar la versión generalizada"). Re-subir no
-- borra; cada upload agrega una versión nueva. El campo storage_path/file_url
-- vigente vive en la tabla dueña (compliance_documents / insurance_policies);
-- el historial completo vive acá.
CREATE TABLE app.stored_files (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type   text        NOT NULL CHECK (owner_type IN ('compliance_document', 'insurance_policy')),
  owner_id     uuid        NOT NULL,
  storage_path text        NOT NULL,
  file_name    text        NOT NULL,
  mime_type    text,
  size_bytes   bigint,
  version      int         NOT NULL,
  uploaded_by  uuid,
  uploaded_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_type, owner_id, version)
);

CREATE INDEX idx_stored_files_owner ON app.stored_files (owner_type, owner_id);
