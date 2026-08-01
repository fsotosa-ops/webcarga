-- FIX 2026-08-02 (Fase 0.5, HU Cierre del Día §8): app.trip_statuses no
-- tenía fila para 6 de los 10 valores crudos reales de trip_status de
-- Sodimac (Creada, Aceptada, Control de salida, Declinada, Removida,
-- Despachada — confirmados contra datos reales de producción) ni para 2
-- valores de QAnalytics (CERRADO POR INTERFAZ, Sin Registros). Sin fila acá,
-- un viaje con ese estado no puede crearse/editarse manualmente (falla
-- _valid_status_ids en trips.py) y el badge de estado en el Diario queda
-- sin color/label resuelto.
--
-- Mapeo (DRAFT — pendiente confirmación final de Fabián, ver
-- docs/casuistica-negocio-diario.md caso 9 "Pendiente relacionado"):
--   cerrado:  Declinada, Removida, CERRADO POR INTERFAZ (ya activo en QAnalytics)
--   problema: Sin Registros (sin telemetría — no es un cierre real, es un
--             problema de datos; ya viene con is_active=false por la regla
--             de recencia de qanalytics, no por este grupo)
--   en_ruta:  Despachada (equivalente a "ya salió del CD")
--   otro:     Creada, Aceptada, Control de salida — gestión interna de
--             WebCarga previa a que el viaje esté realmente en curso (ver
--             excepción Sodimac de is_active/is_working, macro
--             is_live_tracked_source). Se usa el grupo catch-all "otro"
--             (VALID_GROUP_IDS en config.py) en vez de inventar un grupo
--             nuevo — un grupo dedicado tipo "gestion_interna" requeriría
--             extender VALID_GROUP_IDS + el selector de Configuración, y no
--             hay confirmación de negocio todavía de que ese sea el nombre
--             definitivo.
--
-- ASIGNADO no se toca: ya existe (group_id='en_ruta'), es compartido con
-- QAnalytics (12 viajes reales) y esa fila describe correctamente el
-- estado del TMS ("asignado, en flujo de ruta") para AMBAS fuentes — el
-- matiz de que en Sodimac "Asignado" es más bien pre-viaje ya está resuelto
-- a otro nivel (is_active/is_working vía is_live_tracked_source), no acá.
INSERT INTO app.trip_statuses (id, label, bg_color, text_color, group_id, sort_order, active) VALUES
  ('Despachada',          'Despachada',           '#eef6e6', '#62a420', 'en_ruta',  17, true),
  ('Declinada',           'Declinada',            '#f3f4f6', '#9ca3af', 'cerrado',  18, true),
  ('Removida',            'Removida',             '#f3f4f6', '#9ca3af', 'cerrado',  19, true),
  ('CERRADO POR INTERFAZ','Cerrado por Interfaz', '#f3f4f6', '#9ca3af', 'cerrado',  20, true),
  ('Sin Registros',       'Sin Registros',        '#fee2e2', '#b00020', 'problema', 21, true),
  ('Creada',              'Creada',               '#f1f5f9', '#475569', 'otro',     22, true),
  ('Aceptada',            'Aceptada',             '#f1f5f9', '#475569', 'otro',     23, true),
  ('Control de salida',   'Control de Salida',    '#f1f5f9', '#475569', 'otro',     24, true);
