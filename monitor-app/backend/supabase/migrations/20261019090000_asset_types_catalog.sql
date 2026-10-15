-- Entrega C (14/10): el tipo de equipo pasa a ser un catálogo.
--
-- Hasta hoy los dos tipos (TRACTOCAMION, RAMPLA) solo existían en el CHECK de
-- public.assets (20260815170000) y, copiados a mano, en 11 lugares del backend,
-- 9 de la pantalla y en public.carrier_management_types. Ahora:
--   - public.asset_types es la única lista, con su etiqueta y su atributo;
--   - el código pregunta por el atributo ("¿es unidad motriz?", el power unit de
--     la industria) con public.is_power_unit(), nunca por el nombre.
-- Los valores no cambian: la FK reemplaza al CHECK y el código anterior sigue
-- funcionando (expand).
--
-- Fuera de alcance, anotado: la taxonomía FLEET_SERVICE_TYPE tiene una fila
-- "Tractocamión" (sin code) mezclada con las carrocerías de las ramplas.

CREATE TABLE public.asset_types (
    code          varchar PRIMARY KEY,
    label         text    NOT NULL,
    is_power_unit boolean NOT NULL,
    sort_order    integer NOT NULL
);
COMMENT ON TABLE public.asset_types IS
    'Tipos de equipo (chasis). is_power_unit = unidad motriz (tracto); el código lo consulta con public.is_power_unit().';

INSERT INTO public.asset_types (code, label, is_power_unit, sort_order) VALUES
    ('TRACTOCAMION', 'Tracto', true,  1),
    ('RAMPLA',       'Rampla', false, 2);

ALTER TABLE public.asset_types ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.asset_types FROM anon, authenticated;

ALTER TABLE public.assets
    ADD CONSTRAINT assets_asset_type_fkey FOREIGN KEY (asset_type) REFERENCES public.asset_types (code);
ALTER TABLE public.assets DROP CONSTRAINT assets_asset_type_check;

CREATE FUNCTION public.is_power_unit(p_asset_type varchar)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
    SELECT COALESCE((SELECT t.is_power_unit FROM public.asset_types t WHERE t.code = p_asset_type), false);
$$;
REVOKE ALL ON FUNCTION public.is_power_unit(varchar) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_power_unit(varchar) TO service_role;

CREATE OR REPLACE FUNCTION public.carrier_management_types(p_carrier_id uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT COALESCE(
        (
            SELECT array_agg(DISTINCT t.code) FILTER (WHERE t.code IS NOT NULL)
            FROM app.active_fleet af
            JOIN public.assets a ON a.id = af.entity_id AND public.is_power_unit(a.asset_type)
            JOIN app.status_taxonomies t ON t.id = a.webcarga_operation_type_id
            WHERE af.carrier_id = p_carrier_id AND af.entity_type = 'ASSET'
        ),
        (SELECT c.management_types FROM public.carriers c WHERE c.id = p_carrier_id)
    );
$function$;
