-- Corrige el rumbo de la Ronda 79: "Tipo de Operación" (HU Cierre del Día
-- §2.2, catálogo FLEET_SERVICE_TYPE ya sembrado en
-- 20260802030000_fleet_service_type_taxonomy.sql) no vive en el Excel de
-- EMPRESAS como decía la HU literalmente — vive en la hoja de VEHÍCULOS
-- (Vehiculos_Equipos), columna nueva "Tipo Vehiculo" (normaliza a
-- bronze.raw_centralizer_vehicles.tipo_vehiculo). Confirmado corriendo el
-- pipeline real: cada vehículo trae exactamente uno de los 10 valores
-- canónicos (no un multi-selector a este nivel — el multi-selector de la
-- HU es un agregado de los vehículos de la empresa, no un campo propio).
ALTER TABLE public.assets
    ADD COLUMN IF NOT EXISTS fleet_service_type_id UUID REFERENCES app.status_taxonomies(id);
