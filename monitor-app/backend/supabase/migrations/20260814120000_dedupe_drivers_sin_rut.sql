-- ==============================================================================
-- Limpieza: conductores duplicados sin tax_id + sus compliance_records fantasma
-- ==============================================================================
--
-- CAUSA RAÍZ (fuera de esta migración, vive en Mage):
--   custom/load_drivers_03.sql, pipeline `legacy_drivers_transporters`.
--   El WHERE que descarta RUTs vacíos está COMENTADO:
--
--       FROM bronze.raw_centralizer_drivers
--       --WHERE rut_conductor IS NOT NULL
--       --  AND LOWER(TRIM(rut_conductor)) != 'nan'
--       --  AND TRIM(rut_conductor) != ''
--       ON CONFLICT (tax_id) DO UPDATE SET ...
--
--   Hay 1 fila en bronze con nombre pero sin rut_conductor. Para esa fila
--   `tax_id = NULL || '-' || dv` evalúa a NULL, y `ON CONFLICT (tax_id)` no
--   dispara con NULL (Postgres trata cada NULL como distinto en un índice
--   único). Resultado: cada corrida del pipeline inserta una fila nueva.
--   68 filas acumuladas entre 2026-07-16 y 2026-08-14, ~2-3 por día.
--
--   `load_compliance_records_08` cuelga de `load_drivers_03`, así que cada
--   driver fantasma arrastró sus 12 requisitos → 816 compliance_records.
--
-- ⚠ ORDEN DE APLICACIÓN: descomentar el WHERE en Mage ANTES de aplicar esta
--   migración. El índice único del paso 3 hace que el INSERT falle en vez de
--   duplicar — si el pipeline todavía tiene el bug, se rompería en cada corrida.
--
-- SEGURIDAD verificada contra la base viva antes de escribir esto: las 68 filas
-- no tienen NINGUNA referencia — 0 en public.driver_assignments, 0 en
-- app.driver_day_status, 0 en public.vehicle_driver_assignments, 0 en
-- app.trip_fleet_links, 0 en public.audit_log.
--
-- NOTA: el conductor tampoco tiene RUT en bronze, así que su tax_id NO se puede
-- completar automáticamente. Queda 1 fila con tax_id NULL para que alguien la
-- complete a mano desde la app.
-- ==============================================================================

BEGIN;

-- ── 1. Conservar la fila más antigua, identificar las sobrantes ──────────────
CREATE TEMP TABLE drivers_a_borrar ON COMMIT DROP AS
SELECT id
FROM (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY lower(trim(full_name))
               ORDER BY created_at, id
           ) AS rn
    FROM public.drivers
    WHERE tax_id IS NULL
) t
WHERE rn > 1;

-- ── 2. Borrar sus compliance_records ────────────────────────────────────────
-- compliance_records.entity_id es polimórfico (sin FK), hay que borrarlos a
-- mano. Un solo DELETE: trg_refresh_view_on_compliance hace REFRESH
-- MATERIALIZED VIEW CONCURRENTLY por statement, no por fila.
DELETE FROM public.compliance_records
WHERE entity_type = 'DRIVER'
  AND entity_id IN (SELECT id FROM drivers_a_borrar);

-- ── 3. Borrar los duplicados ────────────────────────────────────────────────
DELETE FROM public.drivers
WHERE id IN (SELECT id FROM drivers_a_borrar);

-- ── 4. Red de seguridad: impedir que vuelva a pasar ─────────────────────────
-- Índice único parcial sobre el nombre normalizado, solo cuando falta el RUT.
-- Con el WHERE de Mage restaurado nunca se dispara; si alguien lo vuelve a
-- comentar, el pipeline falla ruidosamente en vez de acumular basura en
-- silencio durante semanas.
CREATE UNIQUE INDEX IF NOT EXISTS idx_drivers_sin_rut_nombre_unico
    ON public.drivers (lower(trim(full_name)))
    WHERE tax_id IS NULL;

COMMIT;
