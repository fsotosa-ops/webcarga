-- El estado del ciclo de vida con vigencia por día (plan 2026-10-28, "Empresas en onboarding en el Cierre").
--
-- `operational_status` es el estado de HOY. Para armar el Cierre de un día hace falta el estado de ESE día:
-- dar de baja hoy una empresa no puede sacar su flota de un día abierto de julio en que sí operó, y una
-- activación que rige desde mañana no puede meterla en el Cierre de hoy. Esta tabla guarda cada período,
-- con el mismo patrón que app.fleet_assignment_periods (20261017090000).
--
-- Quién escribe:
--   · app.set_lifecycle_status(): el camino de la app (services/lifecycle.py). Lleva la fecha de vigencia,
--     que puede ser futura (una activación que rige desde mañana). Si ya rige, actualiza también la fila.
--   · el trigger app.track_lifecycle_status(): captura a cualquier otro escritor (un alta, un UPDATE directo
--     de un test o una migración) con vigencia desde el primer día no firmado.
--   · app.apply_due_lifecycle_statuses(): lleva a la fila un período programado cuando llega su día. Lo
--     llama el ejecutor del Cierre (services/cola_del_cierre.py).
--
-- Siembra: desde audit_log, que tiene cada cambio de operational_status con su hora. El estado anterior al
-- primer cambio rige sin límite inferior. LEGACY_INACTIVE es la baja con su nombre viejo (20261028090100).
-- Si el último estado de la historia no coincide con el de hoy, rige el de hoy desde hoy.

BEGIN;

CREATE TABLE IF NOT EXISTS app.lifecycle_status_periods (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type     text NOT NULL CHECK (entity_type IN ('CARRIER', 'DRIVER', 'ASSET')),
    entity_id       uuid NOT NULL,
    status          text NOT NULL CHECK (status IN ('ACTIVE', 'ONBOARDING', 'INACTIVE')),
    valid_during    daterange NOT NULL CHECK (NOT isempty(valid_during)),
    reason_id       uuid REFERENCES app.status_taxonomies (id),
    note            text,
    -- Una activación por excepción es provisoria: hasta este día, la carpeta tiene que cumplir.
    exception_until date,
    source          text NOT NULL CHECK (source IN ('app', 'auto', 'migration', 'direct')),
    created_by      uuid,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT lifecycle_status_periods_one_status_per_day
        EXCLUDE USING gist (entity_type WITH =, entity_id WITH =, valid_during WITH &&),
    CONSTRAINT lifecycle_status_periods_exception_only_when_active
        CHECK (exception_until IS NULL OR status = 'ACTIVE')
);

COMMENT ON TABLE app.lifecycle_status_periods IS
  'Estado del ciclo de vida de empresas, conductores y equipos, con vigencia [desde, hasta). '
  'Lo escriben app.set_lifecycle_status() y el trigger app.track_lifecycle_status(). Lo lee app.status_on().';

REVOKE ALL ON app.lifecycle_status_periods FROM anon, authenticated;

-- ── El primer día que se puede cambiar ──────────────────────────────────────
-- Un día firmado no cambia (app.assert_day_not_closed): el primer día libre desde p_day.
CREATE OR REPLACE FUNCTION app.first_unclosed_day(p_day date)
RETURNS date
LANGUAGE sql STABLE
SET search_path TO 'public', 'app', 'pg_catalog'
AS $$
    SELECT GREATEST(p_day, COALESCE(
        (SELECT max(business_date) + 1 FROM app.closure_periods WHERE status = 'CLOSED' AND business_date >= p_day),
        p_day))
$$;

-- ── El estado de un día ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.status_on(p_entity_type text, p_entity_id uuid, p_day date)
RETURNS text
LANGUAGE sql STABLE
SET search_path TO 'public', 'app', 'pg_catalog'
AS $$
    SELECT p.status FROM app.lifecycle_status_periods p
    WHERE p.entity_type = p_entity_type AND p.entity_id = p_entity_id AND p.valid_during @> p_day
$$;

