-- Modelo de cierre, ola 1: un período por día y una línea de conciliación por sujeto
--
-- Diseño: docs/superpowers/specs/2026-09-14-modelo-de-cierre-design.md.
-- Plan: Solicitud de Cambios Diario 2.0 (16/09), Ola 2.
--
-- Hoy un solo acto —cerrar un día— vive en cinco almacenamientos con dos firmas:
-- daily_closures + driver_day_status (conductores), equipment_closures +
-- equipment_day_status (tractos) y app.trips (viajes). De ahí salen defectos
-- medidos: días firmados que se siguen recalculando, un día cerrado en una
-- cabecera y abierto en la otra, la RLS perdida al copiar el eje de tractos, y
-- un eje de viajes sin dónde guardar quién resolvió qué.
--
-- Esta migración sólo crea las dos tablas. Nadie las lee ni las escribe
-- todavía: es reversible con un DROP.
--
-- Agregado respecto del spec: `closure_lines.valid_until`, la vigencia de un
-- motivo de "no trabajó" (Vacaciones, Licencia) para que el día siguiente lo
-- herede. Operaciones lo pidió en la misma solicitud: hoy se reescriben a mano
-- cada día (Conductor backup se repite al día siguiente en 18 de 20 casos).

CREATE TABLE app.closure_periods (
    business_date   date PRIMARY KEY,
    status          text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
    closed_by       uuid REFERENCES auth.users(id),
    closed_at       timestamptz,
    reopened_by     uuid REFERENCES auth.users(id),
    reopened_at     timestamptz,
    reopen_note     text,
    override_count  int NOT NULL DEFAULT 0,
    override_note   text,
    -- Las cifras al firmar. jsonb y no columnas: es una foto de derivados que
    -- sólo se muestra, y cada eje nuevo agregaría dos columnas.
    frozen_totals   jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT closure_periods_cerrado_tiene_firma
        CHECK (status = 'OPEN' OR (closed_by IS NOT NULL AND closed_at IS NOT NULL))
);

COMMENT ON TABLE app.closure_periods IS
    'Un día de operación y su estado de cierre. Cerrado, sus líneas no se recalculan.';

CREATE TABLE app.closure_lines (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_date   date NOT NULL REFERENCES app.closure_periods(business_date),
    subject_type    text NOT NULL CHECK (subject_type IN ('DRIVER', 'ASSET', 'TRIP')),
    -- Polimórfico: public.drivers, public.assets o app.trips según
    -- subject_type. Sin FK a propósito (Postgres no tiene FK condicional); la
    -- integridad la cuida el trigger de abajo. Al consultar, filtrar SIEMPRE
    -- también por subject_type: un id solo da falsos negativos.
    subject_id      uuid NOT NULL,
    status          text NOT NULL CHECK (status IN ('ASSIGNED', 'UNASSIGNED', 'MISMATCH')),
    requires_reason boolean NOT NULL DEFAULT true,
    reason_id       uuid REFERENCES app.status_taxonomies(id),
    valid_until     date,
    comentario      text,
    resolved_by     uuid REFERENCES auth.users(id),
    resolved_at     timestamptz,
    computed_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (business_date, subject_type, subject_id),
    CONSTRAINT closure_lines_vigencia_con_motivo
        CHECK (valid_until IS NULL OR (reason_id IS NOT NULL AND valid_until >= business_date))
);

COMMENT ON TABLE app.closure_lines IS
    'Una línea de conciliación por (día, sujeto): qué pasó con ese conductor, '
    'tracto o viaje ese día, y quién lo explicó.';
COMMENT ON COLUMN app.closure_lines.valid_until IS
    'Hasta qué día sigue vigente el motivo. Una línea sin carga y sin motivo de '
    'un día posterior lo hereda; un viaje del TMS le gana ese día sin borrarlo.';

-- Lectura de cada pestaña, y "¿qué pasó con este tracto los últimos 30 días?".
CREATE INDEX closure_lines_por_dia_y_tipo ON app.closure_lines (business_date, subject_type);
CREATE INDEX closure_lines_por_sujeto ON app.closure_lines (subject_type, subject_id, business_date);

CREATE OR REPLACE FUNCTION app.closure_lines_valida_sujeto()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.subject_type = 'DRIVER'
       AND NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = NEW.subject_id) THEN
        RAISE EXCEPTION 'closure_lines: el conductor % no existe', NEW.subject_id
            USING ERRCODE = 'foreign_key_violation';
    ELSIF NEW.subject_type = 'ASSET'
       AND NOT EXISTS (SELECT 1 FROM public.assets WHERE id = NEW.subject_id) THEN
        RAISE EXCEPTION 'closure_lines: el activo % no existe', NEW.subject_id
            USING ERRCODE = 'foreign_key_violation';
    ELSIF NEW.subject_type = 'TRIP'
       AND NOT EXISTS (SELECT 1 FROM app.trips WHERE id = NEW.subject_id) THEN
        RAISE EXCEPTION 'closure_lines: el viaje % no existe', NEW.subject_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER closure_lines_valida_sujeto
    BEFORE INSERT OR UPDATE OF subject_type, subject_id ON app.closure_lines
    FOR EACH ROW EXECUTE FUNCTION app.closure_lines_valida_sujeto();

-- RLS desde la creación: es el paso que se perdió al copiar el eje de tractos.
-- Mismo criterio que driver_day_status: lectura para authenticated; la
-- escritura va por el backend, que no pasa por RLS.
ALTER TABLE app.closure_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.closure_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Closure periods are viewable by authenticated users"
    ON app.closure_periods FOR SELECT TO authenticated USING (true);
CREATE POLICY "Closure lines are viewable by authenticated users"
    ON app.closure_lines FOR SELECT TO authenticated USING (true);
