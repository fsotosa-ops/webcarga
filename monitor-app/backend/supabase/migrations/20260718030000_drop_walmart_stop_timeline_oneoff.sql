-- Cuarta ronda de limpieza (2026-07-18). Re-audit con corrección de método:
-- el fork anterior contaba coincidencias de palabra suelta (ej. "drivers"
-- en routers/drivers.py) sin verificar el schema calificado real. Grep
-- preciso (app\. / public\. literal) confirmó que Empresas/Seguros usa
-- public.drivers/assets/carriers/insurance_policies — NO app.drivers/
-- vehicles/transporters/insurance_policies/insurance_installments, pese a
-- que la primera pasada los había dado por "activos".
--
-- silver.fct_walmart_qanalytics_stop_timeline: carga única histórica
-- (1071 filas, 0 updates/deletes desde su carga), sin ref() de ningún otro
-- modelo dbt, sin bloque de Mage, sin consumidor en backend/frontend.
-- Confirmado por el usuario como reporte puntual ya no usado.
--
-- El cluster app.transporters/drivers/vehicles/insurance_policies/
-- insurance_installments/transporter_contacts (con FKs reales entre sí, y
-- actividad de escritura sustancial: hasta 132k idx_scans, miles de
-- inserts/updates) NO se toca en esta migración — el usuario confirmó que
-- hay un deployment/script viejo activo (fuera de este repo) que sigue
-- escribiendo ahí. Ver memoria project_db_cleanup_audit_2026_07: hay que
-- identificar y apagar ese escritor legacy antes de poder limpiar esa
-- parte con seguridad — es una tarea aparte, de infraestructura, no de DB.
--
-- Ver memoria: project_db_cleanup_audit_2026_07.

BEGIN;

DROP TABLE IF EXISTS silver.fct_walmart_qanalytics_stop_timeline;

COMMIT;
