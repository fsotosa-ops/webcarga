-- D2 "Asignaciones con vigencia" (Entrega A, plan 2026-10-14).
--
-- driver_assignments, asset_assignments y carrier_shippers tienen UNIQUE (sujeto,
-- empresa): una fila por par para siempre, y volver a una empresa reactiva la fila
-- vieja. La historia se perdía (0 de 326 con end_date, medido el 12/10). Esta tabla
-- guarda cada período; la llena un trigger, así cualquier escritor queda capturado.
--
-- La fecha efectiva viaja en las columnas de la propia fila: start_date al activar,
-- end_date al terminar. Si no cambian, es hoy en Chile.
--
-- Siembra: las asignaciones ACTIVE reciben un período sin límite inferior. Los días
-- previos al despliegue se siguen juzgando con la empresa de hoy, como antes: el
-- start_date existente es la fecha de la migración del 15/07, no la real (13
-- conductores y 14 equipos activos lo tienen después del 03/09, y sembrar desde ahí
-- inventaría MISMATCH en días ya cerrados). P7: la historia parte hoy.

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS app.fleet_assignment_periods (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    relation       text NOT NULL CHECK (relation IN ('DRIVER_CARRIER', 'ASSET_CARRIER', 'CARRIER_SHIPPER')),
    subject_id     uuid NOT NULL,
    counterpart_id uuid NOT NULL,
    valid_during   daterange NOT NULL CHECK (NOT isempty(valid_during)),
    created_at     timestamptz NOT NULL DEFAULT now(),
    -- Un conductor o equipo tiene una sola empresa por día.
    CONSTRAINT fleet_assignment_periods_one_carrier_per_day
        EXCLUDE USING gist (relation WITH =, subject_id WITH =, valid_during WITH &&)
        WHERE (relation <> 'CARRIER_SHIPPER'),
    -- Una empresa tiene muchos clientes, pero el mismo cliente no se repite el mismo día.
    CONSTRAINT fleet_assignment_periods_one_link_per_day
        EXCLUDE USING gist (relation WITH =, subject_id WITH =, counterpart_id WITH =, valid_during WITH &&)
        WHERE (relation = 'CARRIER_SHIPPER')
);

CREATE INDEX IF NOT EXISTS fleet_assignment_periods_counterpart
    ON app.fleet_assignment_periods (relation, counterpart_id);

COMMENT ON TABLE app.fleet_assignment_periods IS
  'Historial de asignaciones: conductor-empresa, equipo-empresa y empresa-cliente, con vigencia [desde, hasta). '
  'Lo escribe solo el trigger app.track_assignment_period(). Lo lee app.carrier_of(tipo, id, fecha).';

REVOKE ALL ON app.fleet_assignment_periods FROM anon, authenticated;

-- ── La guarda del día cerrado ───────────────────────────────────────────────
-- Un día cerrado del Cierre (closure_periods.status = 'CLOSED') no cambia de empresa:
-- reabrirlo recalcula con las reglas de hoy. Un día reabierto vuelve a admitir cambios.
CREATE OR REPLACE FUNCTION app.assert_day_not_closed(p_day date)
RETURNS void
LANGUAGE plpgsql STABLE
SET search_path TO 'public', 'app', 'pg_catalog'
AS $$
DECLARE
    v_closed date;
BEGIN
    SELECT max(business_date) INTO v_closed
    FROM app.closure_periods
    WHERE status = 'CLOSED' AND business_date >= p_day;
    IF v_closed IS NOT NULL THEN
        RAISE EXCEPTION 'El % ya está cerrado en el Cierre: elige una fecha posterior.',
            to_char(v_closed, 'DD/MM')
            USING ERRCODE = 'P0001', HINT = 'CLOSED_DAY';
    END IF;
END
$$;

-- ── El trigger ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.track_assignment_period()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'app', 'pg_catalog'
AS $$
DECLARE
    v_relation    text;
    v_subject     uuid;
    v_counterpart uuid;
    v_day         date;
