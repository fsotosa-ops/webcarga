-- ==============================================================================
-- Semilla del diccionario de alias: nombre de archivo → tipo de documento
-- ==============================================================================
--
-- Derivada de los nombres de archivo REALES observados (24 ya cargados en
-- compliance_records + muestra de los 2.094 de SharePoint). Ejemplos que
-- motivaron cada grupo:
--
--   "USO Y MANTENCION EPP- Abraham Ulloa.jpeg"  → CAPACITACION_EPP
--   "Uso y MTTO EPP Humberto Riquelme.jpeg"     → CAPACITACION_EPP (abreviado)
--   "EPP- Abraham Ulloa.jpeg"                   → ENTREGA_EPP
--   "TRABAJO SEGURO- Abrhama Ulloa.jpeg"        → PTS_CONDUCTOR
--   "F.30 JUNIO COM.DE LOS RIOS.pdf"            → F30_MULTAS
--   "Carpeta_Tributaria_Regular_77094744-8.pdf" → CARPETA_TRIBUTARIA
--   "SEGURO OBLIGATORIO.PNG"                    → SOAP
--
-- PRIORIDAD: gana el alias de mayor priority cuando varios matchean. Es lo que
-- resuelve el solapamiento por substring — "USO Y MANTENCION EPP" (100) tiene
-- que ganarle a "EPP" (10), que está contenido en él.
--
-- Los alias se comparan NORMALIZADOS (mayúsculas, sin tildes, sin puntuación);
-- la normalización la hace el motor, no esta tabla. Por eso acá se escriben sin
-- puntos ni tildes: "F30" cubre "F.30", "F 30" y "f30".
--
-- Este catálogo es editable por operaciones sin deploy: cuando aparece una forma
-- de escribir que el matcher no reconoce, se agrega una fila.
-- ==============================================================================

BEGIN;

