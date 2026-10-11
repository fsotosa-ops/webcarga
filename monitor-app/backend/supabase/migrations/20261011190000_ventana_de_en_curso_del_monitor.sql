-- La ventana de "En curso" del Monitor (decisión del usuario 11/10).
--
-- Un viaje activo sale de "En curso" cuando lleva más de in_progress_idle_days
-- días sin movimiento: la llegada o salida más reciente en sus paradas (TMS,
-- GPS o cargada a mano) o, si nunca tuvo, su fecha de planificación. Sigue
-- activo: se ve en el Historial del Monitor y en el Cierre. Reemplaza a la
-- "regla de 15 días" de la minuta 09/10, que el Cierre ya cubre.
--
-- Por qué "sin movimiento" y no la antigüedad del viaje: un viaje largo (a
-- regiones) puede durar varios días y sigue moviéndose. Medido el 11/10: los
-- Walmart de 2-3 días en RETORNANDO tenían un evento GPS de hace horas; los
-- Sodimac pegados en "Control de salida" (hasta 12 días) no tenían ninguno.
-- Tampoco el último reporte del TMS: el portal de Sodimac lo renueva aunque el
-- viaje esté cerrado.
--
-- Distinto de stale_trip_days, que dice cuándo un viaje entregado sin cierre
-- del TMS sale del Cierre: son dos preguntas, dos números.
ALTER TABLE app.monitor_alert_rules
    ADD COLUMN IF NOT EXISTS in_progress_idle_days integer NOT NULL DEFAULT 3
    CHECK (in_progress_idle_days > 0);

COMMENT ON COLUMN app.monitor_alert_rules.in_progress_idle_days IS
    'Días sin movimiento tras los cuales un viaje activo sale de "En curso" del Monitor.';
