-- ============================================================================
-- Capa 1 del modelo de resolución de flota: IDENTIDAD
-- ============================================================================
-- Spec: docs/superpowers/specs/2026-08-17-modelo-resolucion-flota-design.md
--
-- Un identificador tiene UNA forma en la base, y la entrada acepta todas.
--
--   RUT      -> NNNNNNNN-D   public.rut_canonico(text)      public.drivers.tax_id
--   Patente  -> AAAA99       public.patente_canonica(text)  public.assets.license_plate
--
-- POR QUE EN `public` Y NO EN `app`:
--   La base esta en public y desde ahi alimenta app. Estas funciones
--   RESTRINGEN tablas de public (drivers, assets), asi que ponerlas en app
--   haria que public dependa de app — la dependencia al reves. Ademas es la
--   convencion que el proyecto ya sigue: reconcile_new_driver,
--   reconcile_new_asset y refresh_carrier_view viven en public porque sirven
--   tablas de public.
--
-- ENTRADA TOLERANTE, ALMACENAMIENTO ESTRICTO. Son DOS piezas y hacen falta
-- las dos: el trigger canoniza lo que llega, el CHECK garantiza que lo
-- guardado es canonico venga de donde venga. Solo con el CHECK, cada escritor
-- tendria que normalizar antes — y Mage escribe public.drivers sin pasar por
-- la API. Solo con el trigger, un COPY lo saltearia.
--
-- ⚠ DOS TRAMPAS QUE COSTARON UN BUG CADA UNA
--
--   1. `IS NOT DISTINCT FROM`, nunca `=`, cuando el CHECK llama a una funcion
--      que puede devolver NULL. `NULL = 'basura'` no es FALSE, es NULL, y un
--      CHECK con expresion NULL SE CONSIDERA CUMPLIDO: con `=` el candado
--      aceptaba exactamente los valores que venia a rechazar. Lo encontro
--      test_un_rut_invalido_no_entra, no la lectura del codigo.
--
--   2. `trim()` en Postgres saca SOLO espacios, no tabuladores. Por eso
--      `upper(trim())` es una aproximacion y no una normalizacion — y habia
--      una patente guardada como `GBVC90` + TAB en public.assets, invisible
--      para cualquier join que la comparara asi.
--
-- EL CASO AMBIGUO DEL RUT: normalizado a 8 caracteres, un valor puede ser un
-- RUT de 7 digitos con DV o uno de 8 al que le falta el DV. Se desambigua
-- VALIDANDO, no adivinando: si el ultimo caracter cierra el modulo 11, es DV;
-- si no, se rechaza. Inventarle el DV correcto crearia una persona que no
-- existe. Sobre bronze.raw_bd_ot eso acepta el 97,6% de las filas.
--
-- ⚠ EFECTO SOBRE MAGE: el CHECK hace fallar cualquier escritura sucia,
--   incluida la de `custom/load_drivers_03.sql`. Hoy no hay ninguna fila
--   fuera de forma (0 de 79 en drivers, 0 de 118 en assets tras la limpieza),
--   asi que el riesgo es futuro. Si ese bloque empieza a fallar, la migracion
--   NO es el bug: esta haciendo su trabajo. Mismo criterio que dejo escrito
--   20260814120000_dedupe_drivers_sin_rut.sql.

BEGIN;

