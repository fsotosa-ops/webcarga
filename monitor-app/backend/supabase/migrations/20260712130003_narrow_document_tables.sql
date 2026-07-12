-- ==============================================================================
-- CHECKPOINT A — Task 3: tablas angostas de documentos por entidad
--
-- app.compliance_documents es una tabla genérica (entity_type + entity_id
-- apuntando indistintamente a transporter/driver/vehicle vía app.entities).
-- Reemplazo por 3 tablas angostas con FK directa y PK compuesta
-- (entidad, doc_name) — mismo patrón que app.insurance_documents. Simplifica
-- las vistas de elegibilidad (Task 4) al evitar el JOIN condicional por
-- entity_type, y prepara el terreno para dropear compliance_documents /
-- compliance_doc_catalog en Task 7.
--
-- Investigación previa (confirmada contra datos reales, ver task-3-report.md):
--   - compliance_documents.entity_id mapea 1:1 al id real en
--     transporters/drivers/vehicles (no hay ni un solo entity_id huérfano
--     entre las 352 filas con status no nulo) y entities.entity_type
--     coincide en el 100% de los casos con compliance_documents.entity_type.
--   - No hay pares (entity_type, entity_id, doc_code) duplicados con status
--     no nulo, así que la migración a la PK compuesta no puede violar la
--     unicidad.
--   - El patrón RLS separado _read/_write de compliance_documents (solo
--     SELECT + UPDATE, sin INSERT/DELETE) es el patrón viejo. Las tablas
--     "documentos" más recientes (app.insurance_documents, 2026-07-11) ya
--     usan el patrón consolidado: una policy de lectura (SELECT, true) y
--     una sola policy de escritura FOR ALL con el mismo criterio de rol —
--     se replica ese patrón acá, no el viejo.
-- ==============================================================================

CREATE TABLE app.transporter_documents (
  transporter_id uuid NOT NULL REFERENCES app.transporters(id) ON DELETE CASCADE,
  doc_name text NOT NULL,
  status app.compliance_status,
  expiry_date date,
  storage_path text,
  notes text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (transporter_id, doc_name)
);

CREATE TABLE app.driver_documents (
  driver_id uuid NOT NULL REFERENCES app.drivers(id) ON DELETE CASCADE,
  doc_name text NOT NULL,
  status app.compliance_status,
  expiry_date date,
  storage_path text,
  notes text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (driver_id, doc_name)
);

CREATE TABLE app.vehicle_documents (
  vehicle_id uuid NOT NULL REFERENCES app.vehicles(id) ON DELETE CASCADE,
  doc_name text NOT NULL,
  status app.compliance_status,
  expiry_date date,
  storage_path text,
  notes text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vehicle_id, doc_name)
);

COMMENT ON TABLE app.transporter_documents IS
  'Documentos de compliance por transportista (doc_name libre, sin catálogo FK). Reemplaza el subconjunto entity_type=transporter de app.compliance_documents.';
COMMENT ON TABLE app.driver_documents IS
  'Documentos de compliance por conductor. Reemplaza el subconjunto entity_type=driver de app.compliance_documents.';
COMMENT ON TABLE app.vehicle_documents IS
  'Documentos de compliance por vehículo. Reemplaza el subconjunto entity_type=vehicle de app.compliance_documents.';

ALTER TABLE app.transporter_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.driver_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.vehicle_documents ENABLE ROW LEVEL SECURITY;

-- Patrón consolidado (una policy por acción, no _read/_write separado por
-- comando) — mismo criterio de rol que compliance_documents_write / que
-- app.insurance_documents: cualquier authenticated puede leer, solo
-- editor/admin/owner puede escribir (INSERT/UPDATE/DELETE vía FOR ALL).
CREATE POLICY "transporter_documents_read" ON app.transporter_documents
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "transporter_documents_write" ON app.transporter_documents
  FOR ALL TO authenticated
  USING (app.current_user_role() IN ('editor', 'admin', 'owner'))
  WITH CHECK (app.current_user_role() IN ('editor', 'admin', 'owner'));

CREATE POLICY "driver_documents_read" ON app.driver_documents
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "driver_documents_write" ON app.driver_documents
  FOR ALL TO authenticated
  USING (app.current_user_role() IN ('editor', 'admin', 'owner'))
  WITH CHECK (app.current_user_role() IN ('editor', 'admin', 'owner'));

CREATE POLICY "vehicle_documents_read" ON app.vehicle_documents
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "vehicle_documents_write" ON app.vehicle_documents
  FOR ALL TO authenticated
  USING (app.current_user_role() IN ('editor', 'admin', 'owner'))
  WITH CHECK (app.current_user_role() IN ('editor', 'admin', 'owner'));

-- Migración de datos reales: solo filas con status no nulo (confirmado por
-- entity_id -> transporters/drivers/vehicles.id 1:1, sin huérfanos ni
-- duplicados de (entity_id, doc_code) dentro de cada entity_type).
INSERT INTO app.transporter_documents (transporter_id, doc_name, status, expiry_date, storage_path, notes, updated_by, updated_at)
SELECT cd.entity_id, cd.doc_code, cd.status, cd.expiry_date, cd.storage_path, cd.notes, cd.updated_by, cd.updated_at
FROM app.compliance_documents cd
WHERE cd.entity_type = 'transporter' AND cd.status IS NOT NULL;

INSERT INTO app.driver_documents (driver_id, doc_name, status, expiry_date, storage_path, notes, updated_by, updated_at)
SELECT cd.entity_id, cd.doc_code, cd.status, cd.expiry_date, cd.storage_path, cd.notes, cd.updated_by, cd.updated_at
FROM app.compliance_documents cd
WHERE cd.entity_type = 'driver' AND cd.status IS NOT NULL;

INSERT INTO app.vehicle_documents (vehicle_id, doc_name, status, expiry_date, storage_path, notes, updated_by, updated_at)
SELECT cd.entity_id, cd.doc_code, cd.status, cd.expiry_date, cd.storage_path, cd.notes, cd.updated_by, cd.updated_at
FROM app.compliance_documents cd
WHERE cd.entity_type = 'vehicle' AND cd.status IS NOT NULL;
