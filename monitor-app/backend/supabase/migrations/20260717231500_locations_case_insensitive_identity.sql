-- Fix inmediato sobre 20260717230000_public_locations_catalog: la clave de
-- identidad debe ser case-insensitive en `name`. El dedup inicial (DISTINCT
-- ON con comparación exacta) no atrapó "Sitrans"/"SITRANS" (Iansa, mismo
-- local, solo difieren en mayúsculas) — quedaron 2 filas para el mismo
-- local real. Colapsa la duplicada y reemplaza el UNIQUE por un índice
-- case-insensitive, para que el próximo sync (y el CRUD manual) no puedan
-- volver a crear este tipo de duplicado.
DELETE FROM public.locations a
USING public.locations b
WHERE a.entity_type = b.entity_type
  AND a.entity_id = b.entity_id
  AND lower(a.name) = lower(b.name)
  AND a.site_number IS NOT DISTINCT FROM b.site_number
  AND a.id > b.id;

ALTER TABLE public.locations DROP CONSTRAINT locations_entity_name_site_number_key;

CREATE UNIQUE INDEX locations_entity_name_site_number_ci_key
  ON public.locations (entity_type, entity_id, lower(name), site_number)
  NULLS NOT DISTINCT;
