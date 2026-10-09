-- Dos brechas abiertas, encontradas en la auditoría de acceso del 09/10.
-- Esta migración SOLO quita permisos; ni la API (se conecta como postgres) ni
-- el frontend (lee su propio perfil, no escribe) dependen de lo que se quita.
--
-- C3 — cualquier cuenta podía hacerse owner. `authenticated` tenía UPDATE
-- sobre public.profiles (incluidas las columnas role y active) y la política
-- `self_update` le dejaba tocar su propia fila: un PATCH a
-- /rest/v1/profiles?id=eq.<su id> con {"role":"owner"} bastaba. Con el
-- registro abierto, eso era cualquier persona con una cuenta de Google. Los
-- cambios de rol y de estado van por PATCH /users/{id} (require_admin), que
-- escribe como postgres.
--
-- C2 — public.compliance_requirement_rules (HU-C1, 20261008110000) nació sin
-- RLS y con todos los permisos para `anon`: con la clave pública que viaja en
-- el JavaScript del frontend se podían leer, crear, cambiar y borrar las
-- reglas de vencimiento sin iniciar sesión. La lee y escribe solo la API.

DROP POLICY IF EXISTS self_update      ON public.profiles;
DROP POLICY IF EXISTS admin_update_all ON public.profiles;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.profiles FROM anon, authenticated;
REVOKE ALL ON public.profiles FROM anon;

ALTER TABLE public.compliance_requirement_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.compliance_requirement_rules FROM anon, authenticated;
