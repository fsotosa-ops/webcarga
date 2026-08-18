-- Los motivos por los que WebCarga NO tomo una carga que le ofrecieron.
-- Es "el acusete de operaciones" (Pablo, 2026-08-14): la unica escritura que
-- WebCarga hace sobre un viaje, y va AL LADO del estado del TMS, nunca encima.
--
-- Dominio nuevo y no reuso de DRIVER_REASON: esos 16 motivos responden otra
-- pregunta (por que un CONDUCTOR no salio: Medico, Vacaciones, No se presento).
-- Ninguno de los cuatro que nombraron Pablo y Fabian existia.
--
-- `code` es el identificador estable. La leccion ya la pago este proyecto: los
-- rosters buscaban 'Tractoreo' por etiqueta y renombrarla desde Configuracion
-- vaciaba el roster en silencio (corregido en la Ronda 123).
--
-- app.status_taxonomies.domain tiene un CHECK con la lista cerrada de
-- dominios conocidos (status_taxonomies_domain_check, verificado en vivo
-- contra Supabase antes de escribir esto: hoy es OPERATIONAL_STATE,
-- DRIVER_REASON, EQUIPMENT_STATE, FLEET_SERVICE_TYPE,
-- WEBCARGA_OPERATION_TYPE). Sin ensancharlo, el INSERT de abajo viola el
-- constraint. Mismo patrón que 20260803050000_asset_webcarga_operation_type.sql.
ALTER TABLE app.status_taxonomies DROP CONSTRAINT status_taxonomies_domain_check;
ALTER TABLE app.status_taxonomies ADD CONSTRAINT status_taxonomies_domain_check
  CHECK (domain = ANY (ARRAY['OPERATIONAL_STATE', 'DRIVER_REASON', 'EQUIPMENT_STATE', 'FLEET_SERVICE_TYPE', 'WEBCARGA_OPERATION_TYPE', 'TRIP_UNASSIGNED_REASON']));

INSERT INTO app.status_taxonomies (domain, code, label, bg_color, text_color, sort_order)
VALUES
  ('TRIP_UNASSIGNED_REASON', 'SIN_CAMION',       'No tenemos camión',        '#fef3c7', '#92400e', 1),
  ('TRIP_UNASSIGNED_REASON', 'SIN_PROVEEDOR',    'No tenemos proveedor',     '#fef3c7', '#92400e', 2),
  ('TRIP_UNASSIGNED_REASON', 'NO_DA_TARIFA',     'No da por tarifa',         '#fee2e2', '#991b1b', 3),
  ('TRIP_UNASSIGNED_REASON', 'MANDANTE_DECLINO', 'El mandante lo declinó',   '#e0e7ff', '#3730a3', 4)
ON CONFLICT DO NOTHING;
