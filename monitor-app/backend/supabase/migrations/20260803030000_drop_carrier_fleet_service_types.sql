-- Ronda 80: public.carrier_fleet_service_types (creada 20260802040000,
-- protegida con is_manual_override en 20260803000000) se elimina — nunca
-- tuvo una fuente de ingesta real (asumía que "Tipo de Operación" vivía en
-- el Excel de EMPRESAS; corrida la ingesta real, el campo vive por TRACTO
-- individual en la hoja de vehículos → public.assets.fleet_service_type_id).
-- equipment_closures.py/status_report.py/trips.py (fleet-daily-overview) y
-- pre_cierre.py ya se reconectaron a assets.fleet_service_type_id antes de
-- este DROP — 0 días referencian esta tabla, 0 filas de datos reales.
DROP TABLE public.carrier_fleet_service_types;
