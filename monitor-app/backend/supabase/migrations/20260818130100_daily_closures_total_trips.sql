-- Cuantos viajes tenia el dia CUANDO SE FIRMO.
--
-- El dia no se reabre nunca: una firma es una afirmacion sobre un instante, y
-- si se recalcula no afirma nada (mismo principio que la Ronda 122 aplico al
-- modelo de flota). Lo que aparece despues es un DELTA -- "posterior al
-- cierre", el termino contable estandar (post-close entries); en ingenieria de
-- datos es un late-arriving fact. No es una reapertura.
--
-- Nullable a proposito: los cierres viejos no lo tienen y no se puede inventar.
-- Un 0 ahi diria "el dia no tenia viajes", que es falso.
ALTER TABLE app.daily_closures ADD COLUMN IF NOT EXISTS total_trips integer;

COMMENT ON COLUMN app.daily_closures.total_trips IS
  'Viajes del dia al momento de firmar. NULL = cierre anterior a 2026-08-18. '
  'Si el conteo real difiere despues, son viajes posteriores al cierre: la '
  'firma NO se invalida, se resuelve un complemento.';
