-- Minuta 2026-08-03: "Tipo de vehículo debe decir 'tracto' o 'tractocamión',
-- no 'tractoreo'" — ese nombre ahora es exclusivo de WEBCARGA_OPERATION_TYPE
-- (Ronda 85). Renombra usando el mismo texto ya vigente en la columna C del
-- Excel (tipo_de_equipo / public.assets.asset_type = 'TRACTOCAMION'), pedido
-- explícito del usuario — no se inventa una etiqueta nueva, se reusa la que
-- ya existe.
UPDATE app.status_taxonomies SET label = 'TRACTOCAMION'
  WHERE domain = 'FLEET_SERVICE_TYPE' AND label = 'Tractoreo';
