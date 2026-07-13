-- ==============================================================================
-- CHECKPOINT B — Task 3b: restaura file_url y manual_override en las tablas
-- angostas de documentos.
--
-- Task 3 (Checkpoint A) reemplazó app.compliance_documents por 3 tablas
-- angostas (transporter_documents/driver_documents/vehicle_documents) pero
-- omitió dos columnas que sí existían en la tabla vieja y que son funciones
-- reales y activas en el frontend (TransporterDocumentsPanel.tsx):
--   - file_url: botón "Pegar link", alternativa a subir archivo.
--   - manual_override: badge "manual" + botón "Revertir a valor del
--     pipeline". Con el pipeline externo congelado (Checkpoint A Task 6),
--     manual_override=true por defecto sigue siendo correcto: cualquier
--     PATCH/upload desde la app es, por definición, edición manual. También
--     es la señal que usará Checkpoint D (conflict_reason:
--     manual_override_active) para el flujo de upload+diff.
--
-- app.insurance_policy_documents (creada en Task 1 de este mismo checkpoint)
-- tenía el mismo hueco — se corrige acá también para que Task 5 no se
-- tropiece con lo mismo.
-- ==============================================================================

ALTER TABLE app.transporter_documents      ADD COLUMN file_url text, ADD COLUMN manual_override boolean NOT NULL DEFAULT true;
ALTER TABLE app.driver_documents           ADD COLUMN file_url text, ADD COLUMN manual_override boolean NOT NULL DEFAULT true;
ALTER TABLE app.vehicle_documents          ADD COLUMN file_url text, ADD COLUMN manual_override boolean NOT NULL DEFAULT true;
ALTER TABLE app.insurance_policy_documents ADD COLUMN file_url text, ADD COLUMN manual_override boolean NOT NULL DEFAULT true;
