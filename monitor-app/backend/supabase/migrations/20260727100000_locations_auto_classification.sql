-- Robustecer Tarifario (2026-07-27): clasificación automática RM/Zona
-- Cero/Región Norte/Región Sur desde la región que ya reporta el TMS en
-- cada parada (app.trip_stops.destination_region), en vez de un
-- diccionario de comunas manual. Ver
-- docs/superpowers/specs/2026-07-27-tarifario-robustecimiento-design.md
-- para el hallazgo completo (240 de 262 locales sin clasificar ya tienen
-- región disponible en su historial de viajes).

ALTER TABLE public.locations
  ADD COLUMN is_manual_override boolean NOT NULL DEFAULT false,
  ADD COLUMN overridden_by      uuid REFERENCES public.profiles(id),
  ADD COLUMN overridden_at      timestamptz;

-- Única fuente de verdad de la regla de clasificación — la usan el
-- backfill de abajo y el trigger de auto-registro de locales.
CREATE OR REPLACE FUNCTION app.classify_operation_type(p_region_number smallint)
RETURNS text AS $$
  SELECT CASE
    WHEN p_region_number = 13 THEN 'RM'
    WHEN p_region_number IN (5, 6, 7) THEN 'Z0'
    WHEN p_region_number IN (1, 2, 3, 4, 15) THEN 'Region Norte'
    WHEN p_region_number IN (8, 9, 10, 11, 12, 14, 16) THEN 'Region Sur'
    ELSE NULL
  END;
$$ LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp;

-- Backfill único: para cada local activo sin clasificar, busca la región
-- más frecuente entre sus paradas históricas (cruce por nombre, mismo
-- criterio de match que ya usa el trigger de auto-registro) y aplica la
-- regla. is_manual_override queda false — son inferencias automáticas.
WITH inferred AS (
  SELECT DISTINCT ON (l.id)
    l.id AS location_id,
    ts.destination_region::smallint AS region_number
  FROM public.locations l
  JOIN app.trip_stops ts ON lower(trim(ts.local)) = lower(l.name)
  JOIN app.trips t ON t.id = ts.trip_id
  WHERE l.operation_type IS NULL
    AND l.operational_status = 'ACTIVE'
    AND ts.destination_region IS NOT NULL
    AND ts.destination_region ~ '^\d+$'
  GROUP BY l.id, ts.destination_region
  ORDER BY l.id, count(*) DESC
)
UPDATE public.locations l
SET region_number = i.region_number,
    operation_type = app.classify_operation_type(i.region_number),
    updated_at = now()
FROM inferred i
WHERE l.id = i.location_id
  AND app.classify_operation_type(i.region_number) IS NOT NULL;

-- Extiende el trigger existente (20260722010000): además de registrar un
-- local nuevo, lo clasifica de una si la parada que lo originó ya trae
-- región. Si el local ya existe y sigue sin clasificar, lo completa con
-- la primera parada que traiga región — sin pisar nunca un
-- is_manual_override = true.
CREATE OR REPLACE FUNCTION app.reconcile_new_trip_stop_location()
RETURNS TRIGGER AS $$
DECLARE
    v_shipper_id uuid;
    v_region_number smallint;
    v_operation_type text;
BEGIN
    IF NEW.stop_type IS DISTINCT FROM 'DESTINATION' OR NEW.local IS NULL OR trim(NEW.local) = '' THEN
        RETURN NEW;
    END IF;

    SELECT sh.id INTO v_shipper_id
    FROM app.trips t
    JOIN public.shippers sh ON lower(trim(sh.name)) = lower(trim(t.client_name)) AND sh.status = 'ACTIVE'
    WHERE t.id = NEW.trip_id;

    IF v_shipper_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.destination_region ~ '^\d+$' THEN
        v_region_number := NEW.destination_region::smallint;
        v_operation_type := app.classify_operation_type(v_region_number);
    END IF;

    INSERT INTO public.locations (entity_type, entity_id, name, region_name, region_number, operation_type, operational_status)
    VALUES ('SHIPPER', v_shipper_id, trim(NEW.local), NEW.destination_region, v_region_number, v_operation_type, 'ACTIVE')
    ON CONFLICT (entity_type, entity_id, lower(name), site_number) DO UPDATE SET
        region_number  = COALESCE(public.locations.region_number, EXCLUDED.region_number),
        operation_type = COALESCE(public.locations.operation_type, EXCLUDED.operation_type),
        updated_at     = now()
    WHERE public.locations.operation_type IS NULL AND NOT public.locations.is_manual_override;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = app, public, pg_temp;
