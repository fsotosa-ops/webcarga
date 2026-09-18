-- Centros de distribución de origen sobre el maestro de ubicaciones que ya
-- existe (HU-28, docs/user-stories/20260917/01-hu-asistencia-y-cierre-por-cd.md).
--
-- POR QUÉ ACÁ Y NO EN UNA TABLA PROPIA
-- El estándar del rubro (SAP TM, Oracle OTM, Manhattan) es UN maestro de
-- ubicaciones con roles, no una tabla por rol. Y este proyecto ya lo había
-- decidido: el comentario de 20260717230000_public_locations_catalog.sql:5-8
-- dice que la tabla es polimórfica "para no repetir el error de una tabla
-- dedicada por tipo de entidad si mañana aparece un local propio de un carrier
-- o un hub de WebCarga". Un CD es ese hub.
--
-- POR QUÉ UN BOOLEANO Y NO UN `kind` DE VALOR ÚNICO
-- Medido el 2026-09-17 contra producción: de los 24 pares (generador de carga,
-- origen) de los últimos 90 días, **14 ya existen como fila de public.locations**
-- — son lugares que a la vez reciben entregas y despachan carga (LA FARFANA
-- CDMC, Sitrans, CD Noviciado, CD Tambores...). Un `kind` de valor único
-- obligaría a duplicar esas filas, que es exactamente el frankenstein que este
-- modelo evita. Un lugar tiene roles; acá el único rol que hacía falta nombrar
-- es "además es CD de origen".
--
-- EL TEXTO DEL TMS NO SE TOCA
-- app.trip_stops.local sigue siendo intocable. La resolución origen -> CD es de
-- LECTURA, por nombre normalizado y siempre scopeada por generador de carga,
-- igual que _resolve_operation_type ya hace en routers/trips.py:340-378. No se
-- agrega FK desde trip_stops: un origen que todavía no está catalogado tiene que
-- poder seguir existiendo.

BEGIN;

ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS is_origin_cd boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.locations.is_origin_cd IS
  'true = desde este lugar SALE carga (centro de distribución de origen). No es '
  'excluyente con ser local de entrega: 14 de los 24 orígenes observados son las '
  'dos cosas. Lo consume el CD base del conductor (public.drivers.home_location_id) '
  'y el filtro por CD del cierre.';

-- Resolución origen -> CD: por nombre normalizado dentro del generador de carga.
-- Nunca un lookup global de nombre, que sería ambiguo entre clientes.
CREATE INDEX IF NOT EXISTS idx_locations_origin_cd
  ON public.locations (entity_id, lower(btrim(name)))
  WHERE is_origin_cd;

-- ── Siembra ──────────────────────────────────────────────────────────────────
-- Ventana CONGELADA a propósito (2026-06-19 → 2026-09-17, los 90 días medidos):
-- con `current_date - 90` esta migración marcaría cosas distintas cada vez que
-- se corre, y tiene que ser re-ejecutable con el mismo resultado.
--
-- UMBRAL DE 5 VIAJES, y por qué no es arbitrario: los 12 pares que quedan fuera
-- son tiendas Walmart con 1 ó 2 viajes (VIÑA DEL MAR, SAN BERNARDO, Express
-- Maipú, HIPER SANTA CRUZ...) — logística inversa saliendo de una tienda, no un
-- CD. Marcarlas ensuciaría el desplegable del cierre con 12 tiendas. Los 12 que
-- SÍ entran cubren el 99,26% de los viajes (2.536 de 2.555) y no tienen ninguna
-- ambigüedad de nombre (0 casos que calcen con más de una fila).
-- Esto es una semilla curable, no una regla: Operaciones agrega o quita un CD
-- desde Configuración sin pasar por una migración.
CREATE TEMP TABLE _cd_semilla ON COMMIT DROP AS
WITH origen AS (
    SELECT lower(btrim(t.client_name)) AS cliente,
           btrim(ts.local)             AS cd,
           count(*)                    AS viajes
    FROM app.trips t
    -- LATERAL con ORDER BY stop_order: Sodimac tiene 10 viajes con más de una
    -- fila ORIGIN (multi-pickup real). Mismo desempate que
    -- 20260823190000_origen_de_la_salida_es_el_primero.sql.
    JOIN LATERAL (
        SELECT s.local FROM app.trip_stops s
        WHERE s.trip_id = t.id AND s.stop_type = 'ORIGIN'
        ORDER BY s.stop_order ASC
        LIMIT 1
    ) ts ON true
    WHERE t.planning_date >= DATE '2026-06-19'
      AND t.planning_date <= DATE '2026-09-17'
      AND NULLIF(btrim(ts.local), '') IS NOT NULL
    GROUP BY 1, 2
    HAVING count(*) >= 5
)
SELECT s.id AS shipper_id, o.cd, o.viajes
FROM origen o
JOIN public.shippers s
  ON lower(btrim(s.name)) = o.cliente AND s.status = 'ACTIVE';

-- OJO con la clave de unicidad. El repo declara en 20260717230000 un
-- `CONSTRAINT locations_entity_name_site_number_key UNIQUE (..., name, ...)`,
-- pero en producción ESO NO EXISTE: lo que hay es un índice único
-- `locations_entity_name_site_number_ci_key` sobre
-- (entity_type, entity_id, lower(name), site_number) NULLS NOT DISTINCT.
-- Verificado contra pg_constraint/pg_indexes el 2026-09-17. Por eso el conflicto
-- se infiere por columnas y no por nombre de constraint, y por eso las
-- comparaciones usan `lower(name)` — la expresión exacta del índice— y no
-- `lower(btrim(name))`: hay 2 filas con espacios al borde y desalinear la
-- búsqueda del ON CONFLICT insertaría un casi-duplicado.

-- (a) Los que YA están en el maestro: sólo se les agrega el rol. No se les toca
--     nada más — formato, dirección y horario se robustecieron con el tiempo.
UPDATE public.locations l
SET is_origin_cd = true, updated_at = now()
FROM _cd_semilla c
WHERE l.entity_type = 'SHIPPER'
  AND l.entity_id = c.shipper_id
  AND lower(l.name) = lower(c.cd)
  AND NOT l.is_origin_cd;

-- (b) Los que faltan (los 4 CD de Walmart: EL PEÑON, LO AGUIRRE, QUILICURA y
--     PUERTO SANTIAGO 1). En el maestro Walmart existen como "CD EL PEÑON - 105"
--     y "CD EL PEÑON - 109" —dos andenes del mismo sitio, con su site_number—,
--     así que el CD se crea como fila propia con el nombre EXACTO que escribe el
--     TMS: es ese nombre el que hay que resolver, y el UNIQUE
--     (entity_type, entity_id, name, site_number) no colisiona.
INSERT INTO public.locations (entity_type, entity_id, name, country_code, operational_status, is_origin_cd)
SELECT 'SHIPPER', c.shipper_id, c.cd, 'CL', 'ACTIVE', true
FROM _cd_semilla c
WHERE NOT EXISTS (
    SELECT 1 FROM public.locations l
    WHERE l.entity_type = 'SHIPPER' AND l.entity_id = c.shipper_id
      AND lower(l.name) = lower(c.cd)
)
ON CONFLICT (entity_type, entity_id, lower(name), site_number)
DO UPDATE SET is_origin_cd = true, updated_at = now();

COMMIT;
