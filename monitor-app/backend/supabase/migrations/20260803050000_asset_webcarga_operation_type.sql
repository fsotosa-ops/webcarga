-- Corrige la Ronda 80/81: la clasificación Tractoreo/Equipo Completo que
-- decide el Bloque 1 vs Bloque 2 del Cierre del Día NO es fleet_service_type
-- (columna "Tipo Vehiculo", D — describe el ROL/subtipo físico del vehículo,
-- ej. "Equipo Completo Furgón Seco") sino una columna nueva y distinta:
-- "Tipo de Operación WebCarga" (columna E del Excel de vehículos,
-- tipo_operacion_webcarga en bronze). Confirmado con datos reales
-- (2026-08-03): 38 vehículos TRACTOCAMION (rol físico "Tractoreo" en
-- columna D) tienen columna E = "Equipo Completo" — el negocio los opera
-- como parte de un arreglo de Equipo Completo aunque el vehículo en sí sea
-- un tracto bare. Las dos columnas son conceptos hermanos, no lo mismo.
--
-- Dominio nuevo y acotado a 2 valores (a diferencia de FLEET_SERVICE_TYPE,
-- que tiene 10 — Tractoreo + 9 subtipos de Equipo Completo): acá solo
-- interesa el bucket grueso que usa el cierre.
ALTER TABLE app.status_taxonomies DROP CONSTRAINT status_taxonomies_domain_check;
ALTER TABLE app.status_taxonomies ADD CONSTRAINT status_taxonomies_domain_check
  CHECK (domain = ANY (ARRAY['OPERATIONAL_STATE', 'DRIVER_REASON', 'EQUIPMENT_STATE', 'FLEET_SERVICE_TYPE', 'WEBCARGA_OPERATION_TYPE']));

INSERT INTO app.status_taxonomies (domain, label, bg_color, text_color, sort_order, active) VALUES
  ('WEBCARGA_OPERATION_TYPE', 'Tractoreo',        '#eff6ff', '#1d4ed8', 1, true),
  ('WEBCARGA_OPERATION_TYPE', 'Equipo Completo',  '#f3f4f6', '#374151', 2, true);

ALTER TABLE public.assets
    ADD COLUMN IF NOT EXISTS webcarga_operation_type_id UUID REFERENCES app.status_taxonomies(id);
