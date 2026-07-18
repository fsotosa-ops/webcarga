-- Fase 1 del hardening del Diario (2026-07-18) — dos arreglos en una sola
-- migración porque el segundo depende del primero para no duplicar filas.
--
-- ── Parte 1: resincronizar app.trips.fleet_link_id ──────────────────────────
-- Hallazgo en vivo: app.trip_fleet_links.trip_id apuntaba correctamente a
-- 609/609 viajes reales, pero app.trips.fleet_link_id (la columna que usaba
-- el backend para el JOIN) estaba en NULL en 608 de esos 609 casos. Causa
-- raíz: fleet_link_id está protegido en el MERGE incremental
-- (merge_exclude_columns en dbt/tms/models/app/trips.sql) pero NO en un
-- --full-refresh (DROP + CREATE TABLE AS SELECT, que siempre computa
-- NULL::uuid AS fleet_link_id) — y el pipeline pasó por varios full-refresh
-- durante el hardening de julio. Resultado: la trazabilidad
-- carrier/driver/asset ya vinculada manualmente era invisible vía API pese
-- a que el dato existía. El código de trips.py ya se corrigió para unir por
-- trip_id (inmune a este problema hacia adelante); esto repara el dato
-- existente.
--
-- ── Parte 2: bootstrap de driver_id/carrier_id/tractor_asset_id ────────────
-- Motivado por la pregunta del usuario sobre por qué el match de conductor
-- por nombre/RUT reportado directo por el TMS es tan débil (QAnalytics,
-- 86% del volumen, nunca reporta RUT; Sodimac, 13%, no reporta NADA de
-- conductor — limitación estructural del TMS, no de matching). La vía real
-- es bronze.raw_bd_ot (Órdenes de Transporte del sistema admin legacy de
-- WebCarga, no del TMS): 105,695 filas, 100% cobertura real en
-- rut_chofer/chofer/patente_camion, actualizada activamente. Verificado en
-- vivo antes de aplicar:
--   - 67/85 patentes distintas de app.trips matchean en raw_bd_ot (79%).
--   - 204/209 eett_id distintos matchean public.carriers.legacy_admin_id
--     (97.6% — confirma que viene del mismo sistema admin que sembró el
--     directorio de Empresas).
--   - Match temporal patente+fecha (f_despacho más cercano a
--     planning_date, tope 30 días): 2361 viajes con candidato, mediana de
--     0.2 días de diferencia, 2346/2361 (99.4%) dentro de 30 días. De esos,
--     2160 resuelven a un driver_id real ya existente en public.drivers.
--   - f_h_asignar_camion se descartó como fecha de referencia: es un
--     artefacto del batch de sync (mismo valor repetido en filas de
--     viajes distintos), no una fecha real por OT — se usó f_despacho.
--   - Filtro de fecha por regex (no cast directo): raw_bd_ot tiene fechas
--     corruptas de exportación Excel (ej. "29-12-1899 19:17:14", el
--     "cero" clásico de Excel) que rompen un ::timestamp directo.
--
-- IMPORTANTE (ver trips_context.md §5.3): raw_bd_ot es un import frágil de
-- una plataforma admin legacy que se va a dar de baja — se usa acá
-- EXCLUSIVAMENTE como bootstrap histórico de una sola vez, no como
-- dependencia permanente. No se crea ningún job/trigger que la consulte de
-- nuevo.
--
-- link_source = 'auto' (no 'manual') para distinguir estos vínculos de los
-- creados a mano por operaciones — ya es uno de los 2 valores permitidos
-- por trip_fleet_links_link_source_check.

BEGIN;

-- ── Parte 1: resync de fleet_link_id huérfanos ──────────────────────────────
UPDATE app.trips t
SET fleet_link_id = fl.id
FROM app.trip_fleet_links fl
WHERE fl.trip_id = t.id
  AND t.fleet_link_id IS DISTINCT FROM fl.id;

UPDATE app.trips_manual m
SET fleet_link_id = fl.id
FROM app.trip_fleet_links fl
WHERE fl.trip_id = m.id
  AND m.fleet_link_id IS DISTINCT FROM fl.id;

-- ── Parte 2: bootstrap vía raw_bd_ot ─────────────────────────────────────────
CREATE TEMP TABLE _bootstrap_matches ON COMMIT DROP AS
WITH trip_candidates AS (
    SELECT
        t.id AS trip_id,
        t.fleet_link_id,
        t.planning_date,
        upper(trim(coalesce(nullif(t.fleet->>'tractor_plate', ''), t.fleet->>'trailer_plate'))) AS plate
    FROM app.trips t
    WHERE nullif(trim(t.fleet->>'tractor_plate'), '') IS NOT NULL
       OR nullif(trim(t.fleet->>'trailer_plate'), '') IS NOT NULL
),
ranked AS (
    SELECT
        tc.trip_id,
        tc.fleet_link_id,
        tc.plate,
        bd.rut_chofer,
        bd.eett_id,
        row_number() OVER (
            PARTITION BY tc.trip_id
            ORDER BY abs(extract(epoch FROM (bd.f_despacho::timestamp - tc.planning_date::timestamp)))
        ) AS rn,
        abs(extract(epoch FROM (bd.f_despacho::timestamp - tc.planning_date::timestamp))) / 86400.0 AS dias_diff
    FROM trip_candidates tc
    JOIN bronze.raw_bd_ot bd
        ON upper(trim(bd.patente_camion)) = tc.plate
        AND bd.f_despacho ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$'
        AND nullif(trim(bd.rut_chofer), '') IS NOT NULL
)
SELECT
    r.trip_id,
    r.fleet_link_id,
    r.plate,
    d.id AS resolved_driver_id,
    c.id AS resolved_carrier_id,
    a.id AS resolved_tractor_asset_id
FROM ranked r
LEFT JOIN public.drivers d
    ON regexp_replace(d.tax_id, '[^0-9kK]', '', 'g') = regexp_replace(r.rut_chofer, '[^0-9kK]', '', 'g')
LEFT JOIN public.carriers c ON trim(c.legacy_admin_id) = trim(r.eett_id)
LEFT JOIN public.assets a ON upper(trim(a.license_plate)) = r.plate
WHERE r.rn = 1
  AND r.dias_diff <= 30;

-- 2a) Completar driver_id en links YA existentes (manual u orfanato recién
-- resincronizado) sin tocar carrier_id/tractor_asset_id ya seteados a mano.
UPDATE app.trip_fleet_links fl
SET driver_id = m.resolved_driver_id,
    updated_at = now()
FROM _bootstrap_matches m
WHERE m.fleet_link_id = fl.id
  AND fl.driver_id IS NULL
  AND m.resolved_driver_id IS NOT NULL;

-- 2b) Crear links nuevos para viajes que hoy no tienen ninguno.
WITH new_links AS (
    INSERT INTO app.trip_fleet_links
        (trip_id, driver_id, carrier_id, tractor_asset_id, tractor_plate, link_source)
    SELECT
        m.trip_id, m.resolved_driver_id, m.resolved_carrier_id,
        m.resolved_tractor_asset_id, m.plate, 'auto'
    FROM _bootstrap_matches m
    WHERE m.fleet_link_id IS NULL
      AND (
        m.resolved_driver_id IS NOT NULL
        OR m.resolved_carrier_id IS NOT NULL
        OR m.resolved_tractor_asset_id IS NOT NULL
      )
    RETURNING id, trip_id
)
UPDATE app.trips t
SET fleet_link_id = nl.id,
    updated_at = now()
FROM new_links nl
WHERE t.id = nl.trip_id;

COMMIT;
