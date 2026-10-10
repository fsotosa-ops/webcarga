-- RBAC, etapa contract (spec 2026-10-09 §9, Task 13): se retira la escalera
-- vieja (profiles.role, admin_whitelist.role). Los permisos viven en
-- app.user_roles / app.role_permissions desde la etapa expand.
--
-- Decisión del usuario (09/10): "solo aplica dev de momento, no tomes en cuenta
-- main". La API de `main` (webcarga-monitor-api-prod, 01/08, sin requests en
-- 30 días) lee profiles.role: queda rota hasta que se despliegue `main`.
--
-- Reversible: los valores viejos quedan en app.rbac_legacy_roles.

-- 1. Respaldo de la escalera vieja.
CREATE TABLE app.rbac_legacy_roles AS
  SELECT 'profile'::text AS fuente, id::text AS referencia, email, role, now() AS respaldado_el
    FROM public.profiles
  UNION ALL
  SELECT 'invitation', email, email, role, now()
    FROM public.admin_whitelist;
REVOKE ALL ON app.rbac_legacy_roles FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE app.rbac_legacy_roles IS
  'Respaldo de profiles.role y admin_whitelist.role antes del contract RBAC (2026-10-10).';

-- 2. Alta desde la invitación, sin `role`.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_codes text[];
BEGIN
  SELECT role_codes INTO v_codes FROM public.admin_whitelist WHERE email = lower(NEW.email);
  IF v_codes IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.profiles (id, full_name, email) VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.email);
  INSERT INTO app.user_roles (user_id, role_id) SELECT NEW.id, r.id FROM app.roles r WHERE r.code = ANY(v_codes);
  RETURN NEW;
END;
$function$;

-- 3. is_admin() (políticas profiles:admin_select_all y
--    admin_whitelist:admin_manage_whitelist) sobre los roles nuevos: administra
--    quien puede gestionar personas.
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM app.user_roles ur
      JOIN app.roles r ON r.id = ur.role_id
      JOIN public.profiles p ON p.id = ur.user_id AND p.active IS NOT FALSE
      LEFT JOIN app.role_permissions rp ON rp.role_id = r.id
     WHERE ur.user_id = (SELECT auth.uid())
       AND (r.grants_all OR rp.permission_code = 'users.manage')
  );
$function$;

-- 4. audit_log_write dependía de app.current_user_role() (profiles.role). Sin
--    permiso de tabla para authenticated sobre audit_log (endurecimiento del
--    09/10) la política no alcanzaba a nadie: la escribe solo la API, como
--    postgres. Se retiran las dos.
DROP POLICY IF EXISTS audit_log_write ON public.audit_log;
DROP FUNCTION app.current_user_role();

-- 5. Las columnas.
ALTER TABLE public.admin_whitelist DROP COLUMN role;
ALTER TABLE public.profiles DROP COLUMN role;