-- ── El digito verificador, modulo 11 ────────────────────────────────────────
-- IMMUTABLE: la salida depende solo de la entrada. Eso la habilita para CHECK
-- constraints e indices, que es todo el punto.
CREATE OR REPLACE FUNCTION public.rut_dv(cuerpo text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path TO 'pg_catalog' AS $fn$
    SELECT CASE 11 - (suma % 11)
               WHEN 11 THEN '0' WHEN 10 THEN 'K'
               ELSE (11 - (suma % 11))::text END
    FROM (SELECT sum(substr(reverse(cuerpo), i, 1)::int * (((i - 1) % 6) + 2)) AS suma
          FROM generate_series(1, length(cuerpo)) AS i) s;
$fn$;

CREATE OR REPLACE FUNCTION public.rut_canonico(entrada text)
RETURNS text LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path TO 'public', 'pg_catalog' AS $fn$
DECLARE limpio text; cuerpo text; dv text;
BEGIN
    IF entrada IS NULL THEN RETURN NULL; END IF;

    -- Fuera puntos, espacios, guiones y cualquier adorno. K a mayuscula.
    limpio := upper(regexp_replace(entrada, '[^0-9kK]', '', 'g'));

    -- Un RUT chileno util: 7 u 8 digitos de cuerpo, o sea 8 o 9 con DV.
    IF length(limpio) < 8 OR length(limpio) > 9 THEN RETURN NULL; END IF;

    cuerpo := left(limpio, length(limpio) - 1);
    dv     := right(limpio, 1);

    -- La K solo puede ser DV, nunca parte del cuerpo.
    IF cuerpo !~ '^[0-9]+$' THEN RETURN NULL; END IF;

    IF public.rut_dv(cuerpo) IS DISTINCT FROM dv THEN RETURN NULL; END IF;

    RETURN cuerpo || '-' || dv;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.rut_es_valido(entrada text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path TO 'public', 'pg_catalog' AS $fn$
    SELECT public.rut_canonico(entrada) IS NOT NULL;
$fn$;

CREATE OR REPLACE FUNCTION public.patente_canonica(entrada text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path TO 'pg_catalog' AS $fn$
    SELECT CASE
        WHEN upper(regexp_replace(coalesce(entrada,''), '[^A-Za-z0-9]', '', 'g')) ~ '^[A-Z0-9]{6}$'
            THEN upper(regexp_replace(entrada, '[^A-Za-z0-9]', '', 'g'))
        ELSE NULL END;
$fn$;

COMMENT ON FUNCTION public.rut_canonico(text) IS
    'RUT en forma canonica NNNNNNNN-D, o NULL si no es valido. Vive en public '
    'porque restringe public.drivers: la base esta en public y desde ahi '
    'alimenta app.';
COMMENT ON FUNCTION public.patente_canonica(text) IS
    'Patente canonica AAAA99, o NULL. Vive en public porque restringe '
    'public.assets.';

-- ── Los triggers de canonizacion ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_canonizar_tax_id()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_catalog' AS $fn$
BEGIN
    IF NEW.tax_id IS NOT NULL THEN
        -- Si no canoniza, se CONSERVA lo que el usuario escribio para que el
        -- CHECK lo rechace mostrandolo. Poner NULL convertiria un dato
        -- invalido en un dato ausente en silencio: el error dejaria de
        -- existir en vez de resolverse.
        NEW.tax_id := COALESCE(public.rut_canonico(NEW.tax_id), NEW.tax_id);
    END IF;
    RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.trg_canonizar_patente()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_catalog' AS $fn$
BEGIN
    NEW.license_plate := COALESCE(
        public.patente_canonica(NEW.license_plate), NEW.license_plate);
    RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_drivers_canonizar_tax_id ON public.drivers;
CREATE TRIGGER trg_drivers_canonizar_tax_id
    BEFORE INSERT OR UPDATE OF tax_id ON public.drivers
    FOR EACH ROW EXECUTE FUNCTION public.trg_canonizar_tax_id();

DROP TRIGGER IF EXISTS trg_assets_canonizar_patente ON public.assets;
CREATE TRIGGER trg_assets_canonizar_patente
    BEFORE INSERT OR UPDATE OF license_plate ON public.assets
    FOR EACH ROW EXECUTE FUNCTION public.trg_canonizar_patente();

-- ── Limpiar antes de cerrar la puerta ───────────────────────────────────────
-- Si esto generara un choque con una patente existente, falla por el UNIQUE y
-- la migracion se revierte entera. Correcto: fusionar dos vehiculos es una
-- decision de negocio, no de una migracion.
UPDATE public.assets
SET license_plate = public.patente_canonica(license_plate)
WHERE public.patente_canonica(license_plate) IS DISTINCT FROM license_plate
  AND public.patente_canonica(license_plate) IS NOT NULL;

-- ── Los candados ────────────────────────────────────────────────────────────
-- NOT VALID + VALIDATE: valida lo nuevo sin bloquear la tabla, y despues
-- confirma lo existente sabiendo que cumple.
ALTER TABLE public.drivers DROP CONSTRAINT IF EXISTS drivers_tax_id_canonico;
ALTER TABLE public.drivers ADD CONSTRAINT drivers_tax_id_canonico
    CHECK (tax_id IS NULL OR public.rut_canonico(tax_id) IS NOT DISTINCT FROM tax_id) NOT VALID;
ALTER TABLE public.drivers VALIDATE CONSTRAINT drivers_tax_id_canonico;

ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS assets_license_plate_canonica;
ALTER TABLE public.assets ADD CONSTRAINT assets_license_plate_canonica
    CHECK (public.patente_canonica(license_plate) IS NOT DISTINCT FROM license_plate) NOT VALID;
ALTER TABLE public.assets VALIDATE CONSTRAINT assets_license_plate_canonica;

-- ── Un concepto, un lugar ───────────────────────────────────────────────────
-- `app.normalize_rut` devolvia el cuerpo SIN digito verificador — correcto
-- para la forma del Centralizer (RUT y DV en columnas separadas), pero NO lo
-- que su nombre promete, y dejarla al lado de rut_canonico obliga a hacer
-- arqueologia. Verificado sin consumidores en las TRES capas: 0 en la base
-- (funciones, vistas, constraints, indices), 0 en el codigo de la aplicacion,
-- y 0 en los 333 archivos del proyecto Mage vivo — donde el cargador real,
-- `custom/load_drivers_03.sql`, arma el tax_id a mano con
-- `REGEXP_REPLACE(TRIM(rut_conductor),'\.0$','') || '-' || TRIM(dv_conductor)`.
-- Sus unicas referencias estan en pipelines/centralizer_to_app/, que escribe
-- en `app.drivers` — tabla que NO EXISTE. Es el dbt legacy retirado.
DROP FUNCTION IF EXISTS app.normalize_rut(text);

-- Y las copias que esta misma migracion habia dejado en app antes de
-- corregir la direccion de la dependencia.
DROP FUNCTION IF EXISTS app.trg_canonizar_tax_id();
DROP FUNCTION IF EXISTS app.trg_canonizar_patente();
DROP FUNCTION IF EXISTS app.rut_es_valido(text);
DROP FUNCTION IF EXISTS app.rut_canonico(text);
DROP FUNCTION IF EXISTS app.patente_canonica(text);
DROP FUNCTION IF EXISTS app.rut_dv(text);

COMMIT;
