-- La politica de vencimiento de un requisito, con TRES estados nombrados.
--
-- `has_expiration` era un booleano cargando tres significados, y por eso
-- classify-batch trataba "tiene vencimiento" como "el vencimiento es
-- obligatorio": 19 de 35 requisitos activos rechazaban la carga con 422 sin
-- que la pantalla pidiera nunca la fecha. Peor, el camino de carga subia el
-- archivo ANTES de clasificar, asi que cada rechazo dejaba el documento
-- varado en la bandeja y el requisito vacio. Septima aparicion en este modulo
-- de un valor con doble sentido.
--
-- El backfill es DELIBERADAMENTE conservador: true -> REQUIRED preserva
-- exactamente el comportamiento actual. Nadie queda mas exigente ni menos
-- exigente que ayer. Mover un requisito a OPTIONAL es una decision de negocio
-- y se toma desde Configuracion, no desde una migracion.
--
-- Alcanza a TODAS las filas, activas o no: una regla apagada hoy tiene que
-- llegar con su politica bien puesta el dia que negocio la encienda.
ALTER TABLE public.compliance_requirements
  ADD COLUMN expiration_policy TEXT;

UPDATE public.compliance_requirements
SET expiration_policy = CASE WHEN COALESCE(has_expiration, false)
                             THEN 'REQUIRED' ELSE 'NONE' END;

ALTER TABLE public.compliance_requirements
  ALTER COLUMN expiration_policy SET NOT NULL,
  ADD CONSTRAINT compliance_requirements_expiration_policy_check
    CHECK (expiration_policy IN ('REQUIRED','OPTIONAL','NONE'));

COMMENT ON COLUMN public.compliance_requirements.expiration_policy IS
  'REQUIRED: sin fecha el documento no se acepta. OPTIONAL: se acepta y la fecha queda pendiente. NONE: el documento no vence. has_expiration se conserva porque tiene lectores vivos (carriers, drivers, assets, document_ingest); la fuente de verdad es esta columna.';
