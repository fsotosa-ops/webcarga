-- El cliente del viaje por ID, no por nombre (spec 2026-10-11).
--
-- Hasta hoy el viaje solo tenía el texto del cliente (client_name): "walmart"
-- desde el TMS, "Iansa" desde el alta manual. Cada pantalla lo cruzaba con el
-- directorio comparando texto en minúsculas, en 22 lugares. Renombrar un cliente
-- o un cambio de escritura en el TMS los dejaba sin cliente, sin aviso.
--
-- Esta migración agrega lo que necesita el modelo nuevo. app.trips.shipper_id
-- NO se agrega acá: app.trips es de dbt (sync_all_columns), y la columna entra
-- por el modelo, que la calcula.

BEGIN;

-- 1. El directorio no admite dos nombres que solo difieran en mayúsculas o espacios.
CREATE UNIQUE INDEX shippers_name_ci_key ON public.shippers (lower(btrim(name)));

-- 2. La correspondencia: cliente del TMS -> cliente del directorio.
--    source_client_id es la clave que ya calcula el pipeline
--    (md5(tms|source_client), stg_*_trips) y que app.trips ya guarda.
CREATE TABLE app.tms_client_shippers (
    source_client_id uuid PRIMARY KEY,
    source_system    text NOT NULL,
    source_client    text NOT NULL,
    shipper_id       uuid NOT NULL REFERENCES public.shippers(id),
    created_at       timestamptz NOT NULL DEFAULT now(),
    created_by       uuid
);
COMMENT ON TABLE app.tms_client_shippers IS
  'Cliente de cada TMS -> cliente del directorio. Lo lee dbt para app.trips.shipper_id; se edita en Configuración › Clientes del TMS.';

INSERT INTO app.tms_client_shippers (source_client_id, source_system, source_client, shipper_id)
SELECT DISTINCT ON (t.source_client_id)
       t.source_client_id, t.source_system, lower(btrim(t.client_name)), sh.id
FROM app.trips t
JOIN public.shippers sh ON lower(btrim(sh.name)) = lower(btrim(t.client_name)) AND sh.status = 'ACTIVE'
WHERE t.source_client_id IS NOT NULL
ORDER BY t.source_client_id, t.status_reported_at DESC NULLS LAST;

-- Una correspondencia no se adivina: si un cliente del TMS con viajes no
-- encontró su cliente en el directorio, la migración no aplica nada.
DO $$
DECLARE faltan text;
BEGIN
  SELECT string_agg(DISTINCT t.source_system || '/' || t.client_name, ', ') INTO faltan
  FROM app.trips t
  WHERE t.source_client_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM app.tms_client_shippers m WHERE m.source_client_id = t.source_client_id);
  IF faltan IS NOT NULL THEN
    RAISE EXCEPTION 'Clientes del TMS sin cliente en el directorio: %', faltan;
  END IF;
END $$;

ALTER TABLE app.tms_client_shippers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.tms_client_shippers FROM anon, authenticated;

-- 3. El viaje manual apunta al directorio. Lo escribe la API al dar de alta.
ALTER TABLE app.trips_manual ADD COLUMN shipper_id uuid REFERENCES public.shippers(id);

UPDATE app.trips_manual m SET shipper_id = sh.id
FROM public.shippers sh
WHERE lower(btrim(sh.name)) = lower(btrim(m.client_name)) AND sh.status = 'ACTIVE' AND m.shipper_id IS NULL;

COMMIT;
