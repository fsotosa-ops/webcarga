-- HU-C1, entrega 2 (F0): "hoy" es el día calendario de Chile, en UN lugar.
--
-- La base corre con TimeZone = UTC (medido el 07/10) y la API no lo fija en
-- la conexión (app/db.py). CURRENT_DATE es entonces el día UTC: desde las
-- 21:00 de Chile ya es "mañana", y un documento que vence hoy figura vencido
-- tres horas antes. Con cortes por día (F30 el 5, F30-1 el 18) se vuelve
-- visible. now() es un instante absoluto, así que la conversión no depende
-- del TimeZone de la sesión.
--
-- STABLE: dentro de una sentencia devuelve siempre lo mismo, como now().

CREATE OR REPLACE FUNCTION public.hoy_chile()
RETURNS date
LANGUAGE sql
STABLE
AS $$
  SELECT (now() AT TIME ZONE 'America/Santiago')::date
$$;

COMMENT ON FUNCTION public.hoy_chile() IS
  'Día calendario de Chile. Única definición de "hoy" para vencimientos (app/services/vencimientos.py).';
