-- country_code en public.locations — mismo patrón ya usado en
-- public.carriers para el mismo escenario ("¿qué pasa si la empresa se
-- internacionaliza?"): no normaliza region_name/region_number en sí (siguen
-- siendo texto libre tal cual viene de la planilla, sin librería de
-- geografía — no hay evidencia real de un segundo país hoy), solo evita que
-- datos de regiones de dos países se mezclen sin distinción el día que haga
-- falta. Todo lo cargado hasta ahora es de Chile.
ALTER TABLE public.locations ADD COLUMN country_code text NOT NULL DEFAULT 'CL';
