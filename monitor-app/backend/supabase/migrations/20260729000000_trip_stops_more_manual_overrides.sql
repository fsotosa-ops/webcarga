-- Bitácora: generaliza el mecanismo de override manual ya existente para
-- desc_inicio_manual/desc_fin_manual a los 4 campos que la hoja de cálculo
-- "campos-seguimiento-viajes" documenta como editables por el equipo de
-- operaciones para algunas TMS (Sodimac nunca reporta GPS/TR; QAnalytics
-- IANSA depende del payload). Mismo patrón COALESCE(manual, valor_tms),
-- editable siempre que la TMS no traiga el dato — no condicionado por
-- nombre de TMS en código (decisión explícita del usuario).
ALTER TABLE app.trip_stops
  ADD COLUMN arrival_date_manual       timestamptz,
  ADD COLUMN departure_date_manual     timestamptz,
  ADD COLUMN gps_arrival_date_manual   timestamptz,
  ADD COLUMN gps_departure_date_manual timestamptz;