BEGIN
    CASE TG_TABLE_NAME
        WHEN 'driver_assignments' THEN
            v_relation := 'DRIVER_CARRIER'; v_subject := NEW.driver_id; v_counterpart := NEW.carrier_id;
        WHEN 'asset_assignments' THEN
            v_relation := 'ASSET_CARRIER'; v_subject := NEW.asset_id; v_counterpart := NEW.carrier_id;
        ELSE
            v_relation := 'CARRIER_SHIPPER'; v_subject := NEW.carrier_id; v_counterpart := NEW.shipper_id;
    END CASE;

    -- Termina: cierra el período abierto el día efectivo.
    IF TG_OP = 'UPDATE' AND OLD.status = 'ACTIVE' AND NEW.status IS DISTINCT FROM 'ACTIVE' THEN
        v_day := COALESCE(NEW.end_date, public.hoy_chile());
        IF v_relation <> 'CARRIER_SHIPPER' THEN
            PERFORM app.assert_day_not_closed(v_day);
        END IF;
        -- Empezó y terminó el mismo día: nunca cubrió un día, se borra.
        DELETE FROM app.fleet_assignment_periods
        WHERE relation = v_relation AND subject_id = v_subject AND counterpart_id = v_counterpart
          AND upper_inf(valid_during) AND lower(valid_during) >= v_day;
        UPDATE app.fleet_assignment_periods
        SET valid_during = daterange(lower(valid_during), v_day, '[)')
        WHERE relation = v_relation AND subject_id = v_subject AND counterpart_id = v_counterpart
          AND upper_inf(valid_during);
    END IF;

    -- Empieza: abre un período desde el día efectivo. Una reactivación que no tocó
    -- start_date (ON CONFLICT … SET status = 'ACTIVE') empieza hoy, no en julio.
    IF NEW.status = 'ACTIVE' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'ACTIVE') THEN
        v_day := CASE
            WHEN TG_OP = 'INSERT' THEN COALESCE(NEW.start_date, public.hoy_chile())
            WHEN NEW.start_date IS DISTINCT FROM OLD.start_date THEN COALESCE(NEW.start_date, public.hoy_chile())
            ELSE public.hoy_chile()
        END;
        IF v_relation <> 'CARRIER_SHIPPER' THEN
            PERFORM app.assert_day_not_closed(v_day);
        END IF;
        INSERT INTO app.fleet_assignment_periods (relation, subject_id, counterpart_id, valid_during)
        VALUES (v_relation, v_subject, v_counterpart, daterange(v_day, NULL, '[)'));
    END IF;

    RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trg_track_assignment_period ON public.driver_assignments;
CREATE TRIGGER trg_track_assignment_period
    AFTER INSERT OR UPDATE OF status ON public.driver_assignments
    FOR EACH ROW EXECUTE FUNCTION app.track_assignment_period();

DROP TRIGGER IF EXISTS trg_track_assignment_period ON public.asset_assignments;
CREATE TRIGGER trg_track_assignment_period
    AFTER INSERT OR UPDATE OF status ON public.asset_assignments
    FOR EACH ROW EXECUTE FUNCTION app.track_assignment_period();

DROP TRIGGER IF EXISTS trg_track_assignment_period ON public.carrier_shippers;
CREATE TRIGGER trg_track_assignment_period
    AFTER INSERT OR UPDATE OF status ON public.carrier_shippers
    FOR EACH ROW EXECUTE FUNCTION app.track_assignment_period();

-- ── Siembra ─────────────────────────────────────────────────────────────────
INSERT INTO app.fleet_assignment_periods (relation, subject_id, counterpart_id, valid_during)
SELECT 'DRIVER_CARRIER', driver_id, carrier_id, daterange(NULL, NULL)
FROM public.driver_assignments
WHERE status = 'ACTIVE' AND driver_id IS NOT NULL AND carrier_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM app.fleet_assignment_periods p WHERE p.relation = 'DRIVER_CARRIER')
UNION ALL
SELECT 'ASSET_CARRIER', asset_id, carrier_id, daterange(NULL, NULL)
FROM public.asset_assignments
WHERE status = 'ACTIVE' AND asset_id IS NOT NULL AND carrier_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM app.fleet_assignment_periods p WHERE p.relation = 'ASSET_CARRIER')
UNION ALL
SELECT 'CARRIER_SHIPPER', carrier_id, shipper_id, daterange(NULL, NULL)
FROM public.carrier_shippers
WHERE status = 'ACTIVE' AND carrier_id IS NOT NULL AND shipper_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM app.fleet_assignment_periods p WHERE p.relation = 'CARRIER_SHIPPER');

-- ── De qué empresa es, en una fecha ─────────────────────────────────────────
-- La firma de 2 argumentos (D1) sigue existiendo y responde por hoy: sus llamadores
-- no cambian.
CREATE OR REPLACE FUNCTION app.carrier_of(p_entity_type text, p_entity_id uuid, p_on date)
RETURNS uuid
LANGUAGE sql STABLE
SET search_path TO 'public', 'app', 'pg_catalog'
AS $$
    SELECT CASE p_entity_type
        WHEN 'CARRIER' THEN p_entity_id
        WHEN 'DRIVER' THEN (SELECT p.counterpart_id FROM app.fleet_assignment_periods p
                            WHERE p.relation = 'DRIVER_CARRIER' AND p.subject_id = p_entity_id
                              AND p.valid_during @> p_on)
        WHEN 'ASSET' THEN (SELECT p.counterpart_id FROM app.fleet_assignment_periods p
                           WHERE p.relation = 'ASSET_CARRIER' AND p.subject_id = p_entity_id
                             AND p.valid_during @> p_on)
    END
$$;

COMMENT ON FUNCTION app.carrier_of(text, uuid, date) IS
  'Empresa de una entidad en una fecha, desde app.fleet_assignment_periods. CARRIER es ella misma; '
  'DRIVER y ASSET, la del período que cubre la fecha; otro tipo, NULL.';

CREATE OR REPLACE FUNCTION app.carrier_of(p_entity_type text, p_entity_id uuid)
RETURNS uuid
LANGUAGE sql STABLE
SET search_path TO 'public', 'app', 'pg_catalog'
AS $$
    SELECT app.carrier_of(p_entity_type, p_entity_id, public.hoy_chile())
$$;

REVOKE ALL ON FUNCTION app.carrier_of(text, uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.carrier_of(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.assert_day_not_closed(date) FROM PUBLIC, anon, authenticated;
