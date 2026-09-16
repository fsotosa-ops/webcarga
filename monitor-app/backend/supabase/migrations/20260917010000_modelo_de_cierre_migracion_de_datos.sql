-- Modelo de cierre, ola 2: lo ya escrito pasa a períodos y líneas
--
-- Diseño: docs/superpowers/specs/2026-09-14-modelo-de-cierre-design.md.
--
-- Copia sin reinterpretar:
--   daily_closures + equipment_closures      → app.closure_periods
--   driver_day_status + equipment_day_status → app.closure_lines
--
-- Un día queda CLOSED si está firmado en daily_closures. Ésa es la firma que
-- el frontend pedía primero y la única que existía para todos los días
-- firmados: al 16/09, equipment_closures tiene un día menos (el 03-09). Las
-- cifras de las dos cabeceras van juntas a `frozen_totals`.
--
-- Los motivos, comentarios y autores se conservan tal cual: cambian de fila,
-- no de significado. Nada se borra de las tablas viejas; siguen escribiéndose
-- como proyección de las líneas hasta la ola 5.
--
-- Re-ejecutable, y a propósito: se corre antes de desplegar el backend que lee
-- las líneas, y otra vez apenas termina el despliegue. Entre las dos corridas el
-- backend viejo sigue escribiendo en las tablas viejas; la segunda corrida trae
-- lo que una persona haya escrito en ese intervalo. Nunca pisa una edición más
-- nueva hecha ya sobre las líneas (compara `resolved_at`), ni reabre un día.
--
-- Decisión del usuario (16/09): "lo que manda es lo que viene haciendo
-- operaciones en la app". Por eso NO se recalculan los 9 días ya firmados con
-- la regla nueva: cambiaría ~50 líneas firmadas y perdería 4 motivos. Un día
-- que haya que corregir se reabre, con nota, y se recalcula ese día solo.

INSERT INTO app.closure_periods
    (business_date, status, closed_by, closed_at, override_count, frozen_totals)
SELECT
    d.business_date,
    CASE WHEN dc.business_date IS NOT NULL THEN 'CLOSED' ELSE 'OPEN' END,
    dc.closed_by,
    dc.closed_at,
    COALESCE(dc.override_count, 0) + COALESCE(ec.override_count, 0),
    CASE WHEN dc.business_date IS NOT NULL THEN jsonb_build_object(
        'conductores', dc.total_drivers,
        'conductores_resueltos', dc.resolved_count,
        'tractos', ec.total_equipment,
        'tractos_resueltos', ec.resolved_count,
        'viajes', dc.total_trips
    ) END
FROM (
    SELECT business_date FROM app.driver_day_status
    UNION SELECT business_date FROM app.equipment_day_status
    UNION SELECT business_date FROM app.daily_closures
    UNION SELECT business_date FROM app.equipment_closures
) d
LEFT JOIN app.daily_closures dc ON dc.business_date = d.business_date
LEFT JOIN app.equipment_closures ec ON ec.business_date = d.business_date
ON CONFLICT (business_date) DO UPDATE SET
    -- Una firma hecha con el backend viejo entre las dos corridas. Un período
    -- reabierto a propósito (reopened_at) no se vuelve a cerrar solo.
    status = 'CLOSED', closed_by = EXCLUDED.closed_by, closed_at = EXCLUDED.closed_at,
    override_count = EXCLUDED.override_count, frozen_totals = EXCLUDED.frozen_totals,
    updated_at = now()
WHERE EXCLUDED.status = 'CLOSED'
  AND app.closure_periods.status = 'OPEN'
  AND app.closure_periods.reopened_at IS NULL;

INSERT INTO app.closure_lines
    (business_date, subject_type, subject_id, status, requires_reason,
     reason_id, comentario, resolved_by, resolved_at, computed_at)
SELECT business_date, 'DRIVER', driver_id, status, true,
       unassigned_reason_id, comentario, resolved_by, resolved_at, computed_at
FROM app.driver_day_status
UNION ALL
SELECT business_date, 'ASSET', asset_id, status, requires_motivo,
       unassigned_reason_id, comentario, resolved_by, resolved_at, computed_at
FROM app.equipment_day_status
ON CONFLICT (business_date, subject_type, subject_id) DO UPDATE SET
    status = EXCLUDED.status, reason_id = EXCLUDED.reason_id, comentario = EXCLUDED.comentario,
    resolved_by = EXCLUDED.resolved_by, resolved_at = EXCLUDED.resolved_at
-- Sólo si la fila vieja trae una edición humana más nueva que la de la línea.
WHERE EXCLUDED.resolved_at IS NOT NULL
  AND (app.closure_lines.resolved_at IS NULL OR EXCLUDED.resolved_at > app.closure_lines.resolved_at)
  -- Un día ya firmado en el modelo nuevo no se toca.
  AND NOT EXISTS (
      SELECT 1 FROM app.closure_periods p
      WHERE p.business_date = app.closure_lines.business_date AND p.status = 'CLOSED'
        AND p.closed_at > EXCLUDED.resolved_at
  );
