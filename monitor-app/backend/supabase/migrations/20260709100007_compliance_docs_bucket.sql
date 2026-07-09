-- ==============================================================================
-- MIGRACIÓN: MÓDULO EMPRESAS EETT + SEGUROS — FASE 1 (G) BUCKET DE STORAGE
-- Plan: monitor-app/docs/plan-modulo-empresas-seguros.md §1.4
--
-- Bucket privado para documentos de cumplimiento y pólizas de seguro
-- (app.compliance_documents.storage_path / app.insurance_policies.storage_path
-- / app.stored_files.storage_path). Sin políticas de storage.objects para
-- anon/authenticated: el acceso es exclusivamente vía service role del API
-- con URLs firmadas (mismo patrón que 'trip-attachments', creado en
-- 20260706000001_trip_notes_v2.sql — ese bucket tampoco tiene policies de
-- objects, el insert simple del bucket privado basta).
-- ==============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('compliance-docs', 'compliance-docs', false)
ON CONFLICT (id) DO NOTHING;
