-- El prefijo "Equipo Completo" se traslada conceptualmente a
-- WEBCARGA_OPERATION_TYPE (columna E, "Tipo de Operación WebCarga") — las
-- etiquetas de FLEET_SERVICE_TYPE (columna D, "Tipo Vehículo") quedan solo
-- con el subtipo del vehículo, sin el prefijo redundante. "Tractoreo" no
-- cambia (nunca tuvo prefijo). Mismos id/sort_order/colores — solo texto.
UPDATE app.status_taxonomies SET label = 'Furgón Seco'
  WHERE domain = 'FLEET_SERVICE_TYPE' AND label = 'Equipo Completo Furgón Seco';
UPDATE app.status_taxonomies SET label = 'Furgón Congelado / Refrigerado'
  WHERE domain = 'FLEET_SERVICE_TYPE' AND label = 'Equipo Completo Furgón Congelado / Refrigerado';
UPDATE app.status_taxonomies SET label = 'Furgón Multitemperatura'
  WHERE domain = 'FLEET_SERVICE_TYPE' AND label = 'Equipo Completo Furgón Multitemperatura';
UPDATE app.status_taxonomies SET label = 'Doble Piso Furgón'
  WHERE domain = 'FLEET_SERVICE_TYPE' AND label = 'Equipo Completo Doble Piso Furgón';
UPDATE app.status_taxonomies SET label = 'Sider'
  WHERE domain = 'FLEET_SERVICE_TYPE' AND label = 'Equipo Completo Sider';
UPDATE app.status_taxonomies SET label = 'Plano'
  WHERE domain = 'FLEET_SERVICE_TYPE' AND label = 'Equipo Completo Plano';
UPDATE app.status_taxonomies SET label = 'Carro Adicional'
  WHERE domain = 'FLEET_SERVICE_TYPE' AND label = 'Equipo Completo Carro Adicional';
UPDATE app.status_taxonomies SET label = 'Botellero'
  WHERE domain = 'FLEET_SERVICE_TYPE' AND label = 'Equipo Completo Botellero';
UPDATE app.status_taxonomies SET label = 'Porta Contenedor'
  WHERE domain = 'FLEET_SERVICE_TYPE' AND label = 'Equipo Completo Porta Contenedor';
