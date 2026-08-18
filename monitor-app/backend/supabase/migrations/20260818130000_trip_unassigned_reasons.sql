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

-- Colores: los 8 swatches de COLOR_PALETTE (shared.tsx) y ninguno mas — el
-- SwatchPicker del frontend compara por igualdad exacta (bg+text), y las
-- otras 5 taxonomias los usan sin excepcion. Mapeados por significado, igual
-- que DRIVER_REASON: Amarillo para lo neutro/operativo, Rojo para la decision
-- dura, Gris para lo ajeno a WebCarga.
INSERT INTO app.status_taxonomies (domain, code, label, bg_color, text_color, sort_order)
VALUES
  ('TRIP_UNASSIGNED_REASON', 'SIN_CAMION',       'No tenemos camión',        '#fef9c3', '#854d0e', 1),
  ('TRIP_UNASSIGNED_REASON', 'SIN_PROVEEDOR',    'No tenemos proveedor',     '#fef9c3', '#854d0e', 2),
  ('TRIP_UNASSIGNED_REASON', 'NO_DA_TARIFA',     'No da por tarifa',         '#fef2f2', '#b91c1c', 3),
  ('TRIP_UNASSIGNED_REASON', 'MANDANTE_DECLINO', 'El mandante lo declinó',   '#f3f4f6', '#374151', 4)
ON CONFLICT DO NOTHING;
