-- HU-C1, 7a: has_expiration pasa a ser una columna GENERADA desde expiration_policy.
--
-- Es el paso "expand/contract" antes de retirarla (7b, DROP COLUMN):
--   - la API ya no la lee desde 5ae76d43; expiration_policy es la única fuente;
--   - una revisión de la API anterior a 5ae76d43, si vuelve por rollback, todavía la
--     lee. Con esta columna sigue funcionando, en vez de dar 500;
--   - como columna común se desincronizaba: Configuración edita sólo la política,
--     y el F30-1 (01/10/2026) quedó con las dos en desacuerdo. Generada, Postgres
--     rechaza cualquier escritura directa y el valor lo deriva siempre la política.
--
-- Regla: "lleva fecha" = la política no es NONE (lleva_fecha() en
-- app/services/vencimientos.py). Con los datos al 07/10 da los mismos 21 true / 17
-- false que ya tenía la columna.
--
-- Postgres no convierte una columna común en generada: se borra y se vuelve a
-- crear con el mismo nombre y tipo. Las dos sentencias van en esta misma
-- transacción, así que ningún lector la ve faltar. 0 dependencias en pg_depend
-- (vistas, funciones, policies) verificadas el 07/10.

ALTER TABLE public.compliance_requirements DROP COLUMN has_expiration;

ALTER TABLE public.compliance_requirements
  ADD COLUMN has_expiration boolean
  GENERATED ALWAYS AS (expiration_policy <> 'NONE') STORED;

COMMENT ON COLUMN public.compliance_requirements.has_expiration IS
  'DERIVADA de expiration_policy (<> NONE); no se escribe. Se conserva sólo para que un rollback de la API anterior a HU-C1 no falle; se retira en la HU-C1 7b.';
