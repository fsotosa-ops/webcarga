-- FIX 2026-08-02 (Fase 0.4, HU Cierre del Día): catálogo DRIVER_REASON
-- incompleto frente al listado real que maneja el equipo de operaciones —
-- faltaban 8 motivos de uso real y la semilla original tenía un typo
-- ("Pana" en vez de "Panne", término correcto del rubro para avería
-- mecánica). Los 4 valores ya sembrados que no estaban en el listado pedido
-- (Médico, En abstención, Documentación vencida, Licencia vencida) se
-- mantienen — son motivos reales usados hoy, no basura de una semilla vieja.

UPDATE app.status_taxonomies
SET label = 'Panne', updated_at = now()
WHERE domain = 'DRIVER_REASON' AND label = 'Pana';

INSERT INTO app.status_taxonomies (domain, label, bg_color, text_color, sort_order, active) VALUES
  ('DRIVER_REASON', 'Vacaciones',              '#f3f4f6', '#374151', 9,  true),
  ('DRIVER_REASON', 'Licencia',                 '#f3f4f6', '#374151', 10, true),
  ('DRIVER_REASON', 'Descanso',                 '#f3f4f6', '#374151', 11, true),
  ('DRIVER_REASON', 'Se retiró sin carga',      '#f3f4f6', '#374151', 12, true),
  ('DRIVER_REASON', 'Sin carga disponible',     '#f3f4f6', '#374151', 13, true),
  ('DRIVER_REASON', 'Conductor no disponible',  '#f3f4f6', '#374151', 14, true),
  ('DRIVER_REASON', 'A confirmar',              '#f3f4f6', '#374151', 15, true),
  ('DRIVER_REASON', 'Otro',                     '#f3f4f6', '#374151', 16, true);
