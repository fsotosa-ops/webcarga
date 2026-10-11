-- "Activo" y "asignado" del viaje: una sola definición, en la base.
-- Spec: docs/superpowers/specs/2026-10-11-trip-assignment-in-the-database-design.md
-- (minuta 09/10, ítem 5).
--
-- Hasta acá la regla vivía solo en dbt (macros/viaje_activo_y_asignado.sql,
-- decisión del 09/10), así que un cambio de flota hecho desde la app tardaba
-- hasta 15 min en verse, y el alta manual escribía true/false fijos. Ahora la
-- regla es una función, y la llaman tres escritores: las macros de dbt, el alta
-- manual de la API y los triggers de abajo. La regla de negocio no cambia.
--
-- Re-ejecutable: los tests la corren dentro de su transacción revertida.

-- Sin SET search_path a propósito: no lee tablas y así Postgres puede
-- expandirla en línea dentro del modelo de dbt.
CREATE OR REPLACE FUNCTION app.is_trip_open(p_status text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
    SELECT p_status NOT LIKE 'CERRADO%'
       AND p_status NOT IN ('CANCELADO', 'Declinada', 'Removida')
$$;

COMMENT ON FUNCTION app.is_trip_open(text) IS
  'Abierto por estado (NULL con estado NULL: decide quien llama). Llamadores: macros de dbt '
  '(viaje_abierto_por_estado, viaje_activo_tms) y el alta manual de la API.';

CREATE OR REPLACE FUNCTION app.is_trip_assigned(p_status text, p_fleet jsonb, p_trip_id uuid)
RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path TO 'app', 'pg_catalog'
AS $$
    SELECT p_status IS DISTINCT FROM 'Publicada'
       AND (   NULLIF(p_fleet->>'tractor_plate', '')   IS NOT NULL
            OR NULLIF(p_fleet->>'trailer_plate', '')   IS NOT NULL
            OR NULLIF(p_fleet->>'driver_name_tms', '') IS NOT NULL
            OR NULLIF(p_fleet->>'driver_rut_tms', '')  IS NOT NULL
            OR EXISTS (
                SELECT 1 FROM app.trip_fleet_links link
                WHERE link.trip_id = p_trip_id
                  AND (   link.tractor_asset_id IS NOT NULL OR NULLIF(link.tractor_plate, '') IS NOT NULL
                       OR link.trailer_asset_id IS NOT NULL OR NULLIF(link.trailer_plate, '') IS NOT NULL
                       OR link.driver_id IS NOT NULL)))
$$;

COMMENT ON FUNCTION app.is_trip_assigned(text, jsonb, uuid) IS
  'Asignado: patente o conductor, del TMS (fleet) o del vínculo de Operaciones; una Publicada nunca. '
  'Llamadores: macro de dbt viaje_asignado, alta manual de la API y app.sync_trip_assignment().';

-- Recalcula "asignado" de los viajes cuyo vínculo cambió. Primero mira si hay
-- diferencia y solo entonces escribe: la ingesta reescribe miles de vínculos
-- automáticos por corrida, y un UPDATE sin filas igual dispara los triggers
-- de sentencia de app.trips. El override manual no se toca.
CREATE OR REPLACE FUNCTION app.sync_trip_assignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'app', 'pg_catalog'
AS $$
DECLARE
    v_trip_ids uuid[];
BEGIN
    SELECT array_agg(t.id) INTO v_trip_ids
    FROM app.trips t
    WHERE t.id IN (SELECT c.trip_id FROM changed c)
      AND NOT ('is_assigned' = ANY(COALESCE(t.manually_edited_fields, '{}')))
      AND t.is_assigned IS DISTINCT FROM app.is_trip_assigned(t.trip_status, t.fleet, t.id);

    IF v_trip_ids IS NULL THEN
        RETURN NULL;
    END IF;

    UPDATE app.trips t
       SET is_assigned = app.is_trip_assigned(t.trip_status, t.fleet, t.id)
     WHERE t.id = ANY(v_trip_ids);
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_trip_assignment_ins ON app.trip_fleet_links;
CREATE TRIGGER trg_sync_trip_assignment_ins
    AFTER INSERT ON app.trip_fleet_links
    REFERENCING NEW TABLE AS changed
    FOR EACH STATEMENT EXECUTE FUNCTION app.sync_trip_assignment();

DROP TRIGGER IF EXISTS trg_sync_trip_assignment_upd ON app.trip_fleet_links;
CREATE TRIGGER trg_sync_trip_assignment_upd
    AFTER UPDATE ON app.trip_fleet_links
    REFERENCING NEW TABLE AS changed
    FOR EACH STATEMENT EXECUTE FUNCTION app.sync_trip_assignment();

DROP TRIGGER IF EXISTS trg_sync_trip_assignment_del ON app.trip_fleet_links;
CREATE TRIGGER trg_sync_trip_assignment_del
    AFTER DELETE ON app.trip_fleet_links
    REFERENCING OLD TABLE AS changed
    FOR EACH STATEMENT EXECUTE FUNCTION app.sync_trip_assignment();
