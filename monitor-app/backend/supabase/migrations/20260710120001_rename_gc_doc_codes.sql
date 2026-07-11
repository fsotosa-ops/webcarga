-- ==============================================================================
-- MÓDULO EMPRESAS EETT + SEGUROS — AUDITORÍA 2026-07-10: rename doc_code
-- genérico (elimina "walmart" hardcodeado del identificador; la
-- diferenciación por cliente ya vive en required_for_clients, no en el
-- nombre). ON UPDATE CASCADE preserva id/manual_override/historial de las
-- filas existentes en app.compliance_documents.
-- ==============================================================================

ALTER TABLE app.compliance_documents
  DROP CONSTRAINT compliance_documents_doc_code_fkey,
  ADD CONSTRAINT compliance_documents_doc_code_fkey
    FOREIGN KEY (doc_code) REFERENCES app.compliance_doc_catalog(doc_code)
    ON UPDATE CASCADE;

UPDATE app.compliance_doc_catalog SET doc_code = 'anexo_2_gc'          WHERE doc_code = 'anexo_2_walmart';
UPDATE app.compliance_doc_catalog SET doc_code = 'creacion_gc'         WHERE doc_code = 'creacion_walmart';
UPDATE app.compliance_doc_catalog SET doc_code = 'anexo_3_gc'          WHERE doc_code = 'anexo_3_walmart';
UPDATE app.compliance_doc_catalog SET doc_code = 'validado_gc_driver'  WHERE doc_code = 'validado_walmart';
UPDATE app.compliance_doc_catalog SET doc_code = 'creacion_gc_driver'  WHERE doc_code = 'creacion_walmart_driver';
UPDATE app.compliance_doc_catalog SET doc_code = 'creacion_gc_vehicle' WHERE doc_code = 'creacion_walmart_vehicle';

UPDATE app.compliance_doc_catalog SET label = 'Anexo 2 gran cuenta'                 WHERE doc_code = 'anexo_2_gc';
UPDATE app.compliance_doc_catalog SET label = 'Creación en gran cuenta'             WHERE doc_code = 'creacion_gc';
UPDATE app.compliance_doc_catalog SET label = 'Anexo 3 gran cuenta'                 WHERE doc_code = 'anexo_3_gc';
UPDATE app.compliance_doc_catalog SET label = 'Validado por gran cuenta'            WHERE doc_code = 'validado_gc_driver';
UPDATE app.compliance_doc_catalog SET label = 'Creación en gran cuenta (conductor)' WHERE doc_code = 'creacion_gc_driver';
UPDATE app.compliance_doc_catalog SET label = 'Creación en gran cuenta (vehículo)'  WHERE doc_code = 'creacion_gc_vehicle';

-- gc_driver: 0 filas en compliance_documents, sin fuente en el pipeline
-- (gap documentado), solapa conceptualmente con validado_gc_driver — se
-- elimina en vez de mantener un doc_code huérfano permanente.
DELETE FROM app.compliance_doc_catalog WHERE doc_code = 'gc_driver';