INSERT INTO public.requirement_filename_aliases (requirement_id, alias, priority)
SELECT r.id, v.alias, v.priority
FROM (VALUES
    -- ── CONDUCTOR ────────────────────────────────────────────────────────────
    ('DRIVER', 'CAPACITACION_EPP',      'USO Y MANTENCION DE EPP',          110),
    ('DRIVER', 'CAPACITACION_EPP',      'USO Y MANTENCION EPP',             100),
    ('DRIVER', 'CAPACITACION_EPP',      'USO Y MTTO EPP',                   100),
    ('DRIVER', 'CAPACITACION_EPP',      'CAPACITACION EPP',                 100),
    ('DRIVER', 'CAPACITACION_EPP',      'MTTO EPP',                          90),
    ('DRIVER', 'ENTREGA_EPP',           'ENTREGA EPP',                       90),
    ('DRIVER', 'ENTREGA_EPP',           'EPP',                               10),
    ('DRIVER', 'PTS_CONDUCTOR',         'PROCEDIMIENTO DE TRABAJO SEGURO',  110),
    ('DRIVER', 'PTS_CONDUCTOR',         'TRABAJO SEGURO',                    80),
    ('DRIVER', 'PTS_CONDUCTOR',         'PTS',                               40),
    ('DRIVER', 'PLAN_EMERGENCIA',       'PLAN DE EMERGENCIA',               100),
    ('DRIVER', 'PLAN_EMERGENCIA',       'PLAN EMERGENCIA',                  100),
    ('DRIVER', 'LICENCIA_CONDUCIR',     'LICENCIA DE CONDUCIR',             100),
    ('DRIVER', 'LICENCIA_CONDUCIR',     'LICENCIA',                          60),
    ('DRIVER', 'COPIA_CI_CONDUCTOR',    'COPIA CI CONDUCTOR',               110),
    ('DRIVER', 'COPIA_CI_CONDUCTOR',    'CARNET',                            60),
    ('DRIVER', 'COPIA_CI_CONDUCTOR',    'CEDULA',                            60),
    ('DRIVER', 'COPIA_CI_CONDUCTOR',    'RUT',                               10),
    ('DRIVER', 'CERT_ANTECEDENTES',     'CERTIFICADO DE ANTECEDENTES',      110),
    ('DRIVER', 'CERT_ANTECEDENTES',     'ANTECEDENTES',                      70),
    ('DRIVER', 'CERT_ANTECEDENTES',     'ANTECEDENTE',                       70),
    ('DRIVER', 'CONTRATO_TRABAJO',      'CONTRATO DE TRABAJO',              110),
    ('DRIVER', 'CONTRATO_TRABAJO',      'CONTRATO',                          40),
    ('DRIVER', 'HOJA_DE_VIDA',          'HOJA DE VIDA',                     100),
    ('DRIVER', 'HOJA_DE_VIDA',          'HVID',                              80),
    ('DRIVER', 'DAS_ODI',               'OBLIGACION DE INFORMAR',           110),
    ('DRIVER', 'DAS_ODI',               'DAS ODI',                          100),
    ('DRIVER', 'DAS_ODI',               'ODI',                               50),
    ('DRIVER', 'ANEXO_GC_CONDUCTOR',    'ANEXO 3',                           80),
    ('DRIVER', 'CONTROL_MENSUAL_COL_T', 'CONTROL DOCUMENTAL MENSUAL',       110),
    ('DRIVER', 'CONTROL_MENSUAL_COL_T', 'CONTROL DOCUMENTAL',                90),

    -- ── EMPRESA ──────────────────────────────────────────────────────────────
    ('CARRIER', 'F30_MULTAS',           'F30',                               90),
    ('CARRIER', 'F43',                  'F43',                               90),
    ('CARRIER', 'CARPETA_TRIBUTARIA',   'CARPETA TRIBUTARIA',               100),
    ('CARRIER', 'CERT_MUTUAL',          'CERTIFICADO MUTUAL',               110),
    ('CARRIER', 'CERT_MUTUAL',          'CERTMUTUALIDAD',                   100),
    ('CARRIER', 'CERT_MUTUAL',          'CERT AFILIACION',                   90),
    ('CARRIER', 'CERT_MUTUAL',          'MUTUAL',                            50),
    ('CARRIER', 'CONTRATO_WEBCARGA',    'CONTRATO WEBCARGA',                110),
    ('CARRIER', 'POLITICA_SEGURIDAD',   'POLITICA DE SEGURIDAD',            110),
    ('CARRIER', 'POLITICA_SEGURIDAD',   'POLITICA SEGURIDAD',               100),
    ('CARRIER', 'COPIA_CI_REPLEGAL',    'CEDULA REPRESENTANTE LEGAL',       110),
    ('CARRIER', 'COPIA_CI_REPLEGAL',    'CI REPRESENTANTE LEGAL',           110),
    ('CARRIER', 'COPIA_CI_REPLEGAL',    'COPIA CI REP LEGAL',               110),
    ('CARRIER', 'ANEXO_REPLEG',         'ANEXO 2',                           80),
    ('CARRIER', 'ANEXO_REPLEG',         'ANEXO REPLEG',                     100),
    ('CARRIER', 'ROLL_SII',             'ROL SII',                          100),
    ('CARRIER', 'ROLL_SII',             'ROLL SII',                         100),
    ('CARRIER', 'ROLL_SII',             'E RUT',                             70),
    ('CARRIER', 'PTS_CONTRATISTA',      'PTS CONTRATISTA',                  110),
    ('CARRIER', 'PTS_CONTRATISTA',      'PROCEDIMIENTO TRABAJO SEGURO',      95),
    ('CARRIER', 'REGLAMENTO_INTERNO',   'REGLAMENTO INTERNO',               100),
    ('CARRIER', 'REGLAMENTO_INTERNO',   'RIOHS',                             90),
    ('CARRIER', 'CUENTA_BANCARIA',      'CUENTA BANCARIA',                  100),
    ('CARRIER', 'CUENTA_BANCARIA',      'DATOS BANCARIOS',                  100),
    ('CARRIER', 'INSURANCE_POLICY',     'POLIZA DE SEGURO',                 100),
    ('CARRIER', 'INSURANCE_POLICY',     'POLIZA',                            40),
    ('CARRIER', 'SEGURO_RC_EMPRESA',    'RESPONSABILIDAD CIVIL',            100),
    ('CARRIER', 'SEGURO_RC_EMPRESA',    'SEGURO RC EMPRESA',                110),
    ('CARRIER', 'SEGURO_EETT',          'SEGURO EETT',                      100),

    -- ── VEHÍCULO ─────────────────────────────────────────────────────────────
    ('ASSET', 'PADRON',                 'PADRON',                            90),
    ('ASSET', 'REVISION_TECNICA',       'REVISION TECNICA',                 100),
    ('ASSET', 'REVISION_TECNICA',       'REV TECNICA',                       90),
    ('ASSET', 'SOAP',                   'SEGURO OBLIGATORIO',               110),
    ('ASSET', 'SOAP',                   'SOAP',                              90),
    ('ASSET', 'PERMISO_CIRCULACION',    'PERMISO DE CIRCULACION',           110),
    ('ASSET', 'PERMISO_CIRCULACION',    'PERMISO CIRCULACION',              100),
    ('ASSET', 'GASES_CONTAMINANTES',    'REVISION DE GASES',                110),
    ('ASSET', 'GASES_CONTAMINANTES',    'GASES CONTAMINANTES',              100),
    ('ASSET', 'GASES_CONTAMINANTES',    'GASES',                             50),
    ('ASSET', 'CERTIFICADO_GPS',        'CERTIFICADO GPS',                  100),
    ('ASSET', 'CERTIFICADO_GPS',        'GPS',                               40),
    ('ASSET', 'POLIZA_RC',              'POLIZA RC',                        100),
    ('ASSET', 'SEGURO_CARGA',           'SEGURO DE CARGA',                  100),
    ('ASSET', 'SEGURO_CARGA',           'SEGURO CARGA',                     100),
    ('ASSET', 'MANTENCION_FRIO',        'MANTENCION CAMARA DE FRIO',        110),
    ('ASSET', 'MANTENCION_FRIO',        'CAMARA DE FRIO',                    90),
    ('ASSET', 'MANTENCION_FRIO',        'MANTENCION FRIO',                   90),
    ('ASSET', 'RESOLUCION_SANITARIA',   'RESOLUCION SANITARIA',             100)
) AS v(target_entity, requirement_code, alias, priority)
JOIN public.compliance_requirements r
  ON r.target_entity = v.target_entity
 AND r.requirement_code = v.requirement_code
ON CONFLICT (requirement_id, alias) DO UPDATE SET priority = EXCLUDED.priority;

COMMIT;
