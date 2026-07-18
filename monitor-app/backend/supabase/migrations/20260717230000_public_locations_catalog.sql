-- Catálogo de locales por generador de carga (H2.6, fase "catálogo de
-- locales"). Resuelve la clasificación RM/Zona Cero de la minuta UAT.
-- public.locations vive en public (no app.*) porque la entidad dueña es
-- public.shippers, mismo dominio que carriers/drivers/assets — no el de
-- trips/Diario. Polimórfica (entity_type/entity_id, sin FK real) mismo
-- patrón ya usado por public.contacts/public.compliance_records, para no
-- repetir el error de una tabla dedicada por tipo de entidad si mañana
-- aparece un local propio de un carrier o un hub de WebCarga.
--
-- Tabla real (no vista): un local puede crearse a mano antes de existir en
-- la planilla, y campos como formato/dirección/horario se "robustecen" con
-- el tiempo sin que el próximo sync de la planilla los pise (ver upsert
-- abajo, COALESCE conserva lo ya cargado).
CREATE TABLE public.locations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type         text NOT NULL,              -- 'SHIPPER' por ahora; enum abierto, mismo criterio que contacts
  entity_id           uuid NOT NULL,               -- sin FK real: polimórfico, mismo criterio que contacts.entity_id
  site_number         text,                        -- "N° Local" del generador de carga — dato dado, no clave de negocio
                                                    -- (NULL para Iansa/Sodimac/Colun, que no lo informan)
  name                text NOT NULL,               -- "Local"
  format              text,                        -- "Formato" (Express/Lider/SBA/...)
  address             text,
  region_name         text,
  region_number       smallint,
  opens_at            time,
  closes_at           time,
  operation_type      text,                        -- RM | Z0 | Region Norte | Region Sur
  operational_status  text NOT NULL DEFAULT 'ACTIVE',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- NULLS NOT DISTINCT: Iansa/Sodimac/Colun tienen site_number NULL en el
  -- 100% de sus filas — sin esta cláusula cada NULL cuenta como distinto y
  -- el ON CONFLICT del upsert nunca dispararía para esos 3 generadores,
  -- insertando una fila duplicada en cada sync en vez de actualizar.
  CONSTRAINT locations_entity_name_site_number_key
    UNIQUE NULLS NOT DISTINCT (entity_type, entity_id, name, site_number)
);

CREATE INDEX idx_locations_entity ON public.locations (entity_type, entity_id);
CREATE INDEX idx_locations_site_number ON public.locations (entity_type, entity_id, site_number)
  WHERE site_number IS NOT NULL;

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Locations are viewable by authenticated users" ON public.locations;
DROP POLICY IF EXISTS "Locations can be managed by authenticated users" ON public.locations;
CREATE POLICY "Locations are viewable by authenticated users" ON public.locations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Locations can be managed by authenticated users" ON public.locations FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Carga inicial desde bronze.raw_shipper_locations (494 filas, 4 generadores:
-- Walmart/Iansa/Sodimac/Colun, ya matcheados 1:1 contra public.shippers.name).
-- name queda fuera del SET del ON CONFLICT porque es parte de la clave — un
-- cambio de nombre en la planilla para el mismo site_number crea una fila
-- nueva en vez de renombrar la existente (aceptado: el nombre es dato
-- operativo, no un alias editable a mano en este alcance).
--
-- DISTINCT ON (entity_id, name, site_number): 4 filas del bronze son
-- duplicados literales dentro del mismo generador (mismo nombre, misma
-- "dirección" de ciudad, sin número — ej. "La Farfana CDMC (256)" x2 en
-- Sodimac, "Sitrans" x2 en Iansa) — indistinguibles con cualquier campo
-- disponible. ON CONFLICT no dedupea entre filas del mismo INSERT, solo
-- contra filas ya existentes, así que hay que colapsarlas acá antes de
-- insertar (decisión del usuario: colapsar automáticamente, no son error).
WITH deduped AS (
  SELECT DISTINCT ON (s.id, r._local, r.n__local)
    s.id AS shipper_id, r.n__local, r._local, r.formato, r.direccion,
    r.region, r.n__region,
    CASE WHEN r.desde ~ '^\d{1,2}:\d{2}:\d{2}$' THEN r.desde::time END AS opens_at,
    CASE WHEN r.hasta ~ '^\d{1,2}:\d{2}:\d{2}$' THEN r.hasta::time END AS closes_at,
    r."tipo_operación" AS operation_type
  FROM bronze.raw_shipper_locations r
  JOIN public.shippers s ON s.name = r.generador_de_carga
  ORDER BY s.id, r._local, r.n__local, r.direccion NULLS LAST
)
INSERT INTO public.locations (
  entity_type, entity_id, site_number, name, format, address,
  region_name, region_number, opens_at, closes_at, operation_type
)
SELECT 'SHIPPER', shipper_id, n__local, _local, formato, direccion,
       region, n__region, opens_at, closes_at, operation_type
FROM deduped
ON CONFLICT (entity_type, entity_id, name, site_number) DO UPDATE SET
  format         = COALESCE(public.locations.format,  EXCLUDED.format),
  address        = COALESCE(public.locations.address, EXCLUDED.address),
  opens_at       = COALESCE(public.locations.opens_at, EXCLUDED.opens_at),
  closes_at      = COALESCE(public.locations.closes_at, EXCLUDED.closes_at),
  operation_type = EXCLUDED.operation_type,
  updated_at     = now();
