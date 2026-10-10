-- Firma versionada e inmutable del Cierre (spec 2026-10-10 anulación y firma versionada, §3).
--
-- Cada firma guarda su copia: quién y cuándo (closure_signatures), las líneas tal como se
-- firmaron (closure_signature_lines, mismas columnas que closure_lines) y los viajes del
-- día al firmar (closure_signature_trips: app.trips con planning_date = D y sin anular, el
-- universo de totals.viajes). Reabrir no las toca; volver a firmar crea la versión N+1.
-- Solo inserciones: el trigger rechaza UPDATE, DELETE y TRUNCATE (estándar de tablas de
-- auditoría, verificado en la base y no en el código).
--
-- Carga inicial: cada día CLOSED recibe su versión 1 (captured_from = 'backfill'). Los
-- viajes se reconstruyen con created_at <= closed_at (created_at está en
-- merge_exclude_columns: es la primera vez que el viaje entró). Medido el 10/10: los 25
-- días coinciden con frozen_totals.viajes. Si alguno no coincide, la migración aborta.

BEGIN;

CREATE TABLE app.closure_signatures (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_date  date        NOT NULL,
    version        int         NOT NULL CHECK (version >= 1),
    signed_by      uuid        NOT NULL,
    signed_at      timestamptz NOT NULL,
    override_count int         NOT NULL DEFAULT 0,
    override_note  text,
    totals         jsonb       NOT NULL,
    captured_from  text        NOT NULL CHECK (captured_from IN ('signing', 'backfill')),
    UNIQUE (business_date, version)
);

CREATE TABLE app.closure_signature_lines (
    signature_id          bigint      NOT NULL REFERENCES app.closure_signatures (id),
    subject_type          text        NOT NULL,
    subject_id            uuid        NOT NULL,
    status                text        NOT NULL,
    requires_reason       boolean     NOT NULL,
    reason_id             uuid,
    valid_until           date,
    comentario            text,
    resolved_by           uuid,
    resolved_at           timestamptz,
    computed_at           timestamptz NOT NULL,
    home_location_id      uuid,
    reason_from_driver_id uuid,
    PRIMARY KEY (signature_id, subject_type, subject_id)
);

-- Sin FK a app.trips: el --full-refresh de dbt recrea esa tabla y borra las FK.
CREATE TABLE app.closure_signature_trips (
    signature_id bigint NOT NULL REFERENCES app.closure_signatures (id),
    trip_id      uuid   NOT NULL,
    PRIMARY KEY (signature_id, trip_id)
);

COMMENT ON TABLE app.closure_signatures IS
    'Una fila por firma del Cierre, versionada por día. Solo inserciones. La firma vigente '
    'de un día es la de mayor versión.';
COMMENT ON TABLE app.closure_signature_lines IS
    'Copia de app.closure_lines al firmar (mismas columnas). Solo inserciones.';
COMMENT ON TABLE app.closure_signature_trips IS
    'Viajes del día al firmar: app.trips con planning_date = D y sin anular. Solo inserciones.';

CREATE FUNCTION app.reject_signature_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'La firma del Cierre es inmutable: % en % no está permitido', TG_OP, TG_TABLE_NAME;
END;
$$;

DO $$
DECLARE
    tabla text;
BEGIN
    FOREACH tabla IN ARRAY ARRAY[
        'app.closure_signatures', 'app.closure_signature_lines', 'app.closure_signature_trips'
    ] LOOP
        EXECUTE format('CREATE TRIGGER trg_reject_signature_changes BEFORE UPDATE OR DELETE ON %s '
                       'FOR EACH ROW EXECUTE FUNCTION app.reject_signature_changes()', tabla);
        EXECUTE format('CREATE TRIGGER trg_reject_signature_truncate BEFORE TRUNCATE ON %s '
                       'FOR EACH STATEMENT EXECUTE FUNCTION app.reject_signature_changes()', tabla);
        -- Acceso solo por la API (memoria "acceso solo por invitación"): sin grants públicos.
        EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tabla);
        EXECUTE format('REVOKE ALL ON %s FROM anon, authenticated', tabla);
    END LOOP;
END $$;

-- Carga inicial: versión 1 de cada día firmado.
INSERT INTO app.closure_signatures
    (business_date, version, signed_by, signed_at, override_count, override_note, totals, captured_from)
SELECT p.business_date, 1, p.closed_by, p.closed_at, COALESCE(p.override_count, 0), p.override_note,
       p.frozen_totals, 'backfill'
FROM app.closure_periods p
WHERE p.status = 'CLOSED';

INSERT INTO app.closure_signature_lines
    (signature_id, subject_type, subject_id, status, requires_reason, reason_id, valid_until, comentario,
     resolved_by, resolved_at, computed_at, home_location_id, reason_from_driver_id)
SELECT s.id, l.subject_type, l.subject_id, l.status, l.requires_reason, l.reason_id, l.valid_until, l.comentario,
       l.resolved_by, l.resolved_at, l.computed_at, l.home_location_id, l.reason_from_driver_id
FROM app.closure_signatures s
JOIN app.closure_lines l ON l.business_date = s.business_date;

INSERT INTO app.closure_signature_trips (signature_id, trip_id)
SELECT s.id, t.id
FROM app.closure_signatures s
JOIN app.trips t ON t.planning_date = s.business_date AND t.created_at <= s.signed_at;

DO $$
DECLARE
    distintos text;
BEGIN
    SELECT string_agg(s.business_date::text, ', ' ORDER BY s.business_date) INTO distintos
    FROM app.closure_signatures s
    WHERE (SELECT count(*) FROM app.closure_signature_trips v WHERE v.signature_id = s.id)
          <> (s.totals->>'viajes')::int
       OR (SELECT count(*) FROM app.closure_signature_lines l WHERE l.signature_id = s.id)
          <> (SELECT count(*) FROM app.closure_lines c WHERE c.business_date = s.business_date);
    IF distintos IS NOT NULL THEN
        RAISE EXCEPTION 'La versión 1 no coincide con lo firmado en: %', distintos;
    END IF;
END $$;

COMMIT;
