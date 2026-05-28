-- Fix: handle_new_user assigned 'operador' which violates profiles_role_check constraint.
-- Valid roles: viewer, writer, editor, admin, owner. New non-whitelisted users now get 'viewer'.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public.admin_whitelist WHERE email = NEW.email
  ) THEN 'admin' ELSE 'viewer' END INTO v_role;

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