-- ── El período, en un solo lugar ────────────────────────────────────────────
-- Lo programado desde p_from en adelante queda reemplazado; el período que contiene p_from termina ahí.
CREATE OR REPLACE FUNCTION app.write_status_period(
    p_entity_type text, p_entity_id uuid, p_status text, p_from date, p_source text,
    p_reason_id uuid, p_note text, p_exception_until date, p_actor uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'app', 'pg_catalog'
AS $$
BEGIN
    DELETE FROM app.lifecycle_status_periods
    WHERE entity_type = p_entity_type AND entity_id = p_entity_id AND lower(valid_during) >= p_from;
    UPDATE app.lifecycle_status_periods
    SET valid_during = daterange(lower(valid_during), p_from, '[)')
    WHERE entity_type = p_entity_type AND entity_id = p_entity_id AND valid_during @> p_from;
    INSERT INTO app.lifecycle_status_periods
        (entity_type, entity_id, status, valid_during, reason_id, note, exception_until, source, created_by)
    VALUES (p_entity_type, p_entity_id, p_status, daterange(p_from, NULL, '[)'), p_reason_id, p_note,
            p_exception_until, p_source, p_actor);
END
$$;

-- ── Lleva a la fila el estado que rige hoy ──────────────────────────────────
-- La bandera de la transacción avisa al trigger que el período ya está escrito.
CREATE OR REPLACE FUNCTION app.sync_status_row(p_entity_type text, p_entity_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'app', 'pg_catalog'
AS $$
DECLARE
    v record;
BEGIN
    SELECT p.status, p.reason_id, p.note INTO v
    FROM app.lifecycle_status_periods p
    WHERE p.entity_type = p_entity_type AND p.entity_id = p_entity_id AND p.valid_during @> public.hoy_chile();
    IF NOT FOUND THEN
        RETURN;
    END IF;
    PERFORM set_config('app.lifecycle_writer', 'on', true);
    IF p_entity_type = 'CARRIER' THEN
        UPDATE public.carriers SET operational_status = v.status, status_reason_id = v.reason_id,
               status_note = v.note, status_changed_at = now(), updated_at = now()
        WHERE id = p_entity_id AND operational_status IS DISTINCT FROM v.status;
    ELSIF p_entity_type = 'DRIVER' THEN
        UPDATE public.drivers SET operational_status = v.status, status_reason_id = v.reason_id,
               status_note = v.note, status_changed_at = now()
        WHERE id = p_entity_id AND operational_status IS DISTINCT FROM v.status;
    ELSE
        UPDATE public.assets SET operational_status = v.status, status_reason_id = v.reason_id,
               status_note = v.note, status_changed_at = now()
        WHERE id = p_entity_id AND operational_status IS DISTINCT FROM v.status;
    END IF;
    PERFORM set_config('app.lifecycle_writer', 'off', true);
END
$$;

-- ── El camino de la app ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.set_lifecycle_status(
    p_entity_type text, p_entity_id uuid, p_status text, p_from date, p_source text,
    p_reason_id uuid DEFAULT NULL, p_note text DEFAULT NULL, p_exception_until date DEFAULT NULL,
    p_actor uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'app', 'pg_catalog'
AS $$
BEGIN
    PERFORM app.assert_day_not_closed(p_from);
    PERFORM app.write_status_period(p_entity_type, p_entity_id, p_status, p_from, p_source,
                                    p_reason_id, p_note, p_exception_until, p_actor);
    PERFORM app.sync_status_row(p_entity_type, p_entity_id);
END
$$;

-- ── Los programados que ya llegaron ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.apply_due_lifecycle_statuses()
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public', 'app', 'pg_catalog'
AS $$
DECLARE
    v record;
    v_count integer := 0;
BEGIN
    FOR v IN
        SELECT p.entity_type, p.entity_id
        FROM app.lifecycle_status_periods p
        LEFT JOIN public.carriers c ON p.entity_type = 'CARRIER' AND c.id = p.entity_id
        LEFT JOIN public.drivers d ON p.entity_type = 'DRIVER' AND d.id = p.entity_id
        LEFT JOIN public.assets a ON p.entity_type = 'ASSET' AND a.id = p.entity_id
        WHERE p.valid_during @> public.hoy_chile()
          AND p.status IS DISTINCT FROM COALESCE(c.operational_status, d.operational_status, a.operational_status)
          AND COALESCE(c.id, d.id, a.id) IS NOT NULL
    LOOP
        PERFORM app.sync_status_row(v.entity_type, v.entity_id);
        v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
END
$$;

-- ── El trigger: cualquier otro escritor queda capturado ─────────────────────
CREATE OR REPLACE FUNCTION app.track_lifecycle_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'app', 'pg_catalog'
AS $$
DECLARE
    v_type text := CASE TG_TABLE_NAME WHEN 'carriers' THEN 'CARRIER' WHEN 'drivers' THEN 'DRIVER' ELSE 'ASSET' END;
    v_status text := CASE NEW.operational_status WHEN 'LEGACY_INACTIVE' THEN 'INACTIVE' ELSE NEW.operational_status END;
BEGIN
    IF current_setting('app.lifecycle_writer', true) = 'on' THEN
        RETURN NULL;
    END IF;
    IF TG_OP = 'INSERT' THEN
        -- Un alta nace con su estado; antes de existir no tenía flota que contar.
        INSERT INTO app.lifecycle_status_periods (entity_type, entity_id, status, valid_during, source)
        VALUES (v_type, NEW.id, v_status, daterange(NULL, NULL), 'direct');
    ELSIF NEW.operational_status IS DISTINCT FROM OLD.operational_status THEN
        PERFORM app.write_status_period(v_type, NEW.id, v_status, app.first_unclosed_day(public.hoy_chile()),
                                        'direct', NEW.status_reason_id, NEW.status_note, NULL, NULL);
    END IF;
    RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trg_track_lifecycle_status ON public.carriers;
CREATE TRIGGER trg_track_lifecycle_status AFTER INSERT OR UPDATE OF operational_status ON public.carriers
    FOR EACH ROW EXECUTE FUNCTION app.track_lifecycle_status();
DROP TRIGGER IF EXISTS trg_track_lifecycle_status ON public.drivers;
CREATE TRIGGER trg_track_lifecycle_status AFTER INSERT OR UPDATE OF operational_status ON public.drivers
    FOR EACH ROW EXECUTE FUNCTION app.track_lifecycle_status();
DROP TRIGGER IF EXISTS trg_track_lifecycle_status ON public.assets;
CREATE TRIGGER trg_track_lifecycle_status AFTER INSERT OR UPDATE OF operational_status ON public.assets
    FOR EACH ROW EXECUTE FUNCTION app.track_lifecycle_status();

-- Un período programado cambia el Cierre de los días que cubre: misma cola que el resto de los datos de entrada.
DROP TRIGGER IF EXISTS trg_enqueue_closure_recompute_ins ON app.lifecycle_status_periods;
CREATE TRIGGER trg_enqueue_closure_recompute_ins AFTER INSERT ON app.lifecycle_status_periods
    REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION app.enqueue_closure_recompute();
DROP TRIGGER IF EXISTS trg_enqueue_closure_recompute_upd ON app.lifecycle_status_periods;
CREATE TRIGGER trg_enqueue_closure_recompute_upd AFTER UPDATE ON app.lifecycle_status_periods
    REFERENCING NEW TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION app.enqueue_closure_recompute();
DROP TRIGGER IF EXISTS trg_enqueue_closure_recompute_del ON app.lifecycle_status_periods;
CREATE TRIGGER trg_enqueue_closure_recompute_del AFTER DELETE ON app.lifecycle_status_periods
    REFERENCING OLD TABLE AS changed FOR EACH STATEMENT EXECUTE FUNCTION app.enqueue_closure_recompute();

-- ── Siembra desde audit_log ─────────────────────────────────────────────────
INSERT INTO app.lifecycle_status_periods (entity_type, entity_id, status, valid_during, source)
WITH ent AS (
    SELECT 'CARRIER'::text AS et, id, operational_status AS cur FROM public.carriers
    UNION ALL SELECT 'DRIVER', id, operational_status FROM public.drivers
    UNION ALL SELECT 'ASSET', id, operational_status FROM public.assets
),
ev AS (
    SELECT a.entity_type AS et, a.entity_id AS id, a.id AS aid, a.occurred_at,
           (a.occurred_at AT TIME ZONE 'America/Santiago')::date AS d,
           CASE a.old_value #>> '{}' WHEN 'LEGACY_INACTIVE' THEN 'INACTIVE' ELSE a.old_value #>> '{}' END AS old_s,
           CASE a.new_value #>> '{}' WHEN 'LEGACY_INACTIVE' THEN 'INACTIVE' ELSE a.new_value #>> '{}' END AS new_s
    FROM public.audit_log a
    JOIN ent e ON e.et = a.entity_type AND e.id = a.entity_id
    WHERE a.field = 'operational_status'
),
first_old AS (
    SELECT DISTINCT ON (et, id) et, id, old_s FROM ev ORDER BY et, id, occurred_at, aid
),
day_last AS (
    -- Varios cambios el mismo día: rige el último.
    SELECT DISTINCT ON (et, id, d) et, id, d, new_s FROM ev ORDER BY et, id, d, occurred_at DESC, aid DESC
),
points AS (
    SELECT e.et, e.id, NULL::date AS d,
           COALESCE(f.old_s, CASE e.cur WHEN 'LEGACY_INACTIVE' THEN 'INACTIVE' ELSE e.cur END) AS s
    FROM ent e LEFT JOIN first_old f USING (et, id)
    UNION ALL
    SELECT et, id, d, new_s FROM day_last
),
marked AS (
    SELECT et, id, d, s, lag(s) OVER (PARTITION BY et, id ORDER BY d NULLS FIRST) AS prev,
           row_number() OVER (PARTITION BY et, id ORDER BY d NULLS FIRST) AS rn
    FROM points
),
kept AS (
    SELECT et, id, d, s FROM marked WHERE rn = 1 OR s IS DISTINCT FROM prev
)
SELECT et, id, s, daterange(d, lead(d) OVER (PARTITION BY et, id ORDER BY d NULLS FIRST), '[)'), 'migration'
FROM kept;

-- El último estado de la historia tiene que ser el de hoy; si no, rige el de hoy desde el primer día libre.
DO $$
DECLARE
    v record;
BEGIN
    FOR v IN
        SELECT p.entity_type, p.entity_id, e.cur
        FROM app.lifecycle_status_periods p
        JOIN (
            SELECT 'CARRIER'::text AS et, id, operational_status AS cur FROM public.carriers
            UNION ALL SELECT 'DRIVER', id, operational_status FROM public.drivers
            UNION ALL SELECT 'ASSET', id, operational_status FROM public.assets
        ) e ON e.et = p.entity_type AND e.id = p.entity_id
        WHERE upper_inf(p.valid_during) AND p.status IS DISTINCT FROM e.cur
    LOOP
        PERFORM app.write_status_period(v.entity_type, v.entity_id, v.cur,
                                        app.first_unclosed_day(public.hoy_chile()), 'migration', NULL, NULL, NULL, NULL);
    END LOOP;
END
$$;

-- ── Volver a onboarding: su vocabulario ─────────────────────────────────────
-- Solo desde una empresa activa (activada antes de tiempo, o una excepción vencida). Una dada de baja
-- vuelve con "Reactivar", que decide según su carpeta: completa, activa; incompleta, onboarding.
ALTER TABLE app.status_taxonomies DROP CONSTRAINT status_taxonomies_domain_check;
ALTER TABLE app.status_taxonomies ADD CONSTRAINT status_taxonomies_domain_check CHECK (domain = ANY (ARRAY[
    'OPERATIONAL_STATE', 'DRIVER_REASON', 'EQUIPMENT_STATE', 'FLEET_SERVICE_TYPE',
    'WEBCARGA_OPERATION_TYPE', 'TRIP_UNASSIGNED_REASON', 'TRIP_VOID_REASON',
    'DEACTIVATION_REASON', 'REACTIVATION_REASON', 'ACTIVATION_EXCEPTION_REASON',
    'RETURN_TO_ONBOARDING_REASON']));

INSERT INTO app.status_taxonomies (domain, code, label, sort_order, active)
SELECT v.domain, v.code, v.label, v.sort_order, true
FROM (VALUES
    ('RETURN_TO_ONBOARDING_REASON', 'ACTIVATED_BY_MISTAKE',     'Se activó antes de tiempo',           1),
    ('RETURN_TO_ONBOARDING_REASON', 'EXCEPTION_EXPIRED',        'Venció el plazo de la excepción',     2),
    ('RETURN_TO_ONBOARDING_REASON', 'OTHER',                    'Otro',                                3)
) AS v(domain, code, label, sort_order)
WHERE NOT EXISTS (
    SELECT 1 FROM app.status_taxonomies t WHERE t.domain = v.domain AND t.code = v.code
);

-- ── La baja definitiva (28/10) ──────────────────────────────────────────────
-- Un motivo de baja puede impedir la reactivación salvo con directory.reinstate (Administración). Es un
-- atributo del motivo en el catálogo, no un código escrito en la API.
ALTER TABLE app.status_taxonomies ADD COLUMN IF NOT EXISTS blocks_reactivation boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN app.status_taxonomies.blocks_reactivation IS
  'Solo DEACTIVATION_REASON: una baja con este motivo se reactiva únicamente con directory.reinstate.';
INSERT INTO app.status_taxonomies (domain, code, label, sort_order, active, group_id, blocks_reactivation)
SELECT 'DEACTIVATION_REASON', 'DO_NOT_REHIRE', 'No volver a trabajar con ella', 6, true, 'all', true
WHERE NOT EXISTS (
    SELECT 1 FROM app.status_taxonomies t WHERE t.domain = 'DEACTIVATION_REASON' AND t.code = 'DO_NOT_REHIRE'
);

REVOKE ALL ON FUNCTION app.first_unclosed_day(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.status_on(text, uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.write_status_period(text, uuid, text, date, text, uuid, text, date, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.sync_status_row(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.set_lifecycle_status(text, uuid, text, date, text, uuid, text, date, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.apply_due_lifecycle_statuses() FROM PUBLIC, anon, authenticated;

COMMIT;
