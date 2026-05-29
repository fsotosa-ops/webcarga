-- Permite asignar rol específico por email en la whitelist (no solo 'admin').
-- Preset pablo.abumohor@webcarga.com como owner.

-- 1. Crear tabla si no existe (idempotente para CI; en prod ya existe)
CREATE TABLE IF NOT EXISTS public.admin_whitelist (
  email TEXT PRIMARY KEY
);

-- 2. Agregar columna role con default 'admin' (backward compatible)
ALTER TABLE public.admin_whitelist
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin'
  CHECK (role IN ('viewer', 'writer', 'editor', 'admin', 'owner'));

-- 3. Insertar/actualizar miembros del equipo con sus roles
INSERT INTO public.admin_whitelist (email, role) VALUES
  ('pablo.abumohor@webcarga.com', 'owner'),
  ('felipe@sumadots.com',          'owner')
ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role;

-- 4. Actualizar trigger: leer rol desde la whitelist en vez de hardcodear 'admin'
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT COALESCE(
    (SELECT role FROM public.admin_whitelist WHERE email = NEW.email),
    'viewer'
  ) INTO v_role;

  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.email,
    v_role
  );
  RETURN NEW;
END;
$$;

-- 5. Si pablo ya tiene perfil, actualizar su rol a owner
UPDATE public.profiles
SET role = 'owner'
WHERE email = 'pablo.abumohor@webcarga.com'
  AND role != 'owner';
