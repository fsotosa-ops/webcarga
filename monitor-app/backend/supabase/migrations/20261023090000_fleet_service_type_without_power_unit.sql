-- El subtipo de un equipo (dominio FLEET_SERVICE_TYPE) es la carrocería: Furgón Seco,
-- Sider, Furgón Congelado… La fila "Tractocamión" venía de la columna D del Excel de
-- vehículos y repetía lo que ya dice assets.asset_type: 10 tractos la tenían (89 no),
-- y su ficha decía "Tractocamión · Tractocamión". El alta ya no ofrece subtipo para un
-- tracto (AltaDeFlota, por public.asset_types.is_power_unit).
--
-- Se quita de esos 10 (el valor queda en audit_log) y la fila se desactiva, no se
-- borra: las condiciones de los requisitos guardan ids de este dominio. Ninguna
-- condición la usa (MANTENCION_FRIO y RESOLUCION_SANITARIA excluyen esta fila desde
-- 20260816000000). Re-ejecutable.

INSERT INTO public.audit_log (actor, entity_type, entity_id, action, field, old_value, new_value, source)
SELECT NULL, 'ASSET', a.id, 'update', 'fleet_service_type_id', to_jsonb(st.label), NULL, 'migration'
FROM public.assets a
JOIN app.status_taxonomies st ON st.id = a.fleet_service_type_id
WHERE st.domain = 'FLEET_SERVICE_TYPE' AND st.label = 'Tractocamión'
  AND public.is_power_unit(a.asset_type);

UPDATE public.assets a
   SET fleet_service_type_id = NULL
  FROM app.status_taxonomies st
 WHERE st.id = a.fleet_service_type_id
   AND st.domain = 'FLEET_SERVICE_TYPE' AND st.label = 'Tractocamión'
   AND public.is_power_unit(a.asset_type);

UPDATE app.status_taxonomies
   SET active = false, updated_at = now()
 WHERE domain = 'FLEET_SERVICE_TYPE' AND label = 'Tractocamión' AND active;
