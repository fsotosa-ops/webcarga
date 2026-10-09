-- 20261010100000_rbac_expand.sql
-- RBAC (spec docs/superpowers/specs/2026-10-09-roles-y-permisos-design.md), etapa expand.
-- Aditiva: nada lee estas tablas hasta el despliegue de la Task 10. La API de
-- `main` sigue leyendo profiles.role, que no se toca hasta la Task 13.
--
-- Los roles de sistema se crean acá (las asignaciones los referencian); su
-- nombre, descripción y composición los mantiene alineados la API al arrancar
-- (app/authz/sync.py), desde el catálogo del código, que es la única fuente.

CREATE TABLE app.permissions (
    code        text PRIMARY KEY,
    area        text NOT NULL,
    description text NOT NULL,
    privileged  boolean NOT NULL DEFAULT false
);

CREATE TABLE app.roles (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code        text NOT NULL UNIQUE,
    name        text NOT NULL,
    description text NOT NULL DEFAULT '',
    is_system   boolean NOT NULL DEFAULT false,
    grants_all  boolean NOT NULL DEFAULT false,
    created_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT grants_all_solo_sistema CHECK (NOT grants_all OR is_system)
);

CREATE TABLE app.role_permissions (
    role_id         uuid NOT NULL REFERENCES app.roles(id) ON DELETE CASCADE,
    permission_code text NOT NULL REFERENCES app.permissions(code) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE app.user_roles (
    user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role_id    uuid NOT NULL REFERENCES app.roles(id) ON DELETE RESTRICT,
    granted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    granted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role_id)
);
CREATE INDEX user_roles_role_idx ON app.user_roles(role_id);

ALTER TABLE app.permissions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.roles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.user_roles       ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.permissions, app.roles, app.role_permissions, app.user_roles FROM anon, authenticated;

INSERT INTO app.roles (code, name, is_system, grants_all) VALUES
  ('owner', 'Propietario (Super admin)', true, true),
  ('admin', 'Administración', true, false),
  ('support', 'Soporte técnico (proveedor)', true, false),
  ('reader', 'Lectura', true, false),
  ('operations_operator', 'Operador de Operaciones', true, false),
  ('operations_supervisor', 'Supervisor de Operaciones', true, false),
  ('certification_operator', 'Operador de Certificación', true, false),
  ('certification_supervisor', 'Supervisor de Certificación', true, false),
  ('insurance_operator', 'Operador de Seguros', true, false),
  ('insurance_supervisor', 'Supervisor de Seguros', true, false),
  ('commercial_operator', 'Operador Comercial', true, false),
  ('commercial_supervisor', 'Supervisor Comercial', true, false);

-- Mapa de la escalera vieja (app/authz/permissions.py::LEGACY_ROLE_MAP).
CREATE TEMP TABLE _legacy (old_role text, new_code text) ON COMMIT DROP;
INSERT INTO _legacy VALUES
  ('owner','owner'),
  ('admin','admin'),('admin','operations_supervisor'),('admin','certification_supervisor'),
  ('admin','insurance_supervisor'),('admin','commercial_supervisor'),
  ('editor','operations_supervisor'),('editor','certification_supervisor'),
  ('editor','insurance_supervisor'),('editor','commercial_supervisor'),
  ('writer','operations_operator'),
  ('viewer','reader');

INSERT INTO app.user_roles (user_id, role_id)
SELECT p.id, r.id
FROM public.profiles p
JOIN _legacy l ON l.old_role = p.role
JOIN app.roles r ON r.code = l.new_code;

ALTER TABLE public.admin_whitelist ADD COLUMN role_codes text[] NOT NULL DEFAULT '{}';
UPDATE public.admin_whitelist w
SET role_codes = ARRAY(SELECT l.new_code FROM _legacy l WHERE l.old_role = w.role ORDER BY l.new_code);

-- handle_new_user: el perfil se crea igual (role queda por compatibilidad hasta
-- la Task 13) y además las asignaciones de la invitación.
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_role text;
  v_codes text[];
BEGIN
  SELECT role, role_codes INTO v_role, v_codes
  FROM public.admin_whitelist WHERE email = lower(NEW.email);
  IF v_role IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.email, v_role);
  INSERT INTO app.user_roles (user_id, role_id)
  SELECT NEW.id, r.id FROM app.roles r WHERE r.code = ANY(v_codes);
  RETURN NEW;
END;
$$;
