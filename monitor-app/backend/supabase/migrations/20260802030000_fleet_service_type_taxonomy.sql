-- Fase 1 (HU Cierre del Día §2.2): "Tipo de operación por empresa" — catálogo
-- canónico de 10 valores (Tractoreo + 9 subtipos de Equipo Completo). Decisión
-- confirmada con el usuario: el tipo de operación se mantiene a nivel de
-- EMPRESA de transporte (no por vehículo/asset individual), tal como pide la
-- HU literalmente — mismo mecanismo ya usado para OPERATIONAL_STATE/
-- DRIVER_REASON/EQUIPMENT_STATE (app.status_taxonomies, dominio polimórfico),
-- en vez de crear una tabla nueva de cero. Estándar de industria para este
-- tipo de "controlled vocabulary": una tabla de catálogo + una tabla puente
-- M:N hacia la entidad (ver migración siguiente), no un ENUM de Postgres
-- (un ENUM no se puede reordenar/desactivar sin migración de esquema — el
-- resto de esta app ya evita eso a propósito) ni columnas booleanas sueltas
-- en public.carriers (no escala a "multi-selector", HU §2.2).
ALTER TABLE app.status_taxonomies DROP CONSTRAINT status_taxonomies_domain_check;
ALTER TABLE app.status_taxonomies ADD CONSTRAINT status_taxonomies_domain_check
  CHECK (domain = ANY (ARRAY['OPERATIONAL_STATE', 'DRIVER_REASON', 'EQUIPMENT_STATE', 'FLEET_SERVICE_TYPE']));

-- group_id queda NULL (igual que EQUIPMENT_STATE) — no aplica acá, es un
-- multi-selector plano, no una columna de tablero con grupos.
INSERT INTO app.status_taxonomies (domain, label, bg_color, text_color, sort_order, active) VALUES
  ('FLEET_SERVICE_TYPE', 'Tractoreo',                                    '#eff6ff', '#1d4ed8', 1,  true),
  ('FLEET_SERVICE_TYPE', 'Equipo Completo Furgón Seco',                  '#f3f4f6', '#374151', 2,  true),
  ('FLEET_SERVICE_TYPE', 'Equipo Completo Furgón Congelado / Refrigerado','#f3f4f6', '#374151', 3,  true),
  ('FLEET_SERVICE_TYPE', 'Equipo Completo Furgón Multitemperatura',      '#f3f4f6', '#374151', 4,  true),
  ('FLEET_SERVICE_TYPE', 'Equipo Completo Doble Piso Furgón',            '#f3f4f6', '#374151', 5,  true),
  ('FLEET_SERVICE_TYPE', 'Equipo Completo Sider',                        '#f3f4f6', '#374151', 6,  true),
  ('FLEET_SERVICE_TYPE', 'Equipo Completo Plano',                        '#f3f4f6', '#374151', 7,  true),
  ('FLEET_SERVICE_TYPE', 'Equipo Completo Carro Adicional',              '#f3f4f6', '#374151', 8,  true),
  ('FLEET_SERVICE_TYPE', 'Equipo Completo Botellero',                    '#f3f4f6', '#374151', 9,  true),
  ('FLEET_SERVICE_TYPE', 'Equipo Completo Porta Contenedor',             '#f3f4f6', '#374151', 10, true);
