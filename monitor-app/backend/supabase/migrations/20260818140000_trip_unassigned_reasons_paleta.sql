-- Corrige 20260818130000_trip_unassigned_reasons.sql: los 4 pares
-- bg_color/text_color que trajo esa migracion NO pertenecian a COLOR_PALETTE
-- (monitor-app/frontend/app/dashboard/admin/settings/shared.tsx:19-28), la
-- paleta cerrada de 8 swatches del modulo. Las otras 5 taxonomias la usan sin
-- una sola excepcion, y el SwatchPicker compara por igualdad exacta
-- (c.bg === bg && c.text === text) -- con los colores originales, ningun
-- swatch aparecia seleccionado al abrir la pestana.
--
-- UPDATE por codigo, no DELETE+INSERT: reinsertar cambiaria los `id`, y esos
-- ids son los que van a referenciar los viajes en las tareas siguientes de
-- este plan.
UPDATE app.status_taxonomies SET bg_color = '#fef9c3', text_color = '#854d0e'
 WHERE domain = 'TRIP_UNASSIGNED_REASON' AND code = 'SIN_CAMION';

UPDATE app.status_taxonomies SET bg_color = '#fef9c3', text_color = '#854d0e'
 WHERE domain = 'TRIP_UNASSIGNED_REASON' AND code = 'SIN_PROVEEDOR';

UPDATE app.status_taxonomies SET bg_color = '#fef2f2', text_color = '#b91c1c'
 WHERE domain = 'TRIP_UNASSIGNED_REASON' AND code = 'NO_DA_TARIFA';

UPDATE app.status_taxonomies SET bg_color = '#f3f4f6', text_color = '#374151'
 WHERE domain = 'TRIP_UNASSIGNED_REASON' AND code = 'MANDANTE_DECLINO';
