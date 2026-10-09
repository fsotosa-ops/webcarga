-- Acceso solo por invitación y mínimo privilegio en `public` (auditoría 09/10).
--
-- Pablo, llamada del 09/10: "Hoy día cualquier persona puede entrar a la
-- plataforma y ver todo... el administrador o alguien crea la cuenta... y el
-- que entra, el que nosotros le damos acceso, se acabó."
--
-- Antes: handle_new_user le daba `viewer` a toda cuenta nueva que no estuviera
-- en admin_whitelist (2 filas, ambas owner), así que cualquier cuenta de Google
-- o Microsoft entraba como lectora. Además, con la clave pública del frontend y
-- una sesión, PostgREST dejaba leer 24 tablas de `public`, escribir `locations`
-- y `location_rates`, y ejecutar 26 funciones (algunas escriben).
--
-- 1. admin_whitelist pasa a ser LA lista de invitaciones (quién puede entrar y
--    con qué rol). La escribe POST /users (require_admin). Se siembra con las
--    cuentas que ya existen, para que nadie quede afuera: WebCarga las revisa y
--    desactiva las que no correspondan desde Configuración › Personas y accesos.
-- 2. Hook before_user_created: Supabase Auth lo llama ANTES de crear cualquier
--    cuenta (Google, Microsoft o email) y rechaza la que no está invitada. Se
--    ACTIVA en el panel de Supabase (Authentication › Hooks); esta migración
--    solo crea la función y sus permisos.
-- 3. handle_new_user ya no crea perfil sin invitación (la API y el layout
--    niegan el acceso a una cuenta sin perfil).
-- 4. `anon` y `authenticated` dejan de tener permisos en `public`, salvo leer
--    su propio perfil (lo único que el frontend lee directo) y `is_admin`, que
--    usan las políticas de profiles. La API se conecta como postgres. Los
--    permisos por defecto se cierran para que una tabla nueva no nazca
--    expuesta (así nació compliance_requirement_rules el 08/10).

-- 1. Invitaciones ---------------------------------------------------------------
ALTER TABLE public.admin_whitelist
    ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS invited_at timestamptz NOT NULL DEFAULT now();

UPDATE public.admin_whitelist SET email = lower(email) WHERE email <> lower(email);

INSERT INTO public.admin_whitelist (email, role)
SELECT lower(p.email), p.role
FROM public.profiles p
WHERE p.email IS NOT NULL AND p.role IS NOT NULL
ON CONFLICT (email) DO NOTHING;

-- 2. Hook de Supabase Auth -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.before_user_created_hook(event jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
    SELECT CASE
        WHEN EXISTS (
            SELECT 1 FROM public.admin_whitelist w
            WHERE w.email = lower(event->'user'->>'email')
        ) THEN '{}'::jsonb
        ELSE jsonb_build_object('error', jsonb_build_object(
            'http_code', 403,
            'message', 'Tu cuenta no tiene acceso a WebCarga. Pide a un administrador que te invite.'))
    END
$$;

REVOKE ALL ON FUNCTION public.before_user_created_hook(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.before_user_created_hook(jsonb) TO supabase_auth_admin;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT SELECT ON public.admin_whitelist TO supabase_auth_admin;
DROP POLICY IF EXISTS auth_reads_invitations ON public.admin_whitelist;
CREATE POLICY auth_reads_invitations ON public.admin_whitelist
    FOR SELECT TO supabase_auth_admin USING (true);

-- 3. Sin invitación no hay perfil ----------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.admin_whitelist WHERE email = lower(NEW.email);
  IF v_role IS NULL THEN
    RETURN NEW;  -- el hook ya la rechaza; si igual llega, queda sin acceso
  END IF;
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.email, v_role);
  RETURN NEW;
END;
$$;

-- 4. Mínimo privilegio en public -----------------------------------------------
DROP POLICY IF EXISTS locations_write      ON public.locations;
DROP POLICY IF EXISTS location_rates_write ON public.location_rates;
DO $$
DECLARE p record;
BEGIN
  -- las políticas FOR ALL USING (true) de locations y location_rates, se llamen como se llamen
  FOR p IN SELECT schemaname, tablename, policyname FROM pg_policies
           WHERE schemaname = 'public' AND tablename IN ('locations', 'location_rates')
             AND cmd = 'ALL' AND qual = 'true'
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;
END $$;

REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.profiles TO authenticated;          -- su propia fila (política self_select)
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;  -- la evalúan las políticas de profiles
GRANT EXECUTE ON FUNCTION public.before_user_created_hook(jsonb) TO supabase_auth_admin;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;
