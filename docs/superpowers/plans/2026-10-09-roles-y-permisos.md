# Roles y permisos (RBAC) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar la escalera de 5 roles globales (`viewer<writer<editor<admin<owner`) por RBAC de NIST: permisos definidos en código, roles y asignaciones como datos, `require(Permission.X)` en cada ruta y `can()` en el frontend.

**Architecture:** Catálogo único en `backend/api/app/authz/` (permisos + roles de sistema). Tablas `app.permissions/roles/role_permissions/user_roles`; la API sincroniza catálogo y roles de sistema al arrancar y calcula los permisos efectivos en `get_current_user` (caché 60 s). Una dependencia `require(...)` reemplaza a `require_writer/editor/admin`, que se eliminan. El frontend recibe `GET /me` y consulta permisos con `can()`.

**Tech Stack:** FastAPI + asyncpg (Python 3.11, venv `monitor-app/backend/api/venv`), Postgres/Supabase (migraciones por MCP `apply_migration`), Next.js 16 + React + vitest, Playwright para verificación.

**Spec:** `docs/superpowers/specs/2026-10-09-roles-y-permisos-design.md` (aprobada 09/10).

## Global Constraints

- Identificadores de base y rutas en **inglés**; textos de UI en **español neutral, nunca voseo** (`lib/copy/espanol-neutral.test.ts`).
- Cero emojis en la UI; solo `lucide-react`. Sin color crudo nuevo ni tamaños < 11 px (trinquetes `lib/ui/sistema.test.ts`, `lib/ui/escala.test.ts`): usar `text-informativo`, `text-accent`, `text-status-incidente`, `border-border`, `bg-bg-main`.
- Tablas nuevas: esquema `app`, RLS habilitada, **sin** GRANT a `anon`/`authenticated` (la API se conecta como `postgres`).
- Migraciones: ensayo con `BEGIN … ROLLBACK` por MCP `execute_sql` antes de `apply_migration`; aplicar entre corridas de ingesta.
- Sin alias ni convivencia: `require_writer`, `require_editor`, `require_admin`, `EDITOR_ROLES`, `ADMIN_ROLES`, `WRITER_ROLES`, `ROLE_ORDER`, `hasRole`, `canManage`, `useRolMinimo`, `useCanEdit`, `useCanAdmin` desaparecen al final del plan.
- Migración: **nadie pierde** un permiso; la única ganancia aprobada es `*.configure` para los Supervisores (los `editor` actuales).
- `profiles.role` y `admin_whitelist.role` se mantienen hasta la Task 13 (compuerta: la API de `main` lee `profiles.role`).
- Tests de backend: `cd monitor-app/backend/api && venv/bin/python -m pytest …`; frontend: `cd monitor-app/frontend && npx vitest run …`, más `npx tsc --noEmit` y `npm run build`.
- Commits con `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`; push a `dev` cuando la suite esté verde.

## Review Focus

1. **Persona sin ningún rol** (invitación vieja, rol borrado): debe recibir 403 claro en la API y la pantalla "No tienes acceso", nunca un dashboard vacío ni un 500. → test en Task 3.
2. **Último Propietario**: quitarse el rol, borrarse o desactivarse siendo el único Propietario debe responder 409 con el motivo, también en carrera (dos admins a la vez). → test en Task 9 con `SELECT … FOR UPDATE`.
3. **Rol personalizado que se queda sin permisos** por retirar un permiso del código: la API no debe fallar al arrancar; el permiso huérfano se informa y el test de integridad falla en CI. → test en Task 2.
4. **Cambio de roles con caché**: al quitarle un rol a alguien, su próximo request (< 60 s) ya no debe tener el permiso. → test en Task 3 (invalidación).
5. **PATCH mixto de campos** (básico + sensible) por un Operador: rechazo completo con la lista de campos, sin aplicar los básicos. → test en Task 4.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `backend/api/app/authz/__init__.py` | Reexporta `Permission`, `require`, `require_fields`. |
| `backend/api/app/authz/permissions.py` | **Catálogo**: `Permission` (enum), `PERMISSION_META`, `SystemRole` y `SYSTEM_ROLES` (composición). Sin I/O. |
| `backend/api/app/authz/effective.py` | Consulta de permisos efectivos de una persona; invalidación de caché. |
| `backend/api/app/authz/deps.py` | `require(*permissions)` (FastAPI) y `require_fields(user, sent, field_map)`. |
| `backend/api/app/authz/sync.py` | Sincronización al arrancar: `app.permissions`, roles de sistema y su composición. |
| `backend/api/app/services/access_admin.py` | Reglas de administración: escalada, último Propietario, roles de sistema inmutables. |
| `backend/api/app/routers/access.py` | `GET /me`, `GET /permissions`, `GET/POST/PATCH/DELETE /roles`, `PUT /users/{id}/roles`. |
| `backend/api/app/auth.py` | `get_current_user` devuelve `permissions`; se retiran los guardias viejos (Task 11). |
| `backend/api/app/routers/*.py` | Cada ruta declara `require(Permission.X)` (Tasks 5-8). |
| `backend/supabase/migrations/20261010100000_rbac_expand.sql` | Tablas, roles de sistema, backfill de asignaciones e invitaciones. |
| `backend/supabase/migrations/2026101XXXXXXX_rbac_contract.sql` | `DROP profiles.role`, `admin_whitelist.role` (Task 13, con compuerta). |
| `backend/api/scripts/generar_permisos_ts.py` | Genera `frontend/lib/authz/permisos.generated.ts` desde el catálogo. |
| `frontend/lib/authz/permisos.generated.ts` | Códigos de permiso para TypeScript (generado). |
| `frontend/lib/authz/acceso.ts` | Tipo `Acceso` (`GET /me`), `obtenerAccesoServidor()` para server components. |
| `frontend/lib/authz/PermisosProvider.tsx` | Contexto + `usePermiso(p)` / `useAcceso()`. |
| `frontend/app/dashboard/admin/settings/...` | Personas (chips de roles) y Roles (Task 12). |

---

### Task 1: Catálogo de permisos y roles de sistema

**Files:**
- Create: `monitor-app/backend/api/app/authz/__init__.py`, `monitor-app/backend/api/app/authz/permissions.py`
- Test: `monitor-app/backend/api/tests/test_authz_catalogo.py`

**Interfaces:**
- Produces: `Permission` (enum `str`), `PERMISSION_META: dict[Permission, PermissionMeta]` con `area`, `description`, `privileged`; `SystemRole` (dataclass `code, name, description, permissions: frozenset[Permission], grants_all: bool`); `SYSTEM_ROLES: tuple[SystemRole, ...]`; `READ_ALL: frozenset[Permission]`; `LEGACY_ROLE_MAP: dict[str, tuple[str, ...]]` (rol viejo → códigos de rol nuevos); `legacy_role_for(role_codes) -> str` (rol equivalente de la escalera vieja, solo para la transición: lo usan `get_current_user` hasta la Task 11 y la invitación hasta la Task 13).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_authz_catalogo.py
"""El catálogo de permisos y roles de sistema (RBAC, spec 2026-10-09).

Una sola definición: estos datos alimentan la migración, la sincronización al
arrancar, los guardias de las rutas y el archivo de TypeScript del frontend.
"""
from app.authz.permissions import (
    LEGACY_ROLE_MAP, PERMISSION_META, READ_ALL, SYSTEM_ROLES, Permission, legacy_role_for,
)

CODIGOS = {r.code for r in SYSTEM_ROLES}


def test_todo_permiso_tiene_metadatos():
    assert set(PERMISSION_META) == set(Permission)
    for p, meta in PERMISSION_META.items():
        assert meta.area in {"operations", "directory", "certification", "insurance",
                             "commercial", "admin", "reference"}, p
        assert meta.description.strip(), p


def test_los_codigos_siguen_area_punto_accion():
    for p in Permission:
        area, _, accion = p.value.partition(".")
        assert area and accion and p.value == p.value.lower(), p


def test_roles_de_sistema_esperados():
    assert CODIGOS == {
        "owner", "admin", "support", "reader",
        "operations_operator", "operations_supervisor",
        "certification_operator", "certification_supervisor",
        "insurance_operator", "insurance_supervisor",
        "commercial_operator", "commercial_supervisor",
    }


def test_solo_el_propietario_tiene_todo():
    assert [r.code for r in SYSTEM_ROLES if r.grants_all] == ["owner"]
    assert next(r for r in SYSTEM_ROLES if r.code == "owner").permissions == frozenset()


def test_todo_rol_no_propietario_lee_todas_las_areas():
    for r in SYSTEM_ROLES:
        if not r.grants_all:
            assert READ_ALL <= r.permissions, r.code


def test_el_supervisor_incluye_al_operador():
    for area in ("operations", "certification", "insurance", "commercial"):
        op = next(r for r in SYSTEM_ROLES if r.code == f"{area}_operator")
        sup = next(r for r in SYSTEM_ROLES if r.code == f"{area}_supervisor")
        assert op.permissions <= sup.permissions, area


def test_firma_y_borrado_de_viajes_en_el_operador():
    # Hoy writer firma, reabre y elimina viajes manuales (require_writer): nadie pierde.
    op = next(r for r in SYSTEM_ROLES if r.code == "operations_operator")
    assert {Permission.CLOSURES_SIGN, Permission.TRIPS_DELETE} <= op.permissions


def test_privilegiados_son_los_de_administracion():
    priv = {p for p, m in PERMISSION_META.items() if m.privileged}
    assert priv == {Permission.USERS_MANAGE, Permission.ROLES_MANAGE, Permission.SETTINGS_MANAGE}


def test_mapa_de_roles_viejos():
    assert LEGACY_ROLE_MAP == {
        "owner": ("owner",),
        "admin": ("admin", "operations_supervisor", "certification_supervisor",
                  "insurance_supervisor", "commercial_supervisor"),
        "editor": ("operations_supervisor", "certification_supervisor",
                   "insurance_supervisor", "commercial_supervisor"),
        "writer": ("operations_operator",),
        "viewer": ("reader",),
    }
    for nuevos in LEGACY_ROLE_MAP.values():
        assert set(nuevos) <= CODIGOS


def test_legacy_role_for_es_la_inversa_del_mapa():
    for viejo, nuevos in LEGACY_ROLE_MAP.items():
        assert legacy_role_for(list(nuevos)) == viejo
    assert legacy_role_for(["certification_operator"]) == "writer"
    assert legacy_role_for([]) == "viewer"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv/bin/python -m pytest tests/test_authz_catalogo.py -q -p no:cacheprovider`
Expected: FAIL con `ModuleNotFoundError: No module named 'app.authz'`.

- [ ] **Step 3: Write the implementation**

```python
# app/authz/permissions.py
"""Catálogo de permisos y roles de sistema (RBAC de NIST, spec 2026-10-09).

ÚNICA definición. La consumen:
  - la sincronización al arrancar (app/authz/sync.py) → app.permissions,
    roles de sistema y su composición;
  - los guardias de cada ruta (require(Permission.X));
  - el archivo de TypeScript del frontend (scripts/generar_permisos_ts.py).

Un permiso es "área.acción". `privileged` exige sesión aal2 (verificación en
dos pasos). Los roles de sistema no se editan desde la API: cambian acá, con
revisión y tests.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Permission(str, Enum):
    # Operaciones
    OPERATIONS_READ = "operations.read"
    TRIPS_EDIT_BASIC = "trips.edit_basic"
    TRIPS_EDIT_SENSITIVE = "trips.edit_sensitive"
    TRIPS_CREATE = "trips.create"
    TRIPS_DELETE = "trips.delete"
    CLOSURES_DECLARE = "closures.declare"
    CLOSURES_SIGN = "closures.sign"
    OPERATIONS_CONFIGURE = "operations.configure"
    # Directorio
    DIRECTORY_READ = "directory.read"
    DIRECTORY_EDIT = "directory.edit"
    DIRECTORY_DELETE = "directory.delete"
    # Certificación
    CERTIFICATION_READ = "certification.read"
    DOCUMENTS_UPLOAD = "documents.upload"
    DOCUMENTS_REVIEW = "documents.review"
    CERTIFICATION_CONFIGURE = "certification.configure"
    # Seguros
    INSURANCE_READ = "insurance.read"
    POLICIES_EDIT = "policies.edit"
    POLICIES_DELETE = "policies.delete"
    INSURANCE_CONFIGURE = "insurance.configure"
    # Comercial
    COMMERCIAL_READ = "commercial.read"
    COMMERCIAL_EDIT = "commercial.edit"
    # Datos de referencia que usan todas las pantallas (estados, umbrales,
    # temperaturas, taxonomías, búsqueda de ajustes)
    REFERENCE_READ = "reference.read"
    # Administración
    USERS_MANAGE = "users.manage"
    ROLES_MANAGE = "roles.manage"
    SETTINGS_MANAGE = "settings.manage"


@dataclass(frozen=True)
class PermissionMeta:
    area: str
    description: str
    privileged: bool = False


P = Permission
PERMISSION_META: dict[Permission, PermissionMeta] = {
    P.OPERATIONS_READ: PermissionMeta("operations", "Ver viajes, el Monitor y el cierre del día"),
    P.TRIPS_EDIT_BASIC: PermissionMeta("operations", "Editar los campos básicos de un viaje, sus paradas y notas"),
    P.TRIPS_EDIT_SENSITIVE: PermissionMeta("operations", "Editar patente, conductor, empresa y vínculo de flota de un viaje"),
    P.TRIPS_CREATE: PermissionMeta("operations", "Crear viajes manuales y cargarlos en lote"),
    P.TRIPS_DELETE: PermissionMeta("operations", "Eliminar viajes manuales"),
    P.CLOSURES_DECLARE: PermissionMeta("operations", "Declarar motivos en el cierre del día"),
    P.CLOSURES_SIGN: PermissionMeta("operations", "Firmar y reabrir el cierre del día"),
    P.OPERATIONS_CONFIGURE: PermissionMeta("operations", "Configurar estados, umbrales, temperaturas, alertas y motivos"),
    P.DIRECTORY_READ: PermissionMeta("directory", "Ver empresas, conductores, flota y contactos"),
    P.DIRECTORY_EDIT: PermissionMeta("directory", "Crear y editar empresas, conductores, flota y contactos"),
    P.DIRECTORY_DELETE: PermissionMeta("directory", "Dar de baja empresas, conductores, flota y contactos"),
    P.CERTIFICATION_READ: PermissionMeta("certification", "Ver documentos y el catálogo de requisitos"),
    P.DOCUMENTS_UPLOAD: PermissionMeta("certification", "Cargar, clasificar y mover documentos"),
    P.DOCUMENTS_REVIEW: PermissionMeta("certification", "Aprobar, rechazar, reasignar y solicitar documentos"),
    P.CERTIFICATION_CONFIGURE: PermissionMeta("certification", "Configurar requisitos y reglas de vencimiento"),
    P.INSURANCE_READ: PermissionMeta("insurance", "Ver pólizas, coberturas y cuotas"),
    P.POLICIES_EDIT: PermissionMeta("insurance", "Crear y editar pólizas, coberturas, vehículos asegurados y cuotas"),
    P.POLICIES_DELETE: PermissionMeta("insurance", "Eliminar pólizas"),
    P.INSURANCE_CONFIGURE: PermissionMeta("insurance", "Configurar tipos de cobertura"),
    P.COMMERCIAL_READ: PermissionMeta("commercial", "Ver tarifario, clientes y reportes"),
    P.COMMERCIAL_EDIT: PermissionMeta("commercial", "Editar tarifas, ubicaciones y clientes"),
    P.REFERENCE_READ: PermissionMeta("reference", "Ver los datos de referencia de la app"),
    P.USERS_MANAGE: PermissionMeta("admin", "Invitar personas y asignar roles", privileged=True),
    P.ROLES_MANAGE: PermissionMeta("admin", "Crear y editar roles personalizados", privileged=True),
    P.SETTINGS_MANAGE: PermissionMeta("admin", "Administrar la configuración general", privileged=True),
}

READ_ALL: frozenset[Permission] = frozenset({
    P.OPERATIONS_READ, P.DIRECTORY_READ, P.CERTIFICATION_READ, P.INSURANCE_READ,
    P.COMMERCIAL_READ, P.REFERENCE_READ,
})


@dataclass(frozen=True)
class SystemRole:
    code: str
    name: str
    description: str
    permissions: frozenset[Permission]
    grants_all: bool = False


def _rol(code: str, name: str, description: str, *extra: Permission) -> SystemRole:
    return SystemRole(code, name, description, READ_ALL | frozenset(extra))


_OPS_OPERADOR = (P.TRIPS_EDIT_BASIC, P.TRIPS_DELETE, P.CLOSURES_DECLARE, P.CLOSURES_SIGN)
_CERT_OPERADOR = (P.DOCUMENTS_UPLOAD,)
_SEG_OPERADOR = (P.POLICIES_EDIT,)

SYSTEM_ROLES: tuple[SystemRole, ...] = (
    SystemRole("owner", "Propietario (Super admin)",
               "Dueño funcional de WebCarga: puede todo y nombra a otros Propietarios.",
               frozenset(), grants_all=True),
    _rol("admin", "Administración", "Gestiona personas, roles y la configuración general.",
         P.USERS_MANAGE, P.ROLES_MANAGE, P.SETTINGS_MANAGE),
    _rol("support", "Soporte técnico (proveedor)", "Lee para diagnosticar; no ejecuta acciones de negocio."),
    _rol("reader", "Lectura", "Ve todas las áreas sin editar."),
    _rol("operations_operator", "Operador de Operaciones",
         "Opera el día: viajes, motivos y firma del cierre.", *_OPS_OPERADOR),
    _rol("operations_supervisor", "Supervisor de Operaciones",
         "Operador + datos sensibles del viaje, altas, directorio y configuración de Operaciones.",
         *_OPS_OPERADOR, P.TRIPS_EDIT_SENSITIVE, P.TRIPS_CREATE, P.OPERATIONS_CONFIGURE, P.DIRECTORY_EDIT),
    _rol("certification_operator", "Operador de Certificación", "Carga y clasifica documentos.", *_CERT_OPERADOR),
    _rol("certification_supervisor", "Supervisor de Certificación",
         "Operador + aprobación de documentos, requisitos y directorio.",
         *_CERT_OPERADOR, P.DOCUMENTS_REVIEW, P.CERTIFICATION_CONFIGURE, P.DIRECTORY_EDIT, P.DIRECTORY_DELETE),
    _rol("insurance_operator", "Operador de Seguros", "Gestiona pólizas, coberturas y cuotas.", *_SEG_OPERADOR),
    _rol("insurance_supervisor", "Supervisor de Seguros", "Operador + eliminación de pólizas y tipos de cobertura.",
         *_SEG_OPERADOR, P.POLICIES_DELETE, P.INSURANCE_CONFIGURE),
    _rol("commercial_operator", "Operador Comercial", "Consulta tarifario, clientes y reportes."),
    _rol("commercial_supervisor", "Supervisor Comercial", "Edita tarifas, ubicaciones y clientes.", P.COMMERCIAL_EDIT),
)

# Migración de los roles de la escalera vieja (spec §9). Nadie pierde; la única
# ganancia aprobada es *.configure para los Supervisores (los editor actuales).
LEGACY_ROLE_MAP: dict[str, tuple[str, ...]] = {
    "owner": ("owner",),
    "admin": ("admin", "operations_supervisor", "certification_supervisor",
              "insurance_supervisor", "commercial_supervisor"),
    "editor": ("operations_supervisor", "certification_supervisor",
               "insurance_supervisor", "commercial_supervisor"),
    "writer": ("operations_operator",),
    "viewer": ("reader",),
}


def legacy_role_for(role_codes: list[str]) -> str:
    """Rol equivalente de la escalera vieja (transición; se borra en la Task 13).

    Lo usan get_current_user (para los guardias viejos mientras las Tasks 5-8
    migran las rutas, hasta la Task 11) y la invitación (profiles.role, que la
    API de `main` todavía lee). Un rol de Operador de otra área no tenía
    equivalente: se aproxima a `writer` (escribe algo sin ser editor)."""
    codes = set(role_codes)
    if "owner" in codes:
        return "owner"
    if "admin" in codes:
        return "admin"
    if any(c.endswith("_supervisor") for c in codes):
        return "editor"
    if any(c.endswith("_operator") and c != "commercial_operator" for c in codes):
        return "writer"
    return "viewer"
```

```python
# app/authz/__init__.py
from .permissions import Permission  # noqa: F401
```

- [ ] **Step 4: Run test to verify it passes**

Run: `venv/bin/python -m pytest tests/test_authz_catalogo.py -q -p no:cacheprovider`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add monitor-app/backend/api/app/authz monitor-app/backend/api/tests/test_authz_catalogo.py
git commit -m "feat(authz): catalogo de permisos y roles de sistema (RBAC)"
```

---

### Task 2: Migración expand y sincronización al arrancar

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20261010100000_rbac_expand.sql`
- Create: `monitor-app/backend/api/app/authz/sync.py`
- Modify: `monitor-app/backend/api/app/main.py` (lifespan)
- Test: `monitor-app/backend/api/tests/test_authz_sync_integracion.py`

**Interfaces:**
- Consumes: `Permission`, `PERMISSION_META`, `SYSTEM_ROLES`, `LEGACY_ROLE_MAP` (Task 1).
- Produces: tablas `app.permissions(code, area, description, privileged)`, `app.roles(id, code, name, description, is_system, grants_all, created_by, created_at)`, `app.role_permissions(role_id, permission_code)`, `app.user_roles(user_id, role_id, granted_by, granted_at)`, columna `public.admin_whitelist.role_codes text[]`; `async def sync_catalog(conn) -> list[str]` (devuelve permisos huérfanos: asignados a roles personalizados y ya no presentes en el código).

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Rehearse with ROLLBACK (MCP `execute_sql`, proyecto `viclzoftiudkepqnhekv`)**

Pegar el contenido de la migración entre `BEGIN;` y estas verificaciones, y terminar con `ROLLBACK;`:

```sql
SELECT p.role, count(*) personas,
       array_agg(DISTINCT r.code ORDER BY r.code) roles_nuevos
FROM public.profiles p
JOIN app.user_roles ur ON ur.user_id = p.id JOIN app.roles r ON r.id = ur.role_id
GROUP BY p.role ORDER BY p.role;
SELECT count(*) AS perfiles_sin_asignacion FROM public.profiles p
WHERE NOT EXISTS (SELECT 1 FROM app.user_roles ur WHERE ur.user_id = p.id);
SELECT email, role, role_codes FROM public.admin_whitelist ORDER BY role;  -- revisar sin copiar emails a reportes
ROLLBACK;
```

Expected: cada `role` con exactamente los roles de `LEGACY_ROLE_MAP`; `perfiles_sin_asignacion = 0`; toda invitación con `role_codes` no vacío.

- [ ] **Step 3: Write the failing sync test**

```python
# tests/test_authz_sync_integracion.py
"""La API alinea app.permissions y los roles de sistema con el catálogo al arrancar."""
import pytest

from app.authz.permissions import PERMISSION_META, SYSTEM_ROLES
from app.authz.sync import sync_catalog

pytestmark = pytest.mark.integracion


async def test_sincroniza_permisos_y_composicion(conexion_revertida):
    conn = conexion_revertida
    huerfanos = await sync_catalog(conn)
    assert huerfanos == []
    codigos = {r["code"] for r in await conn.fetch("SELECT code FROM app.permissions")}
    assert codigos == {p.value for p in PERMISSION_META}
    for rol in SYSTEM_ROLES:
        fila = await conn.fetchrow(
            "SELECT id, name, is_system, grants_all FROM app.roles WHERE code = $1", rol.code)
        assert fila["is_system"] and fila["name"] == rol.name and fila["grants_all"] == rol.grants_all
        tiene = {r["permission_code"] for r in await conn.fetch(
            "SELECT permission_code FROM app.role_permissions WHERE role_id = $1", fila["id"])}
        assert tiene == {p.value for p in rol.permissions}, rol.code


async def test_es_idempotente(conexion_revertida):
    await sync_catalog(conexion_revertida)
    antes = await conexion_revertida.fetchval("SELECT count(*) FROM app.role_permissions")
    await sync_catalog(conexion_revertida)
    assert await conexion_revertida.fetchval("SELECT count(*) FROM app.role_permissions") == antes


async def test_un_permiso_retirado_del_codigo_se_informa_y_no_rompe(conexion_revertida):
    """Review Focus 3: un rol personalizado con un permiso que ya no existe."""
    conn = conexion_revertida
    await sync_catalog(conn)
    await conn.execute("INSERT INTO app.permissions (code, area, description) VALUES ('legacy.gone', 'operations', 'x')")
    rid = await conn.fetchval("INSERT INTO app.roles (code, name) VALUES ('custom_x', 'X') RETURNING id")
    await conn.execute("INSERT INTO app.role_permissions VALUES ($1, 'legacy.gone')", rid)
    assert await sync_catalog(conn) == ["legacy.gone"]
```

- [ ] **Step 4: Run test to verify it fails**

Run: `venv/bin/python -m pytest tests/test_authz_sync_integracion.py -q -p no:cacheprovider`
Expected: FAIL (`No module named 'app.authz.sync'`, o tablas inexistentes si la migración no está aplicada: aplicar la migración primero, Step 6).

- [ ] **Step 5: Write the implementation**

```python
# app/authz/sync.py
"""Alinea la base con el catálogo del código (app/authz/permissions.py).

Corre al arrancar la API, en una transacción y con un advisory lock: varias
instancias de Cloud Run pueden arrancar a la vez. Idempotente.

- app.permissions: upsert de todo el catálogo. Un permiso que ya no está en el
  código y ningún rol usa se borra; si un rol personalizado lo usa, se conserva
  y se devuelve (se loguea; test_authz_catalogo/CI lo atrapa antes).
- Roles de sistema: nombre, descripción y composición exactamente como el código.
"""
from __future__ import annotations

import logging

from .permissions import PERMISSION_META, SYSTEM_ROLES

log = logging.getLogger(__name__)
_LOCK = 8_202_610  # identificador del advisory lock de esta sincronización


async def sync_catalog(conn) -> list[str]:
    async with conn.transaction():
        await conn.execute("SELECT pg_advisory_xact_lock($1)", _LOCK)
        await conn.executemany(
            """INSERT INTO app.permissions (code, area, description, privileged)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (code) DO UPDATE SET area = EXCLUDED.area,
                 description = EXCLUDED.description, privileged = EXCLUDED.privileged""",
            [(p.value, m.area, m.description, m.privileged) for p, m in PERMISSION_META.items()],
        )
        vigentes = [p.value for p in PERMISSION_META]
        huerfanos = [r["code"] for r in await conn.fetch(
            """SELECT DISTINCT rp.permission_code AS code FROM app.role_permissions rp
               JOIN app.roles r ON r.id = rp.role_id
               WHERE NOT r.is_system AND rp.permission_code <> ALL($1::text[])
               ORDER BY 1""", vigentes)]
        await conn.execute(
            """DELETE FROM app.permissions p WHERE p.code <> ALL($1::text[])
               AND NOT EXISTS (SELECT 1 FROM app.role_permissions rp
                               JOIN app.roles r ON r.id = rp.role_id
                               WHERE rp.permission_code = p.code AND NOT r.is_system)""", vigentes)
        for rol in SYSTEM_ROLES:
            rid = await conn.fetchval(
                """INSERT INTO app.roles (code, name, description, is_system, grants_all)
                   VALUES ($1, $2, $3, true, $4)
                   ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name,
                     description = EXCLUDED.description, is_system = true, grants_all = EXCLUDED.grants_all
                   RETURNING id""", rol.code, rol.name, rol.description, rol.grants_all)
            await conn.execute("DELETE FROM app.role_permissions WHERE role_id = $1", rid)
            await conn.executemany(
                "INSERT INTO app.role_permissions (role_id, permission_code) VALUES ($1, $2)",
                [(rid, p.value) for p in rol.permissions])
    if huerfanos:
        log.warning("Permisos retirados del código y todavía asignados a roles personalizados: %s", huerfanos)
    return huerfanos
```

```python
# app/main.py — dentro de lifespan, después de init_pool:
from .authz.sync import sync_catalog
...
    pool = await init_pool(settings.database_url)
    app.state.pool = pool
    async with pool.acquire() as conn:
        await sync_catalog(conn)
    yield
```

- [ ] **Step 6: Apply the migration and run tests**

Aplicar `20261010100000_rbac_expand.sql` con MCP `apply_migration` (nombre `rbac_expand`), fuera de las ventanas de ingesta (:58–:02, :13–:17, :28–:32, :43–:47). Verificar con `psql` de solo lectura que `app.user_roles` tiene una o más filas por cada perfil.

Run: `venv/bin/python -m pytest tests/test_authz_sync_integracion.py tests/test_authz_catalogo.py -q -p no:cacheprovider`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add monitor-app/backend/supabase/migrations/20261010100000_rbac_expand.sql monitor-app/backend/api/app/authz/sync.py monitor-app/backend/api/app/main.py monitor-app/backend/api/tests/test_authz_sync_integracion.py
git commit -m "feat(authz): tablas RBAC, asignaciones migradas y sincronizacion del catalogo"
```

---

### Task 3: Permisos efectivos y `require()`

**Files:**
- Create: `monitor-app/backend/api/app/authz/effective.py`, `monitor-app/backend/api/app/authz/deps.py`
- Modify: `monitor-app/backend/api/app/auth.py` (`get_current_user`), `monitor-app/backend/api/app/authz/__init__.py`
- Test: `monitor-app/backend/api/tests/test_authz_require.py`, `monitor-app/backend/api/tests/test_authz_efectivos_integracion.py`

**Interfaces:**
- Consumes: tablas de Task 2; `Permission`, `PERMISSION_META` (Task 1).
- Produces:
  - `async def load_access(pool, user_id: str) -> dict | None` → `{"active": bool, "roles": list[str], "permissions": list[str]}` o `None` si no hay perfil.
  - `async def invalidate_access(user_id: str) -> None` (borra la clave de caché `acceso:{user_id}`).
  - `get_current_user` devuelve `{"sub", "email", "aal", "roles": list[str], "permissions": frozenset[str]}`; sin perfil o sin roles → 403; inactivo → 403.
  - `def require(*permissions: Permission)` → dependencia FastAPI que devuelve el usuario.

- [ ] **Step 1: Write the failing unit tests**

```python
# tests/test_authz_require.py
import pytest
from fastapi import HTTPException

from app.authz import Permission
from app.authz.deps import require


def _user(*perms, aal="aal1"):
    return {"sub": "u-1", "email": "x@webcarga.com", "aal": aal, "roles": ["r"],
            "permissions": frozenset(p.value for p in perms)}


async def test_con_el_permiso_pasa():
    dep = require(Permission.CLOSURES_SIGN)
    user = _user(Permission.CLOSURES_SIGN)
    assert await dep(user) is user


async def test_sin_el_permiso_403_con_el_nombre():
    dep = require(Permission.CLOSURES_SIGN)
    with pytest.raises(HTTPException) as err:
        await dep(_user(Permission.OPERATIONS_READ))
    assert err.value.status_code == 403
    assert "Firmar y reabrir el cierre del día" in err.value.detail


async def test_varios_permisos_exigen_todos():
    dep = require(Permission.TRIPS_EDIT_BASIC, Permission.TRIPS_EDIT_SENSITIVE)
    with pytest.raises(HTTPException):
        await dep(_user(Permission.TRIPS_EDIT_BASIC))


async def test_privilegiado_exige_aal2():
    dep = require(Permission.USERS_MANAGE)
    with pytest.raises(HTTPException) as err:
        await dep(_user(Permission.USERS_MANAGE, aal="aal1"))
    assert "dos pasos" in err.value.detail
    assert await dep(_user(Permission.USERS_MANAGE, aal="aal2"))


def test_require_sin_permisos_es_error_de_programacion():
    with pytest.raises(ValueError):
        require()
```

- [ ] **Step 2: Run to verify it fails**

Run: `venv/bin/python -m pytest tests/test_authz_require.py -q -p no:cacheprovider`
Expected: FAIL (`No module named 'app.authz.deps'`).

- [ ] **Step 3: Implement `effective.py` and `deps.py`**

```python
# app/authz/effective.py
"""Permisos efectivos de una persona: la unión de los permisos de sus roles.

`grants_all` (Propietario) → todo el catálogo vigente. Una sola consulta,
cacheada 60 s como el rol de antes; se invalida al cambiar las asignaciones
(services/access_admin.py), así un rol quitado deja de valer de inmediato.
"""
from __future__ import annotations

import json

from ..cache import cache_delete, cache_get, cache_set

_SQL = """
SELECT p.active,
       COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles,
       CASE WHEN bool_or(r.grants_all)
            THEN (SELECT array_agg(code ORDER BY code) FROM app.permissions)
            ELSE COALESCE(array_agg(DISTINCT rp.permission_code)
                          FILTER (WHERE rp.permission_code IS NOT NULL), '{}')
       END AS permissions
FROM public.profiles p
LEFT JOIN app.user_roles ur ON ur.user_id = p.id
LEFT JOIN app.roles r ON r.id = ur.role_id
LEFT JOIN app.role_permissions rp ON rp.role_id = r.id
WHERE p.id = $1
GROUP BY p.id, p.active
"""


def _clave(user_id: str) -> str:
    return f"acceso:{user_id}"


async def load_access(pool, user_id: str) -> dict | None:
    cached = await cache_get(_clave(user_id))
    if cached:
        return json.loads(cached)
    fila = await pool.fetchrow(_SQL, user_id)
    acceso = None if fila is None else {
        "active": fila["active"], "roles": sorted(fila["roles"]), "permissions": sorted(fila["permissions"])}
    await cache_set(_clave(user_id), json.dumps(acceso), ex=60)
    return acceso


async def invalidate_access(user_id: str) -> None:
    await cache_delete(_clave(user_id))
```

> Si `app/cache.py` no exporta `cache_delete`, agregarlo con la misma firma que `cache_get` (Redis `DEL` en Upstash; en memoria, `dict.pop`), con su test en `tests/test_cache.py`.

```python
# app/authz/deps.py
"""Guardias por permiso. Reemplazan a require_writer/editor/admin."""
from __future__ import annotations

from collections.abc import Iterable, Mapping

from fastapi import Depends, HTTPException

from ..auth import MFA_REQUERIDO, get_current_user
from .permissions import PERMISSION_META, Permission


def require(*permissions: Permission):
    if not permissions:
        raise ValueError("require() necesita al menos un permiso")
    privilegiado = any(PERMISSION_META[p].privileged for p in permissions)

    async def _dep(user: dict = Depends(get_current_user)) -> dict:
        faltan = [p for p in permissions if p.value not in user["permissions"]]
        if faltan:
            nombres = ", ".join(PERMISSION_META[p].description for p in faltan)
            raise HTTPException(403, f"No tienes permiso para: {nombres}")
        if privilegiado and user.get("aal") != "aal2":
            raise HTTPException(403, MFA_REQUERIDO)
        return user

    _dep.required_permissions = tuple(permissions)  # lo lee la guarda de rutas (Task 8)
    return _dep


def require_fields(user: dict, sent: Iterable[str], field_map: Mapping[str, Permission]) -> None:
    """Permiso por campo: un campo sin permiso invalida el cuerpo completo."""
    sin_permiso = sorted(f for f in sent if f in field_map and field_map[f].value not in user["permissions"])
    if sin_permiso:
        raise HTTPException(403, "No tienes permiso para editar estos campos: " + ", ".join(sin_permiso))
```

```python
# app/authz/__init__.py
from .deps import require, require_fields  # noqa: F401
from .permissions import Permission  # noqa: F401
```

- [ ] **Step 4: Change `get_current_user`**

En `app/auth.py`, reemplazar el bloque que lee `role, active` de `public.profiles` por:

```python
from .authz.effective import load_access
...
    acceso = await load_access(pool, sub)
    if acceso is None or not acceso["roles"]:
        raise HTTPException(status_code=403, detail="Tu cuenta no tiene acceso. Pide a un administrador que te invite.")
    if acceso["active"] is False:
        raise HTTPException(status_code=403, detail="Tu cuenta está desactivada")
    return {"sub": sub, "email": claims.get("email"), "aal": claims.get("aal"),
            "roles": acceso["roles"], "permissions": frozenset(acceso["permissions"])}
```

Mantener `MFA_REQUERIDO` en `auth.py`. **Transición** (hasta la Task 11): el usuario devuelto incluye además
`"role": legacy_role_for(acceso["roles"])`, y `require_writer/editor/admin` siguen leyendo `user["role"]` sin
cambios. Así las rutas todavía no migradas (Tasks 5-8) se comportan igual que hoy, sin reglas inventadas. La Task
11 borra los guardias viejos y la clave `role` del usuario, y un `grep` lo verifica.

- [ ] **Step 5: Integration test (Review Focus 1 y 4)**

```python
# tests/test_authz_efectivos_integracion.py
import uuid

import pytest
from unittest.mock import AsyncMock, patch

from app.authz.effective import load_access
from app.authz.sync import sync_catalog

pytestmark = pytest.mark.integracion


async def _persona(conn, *codigos):
    uid = await conn.fetchval("SELECT id FROM public.profiles ORDER BY created_at LIMIT 1")
    await conn.execute("DELETE FROM app.user_roles WHERE user_id = $1", uid)
    for c in codigos:
        await conn.execute(
            "INSERT INTO app.user_roles (user_id, role_id) SELECT $1, id FROM app.roles WHERE code = $2", uid, c)
    return str(uid)


@pytest.fixture
def sin_cache():
    with patch("app.authz.effective.cache_get", AsyncMock(return_value=None)), \
         patch("app.authz.effective.cache_set", AsyncMock()):
        yield


async def test_union_de_roles(conexion_revertida, sin_cache):
    await sync_catalog(conexion_revertida)
    uid = await _persona(conexion_revertida, "operations_operator", "insurance_operator")
    acceso = await load_access(conexion_revertida, uid)
    assert {"closures.sign", "policies.edit", "operations.read"} <= set(acceso["permissions"])
    assert "trips.edit_sensitive" not in acceso["permissions"]


async def test_propietario_tiene_todo_el_catalogo(conexion_revertida, sin_cache):
    await sync_catalog(conexion_revertida)
    uid = await _persona(conexion_revertida, "owner")
    acceso = await load_access(conexion_revertida, uid)
    todos = {r["code"] for r in await conexion_revertida.fetch("SELECT code FROM app.permissions")}
    assert set(acceso["permissions"]) == todos


async def test_sin_roles_no_tiene_acceso(conexion_revertida, sin_cache):
    uid = await _persona(conexion_revertida)
    acceso = await load_access(conexion_revertida, uid)
    assert acceso["roles"] == [] and acceso["permissions"] == []
```

Y en `tests/test_auth.py`, reemplazar el `_pool()` que devuelve `{"role", "active"}` por un `patch("app.auth.load_access", AsyncMock(return_value={...}))`, y agregar:

```python
async def test_sin_roles_es_403(sin_cache):
    with patch("app.auth.load_access", AsyncMock(return_value={"active": True, "roles": [], "permissions": []})):
        with pytest.raises(HTTPException) as err:
            await auth.get_current_user(_cred(_token()), settings=MagicMock(supabase_url=URL), pool=MagicMock())
    assert err.value.status_code == 403


async def test_quitar_un_rol_invalida_el_cache():
    """Review Focus 4: invalidate_access borra la clave; el próximo request relee."""
    with patch("app.authz.effective.cache_delete", AsyncMock()) as borrar:
        from app.authz.effective import invalidate_access
        await invalidate_access("u-1")
    borrar.assert_awaited_once_with("acceso:u-1")
```

- [ ] **Step 6: Run tests**

Run: `venv/bin/python -m pytest tests/test_authz_require.py tests/test_authz_efectivos_integracion.py tests/test_auth.py -q -p no:cacheprovider`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add monitor-app/backend/api/app/authz monitor-app/backend/api/app/auth.py monitor-app/backend/api/app/cache.py monitor-app/backend/api/tests/test_authz_require.py monitor-app/backend/api/tests/test_authz_efectivos_integracion.py monitor-app/backend/api/tests/test_auth.py
git commit -m "feat(authz): permisos efectivos en get_current_user y require()"
```

---

### Task 4: Permisos por campo en viajes

**Files:**
- Modify: `monitor-app/backend/api/app/schemas/trip.py` (agregar `TRIP_FIELD_PERMISSIONS`, `STOP_FIELD_PERMISSIONS`; retirar `CAMPOS_BASICOS_DEL_DIARIO`, `CAMPOS_BASICOS_DE_PARADA`)
- Modify: `monitor-app/backend/api/app/routers/trips.py` (`patch_trip`, `patch_trip_stop`: `require_fields`; borrar `_exigir_campos_permitidos`)
- Modify: `monitor-app/backend/api/tests/test_rol_writer.py` → renombrar a `tests/test_permisos_por_campo.py`

**Interfaces:**
- Consumes: `require_fields`, `Permission` (Task 3).
- Produces: `TRIP_FIELD_PERMISSIONS: dict[str, Permission]` (todo campo de `TripPatch`), `STOP_FIELD_PERMISSIONS: dict[str, Permission]` (todo campo de `TripStopPatch`).

- [ ] **Step 1: Write the failing test (Review Focus 5)**

```python
# tests/test_permisos_por_campo.py
"""Permiso por campo dentro del modelo RBAC (antes: excepción del rol writer)."""
import pytest
from fastapi import HTTPException

from app.authz import Permission, require_fields
from app.schemas.trip import STOP_FIELD_PERMISSIONS, TRIP_FIELD_PERMISSIONS, TripPatch, TripStopPatch

OPERADOR = {"permissions": frozenset({"trips.edit_basic"})}
SUPERVISOR = {"permissions": frozenset({"trips.edit_basic", "trips.edit_sensitive"})}


def test_todo_campo_del_patch_tiene_permiso():
    assert set(TripPatch.model_fields) == set(TRIP_FIELD_PERMISSIONS)
    assert set(TripStopPatch.model_fields) == set(STOP_FIELD_PERMISSIONS)


def test_los_basicos_de_hoy_siguen_siendo_basicos():
    basicos = {f for f, p in TRIP_FIELD_PERMISSIONS.items() if p is Permission.TRIPS_EDIT_BASIC}
    assert basicos == {"is_active", "is_working", "is_assigned", "is_first_leg", "notes", "comments", "driver_phone"}


def test_operador_edita_basicos():
    require_fields(OPERADOR, ["notes", "driver_phone"], TRIP_FIELD_PERMISSIONS)


def test_cuerpo_mixto_se_rechaza_entero():
    with pytest.raises(HTTPException) as err:
        require_fields(OPERADOR, ["notes", "tractor_plate"], TRIP_FIELD_PERMISSIONS)
    assert err.value.status_code == 403 and "tractor_plate" in err.value.detail and "notes" not in err.value.detail


def test_supervisor_edita_todo():
    require_fields(SUPERVISOR, list(TRIP_FIELD_PERMISSIONS), TRIP_FIELD_PERMISSIONS)
```

- [ ] **Step 2: Run to verify it fails**

Run: `venv/bin/python -m pytest tests/test_permisos_por_campo.py -q -p no:cacheprovider`
Expected: FAIL (`cannot import name 'TRIP_FIELD_PERMISSIONS'`).

- [ ] **Step 3: Implement**

En `app/schemas/trip.py`, después de `TripPatch` y `TripStopPatch`:

```python
from ..authz.permissions import Permission

_BASICOS_VIAJE = {"is_active", "is_working", "is_assigned", "is_first_leg", "notes", "comments", "driver_phone"}
# Permiso por campo (spec RBAC §6): básicos para el Operador, el resto para el
# Supervisor. Todo campo nuevo de TripPatch tiene que figurar acá (test).
TRIP_FIELD_PERMISSIONS: dict[str, Permission] = {
    f: (Permission.TRIPS_EDIT_BASIC if f in _BASICOS_VIAJE else Permission.TRIPS_EDIT_SENSITIVE)
    for f in TripPatch.model_fields
}
_BASICOS_PARADA = {"desc_inicio", "desc_fin", "arrival", "departure"}
STOP_FIELD_PERMISSIONS: dict[str, Permission] = {
    f: (Permission.TRIPS_EDIT_BASIC if f in _BASICOS_PARADA else Permission.TRIPS_EDIT_SENSITIVE)
    for f in TripStopPatch.model_fields
}
```

Borrar `CAMPOS_BASICOS_DEL_DIARIO` y `CAMPOS_BASICOS_DE_PARADA`. En `routers/trips.py`: borrar `_exigir_campos_permitidos`; en `patch_trip` reemplazar `_exigir_campos_permitidos(user, data)` por `require_fields(user, data, TRIP_FIELD_PERMISSIONS)` y su guardia por `user=Depends(require(Permission.TRIPS_EDIT_BASIC))`; en `patch_trip_stop`, `require_fields(user, data, STOP_FIELD_PERMISSIONS)` con la misma guardia.

- [ ] **Step 4: Run tests**

Run: `venv/bin/python -m pytest tests/test_permisos_por_campo.py tests/test_trip_hygiene_fields.py tests/test_trip_create.py tests/test_activo_lo_define_el_tms_integracion.py -q -p no:cacheprovider`
Expected: PASS (ajustar en esos tests los usuarios mock: `{"sub":..., "permissions": frozenset({...}), "roles": [...], "aal": "aal1"}` sobreescribiendo `get_current_user`).

- [ ] **Step 5: Commit**

```bash
git add -A monitor-app/backend/api && git commit -m "feat(authz): permisos por campo de viajes en el modelo RBAC"
```

---

### Tasks 5-8: Cada ruta declara su permiso

Patrón (idéntico en todos los routers): en la firma, el guardia viejo se reemplaza por `Depends(require(Permission.X))`, conservando el nombre del parámetro (`user=` o `_=`). Las lecturas que hoy dependen solo de `get_current_user` pasan a `require(<área>.read)`. Importar `from ..authz import Permission, require`.

#### Task 5: Operaciones (`trips.py`, `closures.py`, `daily_closures.py`, `equipment_closures.py`, `status_report.py`)

| Ruta | Hoy | Permiso |
|---|---|---|
| GET de `trips`, `closures`, `daily-closures`, `equipment-closures`, `status-report` | sesión | `OPERATIONS_READ` |
| `POST /trips`, `POST /trips/bulk` | editor | `TRIPS_CREATE` |
| `POST /trips/assign-driver`, `POST/DELETE /trips/{id}/fleet-link`, `DELETE /trips/{id}/overrides/{field}` | editor | `TRIPS_EDIT_SENSITIVE` |
| `PATCH /trips/{id}/notes/{note_id}/pin`, `…/resolve` | editor | `TRIPS_EDIT_SENSITIVE` |
| `PATCH /trips/{id}`, `PATCH /trips/{id}/stops/{stop_id}`, `POST /trips/{id}/notes` | writer | `TRIPS_EDIT_BASIC` (+ `require_fields`, Task 4) |
| `POST /trips/bulk-delete`, `DELETE /trips/{id}` | writer | `TRIPS_DELETE` |
| `PATCH /trips/bulk-close`, `PATCH /trips/bulk-reopen`, `PATCH /daily-closures/reason`, `PATCH /daily-closures/{driver_id}`, `PATCH /equipment-closures/reason`, `PATCH /equipment-closures/{asset_id}` | writer | `CLOSURES_DECLARE` |
| `POST /closures/{fecha}/close`, `POST /closures/{fecha}/reopen` | writer | `CLOSURES_SIGN` |

#### Task 6: Directorio y Comercial (`carriers.py`, `drivers.py`, `assets.py`, `contacts.py`, `locations.py`, `shippers.py`)

| Ruta | Hoy | Permiso |
|---|---|---|
| GET de `carriers`, `drivers`, `assets`, `contacts` | sesión | `DIRECTORY_READ` |
| `POST/PATCH /carriers`, `POST /carriers/{id}/drivers`, `POST /carriers/{id}/assets`, `POST /carriers/{id}/contacts`, `POST/PATCH /drivers`, `POST /drivers/{id}/contacts`, `POST/PATCH /assets`, `POST /assets/{id}/driver-assignment`, `PATCH /contacts/{id}` | editor | `DIRECTORY_EDIT` |
| `DELETE /carriers/{id}`, `DELETE /carriers/{id}/drivers/{driver_id}`, `DELETE /carriers/{id}/assets/{asset_id}`, `DELETE /assets/{id}/driver-assignment`, `DELETE /contacts/{id}` | editor | `DIRECTORY_DELETE` |
| `POST /carriers/{id}/policies` | editor | `POLICIES_EDIT` |
| GET de `locations`, `shippers` | sesión | `COMMERCIAL_READ` |
| `POST/PATCH /locations`, `POST/PATCH /locations/{id}/rates`, `POST /shippers` | editor | `COMMERCIAL_EDIT` |

> `DELETE /carriers/{id}/drivers/{driver_id}` y `/assets/{asset_id}` desvinculan (no borran la ficha) y la pantalla
> las muestra como "Dar de baja": quedan en `DIRECTORY_DELETE`. Hoy las tiene `editor`, que migra a los 4
> Supervisores; el de Certificación tiene `DIRECTORY_DELETE`, así que nadie pierde.

#### Task 7: Certificación y Seguros (`compliance.py`, `requirements.py`, `document_ingest.py`, `policies.py`, `coverage_types.py`)

| Ruta | Hoy | Permiso |
|---|---|---|
| GET de `compliance-records`, `compliance-requirements`, `document-ingest` | sesión | `CERTIFICATION_READ` |
| `POST /compliance-records/date-template`, `POST /compliance-records/{id}/file`, `POST /compliance-records/bulk-file`, `DELETE /compliance-records/{id}/file`, todo `POST/DELETE` de `document-ingest` | editor | `DOCUMENTS_UPLOAD` |
| `PATCH /compliance-records/{id}`, `POST /compliance-records/{id}/reassign`, `POST/DELETE /compliance-records/requests…` | editor | `DOCUMENTS_REVIEW` |
| Toda escritura de `compliance-requirements` (crear, alias, condiciones, preview, recalc, batch-preview, batch-update) | admin | `CERTIFICATION_CONFIGURE` |
| GET de `policies`, `coverage-types` | sesión | `INSURANCE_READ` |
| `PATCH /policies/{id}`, coberturas, vehículos, cuotas, archivo | editor | `POLICIES_EDIT` |
| `DELETE /policies/{id}` | editor | `POLICIES_DELETE` |
| escrituras de `coverage-types` (si existen) | editor/admin | `INSURANCE_CONFIGURE` |

#### Task 8: Configuración, personas y la guarda de rutas (`config.py`, `config_reviews.py`, `status_taxonomies.py`, `users.py`, `roles.py`)

| Ruta | Hoy | Permiso |
|---|---|---|
| GET de `config/*` (estados, umbrales, temperaturas, reglas de alerta, revisiones, búsqueda, taxonomías) | sesión | `REFERENCE_READ` |
| `GET /config/inventario` | admin | `SETTINGS_MANAGE` |
| `PATCH/POST /config/statuses…`, `alert-thresholds`, `temperature-ranges`, `monitor-alert-rules`, escrituras de `config/taxonomies` | admin | `OPERATIONS_CONFIGURE` |
| `POST /config/reviews` | admin | `SETTINGS_MANAGE` |
| `GET/POST/PATCH/DELETE /users` | admin | `USERS_MANAGE` |
| `GET /roles` (escalera vieja) | sesión | **se borra** (lo reemplaza `GET /roles` de la Task 9) |

Al cambiar los routers con `dependencies=[Depends(get_current_user)]` a nivel de router (config, config_reviews, status_taxonomies), quitar esa dependencia de router: cada ruta declara la suya.

Cada Task 5-8 sigue estos pasos:

- [ ] **Step 1:** Reemplazar guardias según la tabla de la Task.
- [ ] **Step 2:** En los tests de esos routers, reemplazar `dependency_overrides[require_editor|require_writer|require_admin]` por `dependency_overrides[get_current_user] = lambda: usuario(...)` con el helper de `tests/conftest.py`:

```python
# tests/conftest.py (agregar en Task 5; usar en 5-8)
from app.authz.permissions import SYSTEM_ROLES, Permission, legacy_role_for


def usuario(*roles: str, aal: str = "aal2", sub: str = "00000000-0000-0000-0000-000000000001") -> dict:
    """Usuario de prueba con los permisos efectivos de los roles de sistema dados
    (misma forma que devuelve get_current_user)."""
    por_codigo = {r.code: r for r in SYSTEM_ROLES}
    perms: set[str] = set()
    for c in roles:
        r = por_codigo[c]
        perms |= {p.value for p in Permission} if r.grants_all else {p.value for p in r.permissions}
    return {"sub": sub, "email": "test@webcarga.com", "aal": aal, "roles": list(roles),
            "permissions": frozenset(perms), "role": legacy_role_for(list(roles))}
```

- [ ] **Step 3:** Run: `venv/bin/python -m pytest tests/ -q -p no:cacheprovider -k "<routers de la Task>"` → PASS.
- [ ] **Step 4:** Commit: `git commit -am "refactor(authz): <área> declara permisos por ruta"`.

En la Task 8, además, la guarda (reemplaza `tests/test_toda_ruta_exige_sesion.py`):

```python
# tests/test_toda_ruta_declara_permiso.py
"""Toda ruta declara el permiso que exige (RBAC). Negar por defecto: una ruta
nueva sin require(...) hace fallar este test."""
from fastapi.routing import APIRoute

from app.main import app

EXCEPCIONES = {
    "/health",                        # chequeo de vida de Cloud Run
    "/api/v1/me",                     # mis propios permisos
    "/api/v1/filter-groups",          # filtros personales: se validan por dueño
    "/api/v1/filter-groups/{group_id}",
}
DE_PRUEBA = "/__test__/"


def _permisos(dependant) -> tuple:
    for d in dependant.dependencies:
        req = getattr(d.call, "required_permissions", None)
        if req:
            return req
        sub = _permisos(d)
        if sub:
            return sub
    return ()


def test_toda_ruta_declara_permiso():
    sin_permiso = sorted(
        f"{sorted(r.methods)[0]} {r.path}"
        for r in app.routes
        if isinstance(r, APIRoute) and r.path not in EXCEPCIONES
        and not r.path.startswith(DE_PRUEBA) and not _permisos(r.dependant)
    )
    assert sin_permiso == [], "Rutas sin permiso declarado:\n" + "\n".join(sin_permiso)


def test_las_excepciones_igual_exigen_sesion():
    from app.auth import get_current_user

    def exige(dep):
        return any(d.call is get_current_user or exige(d) for d in dep.dependencies)
    for r in app.routes:
        if isinstance(r, APIRoute) and r.path in EXCEPCIONES - {"/health"}:
            assert exige(r.dependant), r.path
```

Y la matriz rol × ruta:

```python
# tests/test_matriz_roles.py
"""Matriz rol × ruta: qué acepta y qué rechaza cada rol de sistema.
Se arma desde el catálogo y la ruta: no hay una segunda lista escrita a mano."""
import pytest
from fastapi.routing import APIRoute

from app.authz.permissions import SYSTEM_ROLES, Permission
from app.main import app
from tests.test_toda_ruta_declara_permiso import _permisos

RUTAS = [(r, _permisos(r.dependant)) for r in app.routes if isinstance(r, APIRoute) and _permisos(r.dependant)]


@pytest.mark.parametrize("rol", SYSTEM_ROLES, ids=lambda r: r.code)
def test_rol_contra_cada_ruta(rol):
    tiene = set(Permission) if rol.grants_all else set(rol.permissions)
    for ruta, requeridos in RUTAS:
        acepta = set(requeridos) <= tiene
        if rol.code == "reader":
            assert acepta == all(p.value.endswith(".read") for p in requeridos), ruta.path
        if rol.code == "owner":
            assert acepta, ruta.path


def test_casos_de_negocio():
    por = {r.code: r.permissions for r in SYSTEM_ROLES}
    assert Permission.CLOSURES_SIGN in por["operations_operator"]
    assert Permission.DOCUMENTS_REVIEW not in por["certification_operator"]
    assert Permission.USERS_MANAGE not in por["support"]
    assert Permission.POLICIES_DELETE not in por["insurance_operator"]
```

Borrar `tests/test_toda_ruta_exige_sesion.py` (lo reemplaza la guarda nueva).

---

### Task 9: Administración de acceso (servicio y rutas)

**Files:**
- Create: `monitor-app/backend/api/app/services/access_admin.py`, `monitor-app/backend/api/app/routers/access.py`
- Modify: `monitor-app/backend/api/app/routers/users.py` (`UserCreate.roles: list[str]`; `POST /users` escribe `role_codes` en la invitación; quitar `_can_manage/_can_assign/ROLE_ORDER`), `monitor-app/backend/api/app/main.py` (incluir `access_router`), borrar `monitor-app/backend/api/app/routers/roles.py`
- Test: `monitor-app/backend/api/tests/test_access_admin_integracion.py`, `monitor-app/backend/api/tests/test_access_rutas.py`

**Interfaces:**
- Consumes: `require`, `Permission`, `invalidate_access`, `log_change(conn, actor, entity_type, entity_id, action, field, old_value, new_value)`.
- Produces:
  - `class AccessError(Exception)` con `status: int`, `message: str`.
  - `async def set_user_roles(conn, actor: dict, user_id: str, role_codes: list[str]) -> list[str]`
  - `async def create_role(conn, actor: dict, code: str, name: str, description: str, permissions: list[str]) -> dict`
  - `async def update_role(conn, actor: dict, role_id: str, name: str | None, description: str | None, permissions: list[str] | None) -> dict`
  - `async def delete_role(conn, actor: dict, role_id: str) -> None`
  - Rutas: `GET /me` (sesión), `GET /permissions` (`USERS_MANAGE`), `GET /roles` (`USERS_MANAGE`), `POST/PATCH/DELETE /roles` (`ROLES_MANAGE`), `PUT /users/{id}/roles` (`USERS_MANAGE`).

Reglas del servicio (spec §5), en una transacción con `SELECT … FOR UPDATE` sobre las filas de `app.user_roles` del rol `owner`:

1. Escalada: los permisos de los roles asignados (o del rol creado/editado) ⊆ permisos del actor, salvo que el actor tenga `owner`. → 403 "No puedes dar permisos que no tienes".
2. Solo un Propietario da o quita `owner`. → 403.
3. Un no-Propietario no modifica a un Propietario (roles, desactivar, borrar). → 403.
4. Nunca 0 Propietarios activos (al quitar `owner`, desactivar o borrar). → 409 "Debe quedar al menos un Propietario".
5. Roles de sistema: no se editan ni borran por API. → 409.
6. Borrar un rol personalizado con personas asignadas. → 409 con la cantidad.
7. Cada cambio: `log_change(entity_type="USER_ROLE"|"ROLE", ...)` y `invalidate_access(user_id)` de cada afectado (al editar un rol: todos sus asignados).

- [ ] **Step 1: Write the failing integration tests**

```python
# tests/test_access_admin_integracion.py
import pytest

from app.authz.sync import sync_catalog
from app.services.access_admin import AccessError, create_role, delete_role, set_user_roles
from tests.conftest import usuario

pytestmark = pytest.mark.integracion


async def _perfiles(conn, n):
    return [str(r["id"]) for r in await conn.fetch("SELECT id FROM public.profiles ORDER BY created_at LIMIT $1", n)]


async def _solo_propietario(conn, uid):
    await conn.execute("DELETE FROM app.user_roles WHERE role_id = (SELECT id FROM app.roles WHERE code='owner')")
    await conn.execute("INSERT INTO app.user_roles (user_id, role_id) SELECT $1, id FROM app.roles WHERE code='owner'", uid)


async def test_no_queda_cero_propietarios(conexion_revertida):
    conn = conexion_revertida
    await sync_catalog(conn)
    (uid,) = await _perfiles(conn, 1)
    await _solo_propietario(conn, uid)
    with pytest.raises(AccessError) as err:
        await set_user_roles(conn, usuario("owner", sub=uid), uid, ["reader"])
    assert err.value.status == 409


async def test_admin_no_escala(conexion_revertida):
    conn = conexion_revertida
    await sync_catalog(conn)
    a, b = await _perfiles(conn, 2)
    with pytest.raises(AccessError) as err:
        await set_user_roles(conn, usuario("admin", sub=a), b, ["operations_supervisor"])
    assert err.value.status == 403


async def test_admin_no_nombra_propietario(conexion_revertida):
    conn = conexion_revertida
    await sync_catalog(conn)
    a, b = await _perfiles(conn, 2)
    with pytest.raises(AccessError) as err:
        await set_user_roles(conn, usuario("admin", sub=a), b, ["owner"])
    assert err.value.status == 403


async def test_propietario_asigna_y_queda_auditado(conexion_revertida):
    conn = conexion_revertida
    await sync_catalog(conn)
    a, b = await _perfiles(conn, 2)
    await set_user_roles(conn, usuario("owner", sub=a), b, ["certification_operator", "reader"])
    codigos = {r["code"] for r in await conn.fetch(
        "SELECT r.code FROM app.user_roles ur JOIN app.roles r ON r.id = ur.role_id WHERE ur.user_id = $1", b)}
    assert codigos == {"certification_operator", "reader"}
    assert await conn.fetchval(
        "SELECT count(*) FROM public.audit_log WHERE entity_type = 'USER_ROLE' AND entity_id = $1::uuid", b) >= 1


async def test_rol_de_sistema_inmutable_y_rol_en_uso_no_se_borra(conexion_revertida):
    conn = conexion_revertida
    await sync_catalog(conn)
    a, b = await _perfiles(conn, 2)
    actor = usuario("owner", sub=a)
    sistema = await conn.fetchval("SELECT id::text FROM app.roles WHERE code = 'reader'")
    with pytest.raises(AccessError) as err:
        await delete_role(conn, actor, sistema)
    assert err.value.status == 409
    rol = await create_role(conn, actor, "custom_lectura_ops", "Lectura de Operaciones", "", ["operations.read"])
    await set_user_roles(conn, actor, b, ["custom_lectura_ops"])
    with pytest.raises(AccessError) as err:
        await delete_role(conn, actor, rol["id"])
    assert err.value.status == 409
```

- [ ] **Step 2: Run to verify it fails** → `ModuleNotFoundError: app.services.access_admin`.

- [ ] **Step 3: Implement `services/access_admin.py`**

```python
# app/services/access_admin.py
"""Reglas de administración de acceso (spec RBAC §5). Sin HTTP: las rutas
traducen AccessError a su status. Cada operación corre en una transacción."""
from __future__ import annotations

from dataclasses import dataclass

from ..authz.effective import invalidate_access
from .audit import log_change


@dataclass
class AccessError(Exception):
    status: int
    message: str


def _es_propietario(actor: dict) -> bool:
    return "owner" in actor["roles"]


async def _permisos_de_roles(conn, codes: list[str]) -> tuple[set[str], bool, list[str]]:
    filas = await conn.fetch(
        """SELECT r.code, r.grants_all, rp.permission_code
           FROM app.roles r LEFT JOIN app.role_permissions rp ON rp.role_id = r.id
           WHERE r.code = ANY($1::text[])""", codes)
    encontrados = {f["code"] for f in filas}
    faltan = sorted(set(codes) - encontrados)
    return {f["permission_code"] for f in filas if f["permission_code"]}, any(f["grants_all"] for f in filas), faltan


async def _propietarios_activos(conn) -> list[str]:
    return [str(r["user_id"]) for r in await conn.fetch(
        """SELECT ur.user_id FROM app.user_roles ur
           JOIN app.roles r ON r.id = ur.role_id JOIN public.profiles p ON p.id = ur.user_id
           WHERE r.code = 'owner' AND p.active IS NOT FALSE
           FOR UPDATE OF ur""")]


async def set_user_roles(conn, actor: dict, user_id: str, role_codes: list[str]) -> list[str]:
    async with conn.transaction():
        nuevos = sorted(set(role_codes))
        perms, todo, faltan = await _permisos_de_roles(conn, nuevos)
        if faltan:
            raise AccessError(422, f"Roles inexistentes: {', '.join(faltan)}")
        actuales = sorted(r["code"] for r in await conn.fetch(
            "SELECT r.code FROM app.user_roles ur JOIN app.roles r ON r.id = ur.role_id WHERE ur.user_id = $1",
            user_id))
        propietario = _es_propietario(actor)
        if ("owner" in actuales) != ("owner" in nuevos) and not propietario:
            raise AccessError(403, "Solo un Propietario puede dar o quitar el rol Propietario")
        if "owner" in actuales and not propietario:
            raise AccessError(403, "No puedes modificar a un Propietario")
        if not propietario and (todo or not perms <= set(actor["permissions"])):
            raise AccessError(403, "No puedes dar permisos que no tienes")
        if "owner" in actuales and "owner" not in nuevos:
            if [u for u in await _propietarios_activos(conn) if u != user_id] == []:
                raise AccessError(409, "Debe quedar al menos un Propietario")
        await conn.execute("DELETE FROM app.user_roles WHERE user_id = $1", user_id)
        await conn.execute(
            """INSERT INTO app.user_roles (user_id, role_id, granted_by)
               SELECT $1, id, $3::uuid FROM app.roles WHERE code = ANY($2::text[])""",
            user_id, nuevos, actor["sub"])
        await log_change(conn, actor=actor["sub"], entity_type="USER_ROLE", entity_id=user_id,
                         action="set_roles", field="roles", old_value=actuales, new_value=nuevos)
    await invalidate_access(user_id)
    return nuevos


async def _validar_permisos(conn, actor: dict, permissions: list[str]) -> list[str]:
    pedidos = sorted(set(permissions))
    existentes = {r["code"] for r in await conn.fetch(
        "SELECT code FROM app.permissions WHERE code = ANY($1::text[])", pedidos)}
    if faltan := sorted(set(pedidos) - existentes):
        raise AccessError(422, f"Permisos inexistentes: {', '.join(faltan)}")
    if not _es_propietario(actor) and not set(pedidos) <= set(actor["permissions"]):
        raise AccessError(403, "No puedes dar permisos que no tienes")
    return pedidos


async def create_role(conn, actor: dict, code: str, name: str, description: str, permissions: list[str]) -> dict:
    async with conn.transaction():
        pedidos = await _validar_permisos(conn, actor, permissions)
        if await conn.fetchval("SELECT 1 FROM app.roles WHERE code = $1", code):
            raise AccessError(409, "Ya existe un rol con ese código")
        rid = await conn.fetchval(
            "INSERT INTO app.roles (code, name, description, created_by) VALUES ($1,$2,$3,$4::uuid) RETURNING id::text",
            code, name, description, actor["sub"])
        await conn.executemany("INSERT INTO app.role_permissions VALUES ($1::uuid, $2)", [(rid, p) for p in pedidos])
        await log_change(conn, actor=actor["sub"], entity_type="ROLE", entity_id=rid, action="create",
                         new_value={"code": code, "permissions": pedidos})
    return {"id": rid, "code": code, "name": name, "description": description, "permissions": pedidos}


async def update_role(conn, actor: dict, role_id: str, name: str | None, description: str | None,
                      permissions: list[str] | None) -> dict:
    async with conn.transaction():
        rol = await conn.fetchrow("SELECT code, name, description, is_system FROM app.roles WHERE id = $1::uuid FOR UPDATE", role_id)
        if rol is None:
            raise AccessError(404, "Rol no encontrado")
        if rol["is_system"]:
            raise AccessError(409, "Los roles de sistema no se editan")
        if permissions is not None:
            pedidos = await _validar_permisos(conn, actor, permissions)
            await conn.execute("DELETE FROM app.role_permissions WHERE role_id = $1::uuid", role_id)
            await conn.executemany("INSERT INTO app.role_permissions VALUES ($1::uuid, $2)", [(role_id, p) for p in pedidos])
        await conn.execute(
            "UPDATE app.roles SET name = COALESCE($2, name), description = COALESCE($3, description) WHERE id = $1::uuid",
            role_id, name, description)
        await log_change(conn, actor=actor["sub"], entity_type="ROLE", entity_id=role_id, action="update",
                         new_value={"name": name, "description": description, "permissions": permissions})
        afectados = [str(r["user_id"]) for r in await conn.fetch("SELECT user_id FROM app.user_roles WHERE role_id = $1::uuid", role_id)]
    for uid in afectados:
        await invalidate_access(uid)
    fila = await conn.fetchrow("SELECT id::text, code, name, description FROM app.roles WHERE id = $1::uuid", role_id)
    perms = [r["permission_code"] for r in await conn.fetch(
        "SELECT permission_code FROM app.role_permissions WHERE role_id = $1::uuid ORDER BY 1", role_id)]
    return {**dict(fila), "permissions": perms}


async def delete_role(conn, actor: dict, role_id: str) -> None:
    async with conn.transaction():
        rol = await conn.fetchrow("SELECT is_system FROM app.roles WHERE id = $1::uuid FOR UPDATE", role_id)
        if rol is None:
            raise AccessError(404, "Rol no encontrado")
        if rol["is_system"]:
            raise AccessError(409, "Los roles de sistema no se borran")
        if n := await conn.fetchval("SELECT count(*) FROM app.user_roles WHERE role_id = $1::uuid", role_id):
            raise AccessError(409, f"El rol está asignado a {n} persona(s): reasígnalas primero")
        await conn.execute("DELETE FROM app.roles WHERE id = $1::uuid", role_id)
        await log_change(conn, actor=actor["sub"], entity_type="ROLE", entity_id=role_id, action="delete")
```

- [ ] **Step 4: Implement `routers/access.py`**

```python
# app/routers/access.py
"""Acceso: mis permisos, el catálogo, roles y asignaciones (spec RBAC §6)."""
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from ..auth import get_current_user
from ..authz import Permission, require
from ..authz.permissions import PERMISSION_META
from ..db import get_pool
from ..services.access_admin import AccessError, create_role, delete_role, set_user_roles, update_role

router = APIRouter(tags=["access"])


def _http(e: AccessError) -> HTTPException:
    return HTTPException(e.status, e.message)


@router.get("/me")
async def me(pool=Depends(get_pool), user=Depends(get_current_user)):
    perfil = await pool.fetchrow("SELECT full_name, email, active FROM public.profiles WHERE id = $1", user["sub"])
    return {"id": user["sub"], "email": perfil["email"], "full_name": perfil["full_name"],
            "roles": user["roles"], "permissions": sorted(user["permissions"]), "aal": user["aal"]}


@router.get("/permissions")
async def list_permissions(_=Depends(require(Permission.USERS_MANAGE))):
    return [{"code": p.value, "area": m.area, "description": m.description, "privileged": m.privileged}
            for p, m in PERMISSION_META.items()]


@router.get("/roles")
async def list_roles(pool=Depends(get_pool), _=Depends(require(Permission.USERS_MANAGE))):
    filas = await pool.fetch(
        """SELECT r.id::text, r.code, r.name, r.description, r.is_system, r.grants_all,
                  COALESCE(array_agg(rp.permission_code ORDER BY rp.permission_code)
                           FILTER (WHERE rp.permission_code IS NOT NULL), '{}') AS permissions,
                  (SELECT count(*) FROM app.user_roles ur WHERE ur.role_id = r.id) AS assigned
           FROM app.roles r LEFT JOIN app.role_permissions rp ON rp.role_id = r.id
           GROUP BY r.id ORDER BY r.is_system DESC, r.name""")
    return [dict(f) for f in filas]


class RoleIn(BaseModel):
    code: str = Field(pattern=r"^[a-z][a-z0-9_]{2,40}$")
    name: str = Field(min_length=2)
    description: str = ""
    permissions: list[str] = Field(min_length=1)


class RolePatch(BaseModel):
    name: str | None = None
    description: str | None = None
    permissions: list[str] | None = None


class UserRolesIn(BaseModel):
    roles: list[str]


@router.post("/roles", status_code=201)
async def post_role(body: RoleIn, pool=Depends(get_pool), actor=Depends(require(Permission.ROLES_MANAGE))):
    async with pool.acquire() as conn:
        try:
            return await create_role(conn, actor, body.code, body.name, body.description, body.permissions)
        except AccessError as e:
            raise _http(e)


@router.patch("/roles/{role_id}")
async def patch_role(role_id: str, body: RolePatch, pool=Depends(get_pool), actor=Depends(require(Permission.ROLES_MANAGE))):
    async with pool.acquire() as conn:
        try:
            return await update_role(conn, actor, role_id, body.name, body.description, body.permissions)
        except AccessError as e:
            raise _http(e)


@router.delete("/roles/{role_id}", status_code=204)
async def remove_role(role_id: str, pool=Depends(get_pool), actor=Depends(require(Permission.ROLES_MANAGE))):
    async with pool.acquire() as conn:
        try:
            await delete_role(conn, actor, role_id)
        except AccessError as e:
            raise _http(e)
    return Response(status_code=204)


@router.put("/users/{user_id}/roles")
async def put_user_roles(user_id: str, body: UserRolesIn, pool=Depends(get_pool),
                         actor=Depends(require(Permission.USERS_MANAGE))):
    async with pool.acquire() as conn:
        try:
            return {"roles": await set_user_roles(conn, actor, user_id, body.roles)}
        except AccessError as e:
            raise _http(e)
```

En `main.py`: `from .routers.access import router as access_router` y `app.include_router(access_router, prefix="/api/v1")`; quitar `roles_router`.

En `routers/users.py`:
- `UserCreate.role: str` → `roles: list[str] = Field(min_length=1)`.
- La invitación escribe `role_codes` y, por compatibilidad hasta la Task 13, `role = legacy_role_for(roles)` (Task 1).
- Validación de escalada al crear: `set_user_roles` se aplica después de crear la cuenta en Auth (dentro del mismo `try`; si falla, se borra la cuenta recién creada y la invitación y se devuelve el error).
- `PATCH /users/{id}` (`active`, `full_name`): aplicar la regla 3 y 4 de la Task 9 al desactivar (usar un helper `assert_can_manage_user(conn, actor, user_id, deactivating: bool)` en `access_admin.py`, con test) y `invalidate_access(user_id)`.
- `DELETE /users/{id}`: mismas reglas 3 y 4.
- `GET /users` agrega `roles: list[str]` por persona (subconsulta a `app.user_roles`).

- [ ] **Step 5: Route tests**

```python
# tests/test_access_rutas.py
from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.db import get_pool
from app.routers.access import router
from tests.conftest import usuario


def _cliente(user):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    pool = MagicMock()
    pool.fetchrow = AsyncMock(return_value={"full_name": "Ana", "email": "ana@webcarga.com", "active": True})
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def test_me_devuelve_permisos():
    res = _cliente(usuario("operations_operator", aal="aal1")).get("/api/v1/me")
    assert res.status_code == 200
    assert "closures.sign" in res.json()["permissions"] and res.json()["roles"] == ["operations_operator"]


def test_catalogo_exige_gestionar_personas():
    assert _cliente(usuario("reader")).get("/api/v1/permissions").status_code == 403
    assert _cliente(usuario("admin")).get("/api/v1/permissions").status_code == 200


def test_crear_rol_exige_aal2():
    res = _cliente(usuario("admin", aal="aal1")).post("/api/v1/roles", json={
        "code": "custom_x", "name": "X", "permissions": ["operations.read"]})
    assert res.status_code == 403 and "dos pasos" in res.json()["detail"]
```

- [ ] **Step 6: Run** `venv/bin/python -m pytest tests/test_access_admin_integracion.py tests/test_access_rutas.py tests/test_alta_y_baja_de_usuarios.py -q -p no:cacheprovider` → PASS (actualizar `test_alta_y_baja_de_usuarios.py` a `roles: [...]` y a `usuario(...)`).
- [ ] **Step 7: Commit** `feat(authz): administracion de acceso (roles, asignaciones, /me)`.

---

### Task 10: Frontend — `GET /me`, `can()` y códigos generados

**Files:**
- Create: `monitor-app/backend/api/scripts/generar_permisos_ts.py`, `monitor-app/backend/api/tests/test_permisos_ts_en_sincronia.py`
- Create: `monitor-app/frontend/lib/authz/permisos.generated.ts`, `monitor-app/frontend/lib/authz/acceso.ts`, `monitor-app/frontend/lib/authz/PermisosProvider.tsx`, `monitor-app/frontend/lib/authz/PermisosProvider.test.tsx`
- Modify: `monitor-app/frontend/app/dashboard/layout.tsx`, `monitor-app/frontend/app/dashboard/admin/layout.tsx`, `monitor-app/frontend/components/dashboard/Sidebar.tsx`, `monitor-app/frontend/app/dashboard/providers.tsx`, los 17 llamadores de `useCanEdit/useCanAdmin`, `monitor-app/frontend/lib/permisos.test.ts`
- Delete: `monitor-app/frontend/hooks/useRolMinimo.ts`, `useCanEdit.ts`, `useCanAdmin.ts`; `hasRole` y `canManage` de `lib/types.ts`

**Interfaces:**
- Consumes: `GET /api/v1/me` (Task 9).
- Produces: `type PermissionCode` (union generada), `type Acceso = { id; email; full_name; roles: string[]; permissions: PermissionCode[]; aal: 'aal1'|'aal2'|null }`, `obtenerAccesoServidor(): Promise<Acceso | null>`, `<PermisosProvider acceso={...}>`, `usePermiso(p: PermissionCode): boolean`, `useAcceso(): Acceso`.

- [ ] **Step 1: Generator + sync test (backend)**

```python
# scripts/generar_permisos_ts.py
"""Genera frontend/lib/authz/permisos.generated.ts desde el catálogo.
Uso: venv/bin/python scripts/generar_permisos_ts.py"""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.authz.permissions import PERMISSION_META  # noqa: E402

DESTINO = Path(__file__).resolve().parents[3] / "frontend/lib/authz/permisos.generated.ts"


def contenido() -> str:
    lineas = [
        "// GENERADO por backend/api/scripts/generar_permisos_ts.py desde app/authz/permissions.py.",
        "// No editar a mano: el test test_permisos_ts_en_sincronia.py falla si queda desfasado.",
        "export const PERMISOS = {",
    ]
    for p, m in PERMISSION_META.items():
        lineas.append(f"  '{p.value}': {{ area: '{m.area}', privileged: {str(m.privileged).lower()} }},")
    lineas += ["} as const", "", "export type PermissionCode = keyof typeof PERMISOS", ""]
    return "\n".join(lineas)


if __name__ == "__main__":
    DESTINO.write_text(contenido())
    print(f"escrito {DESTINO}")
```

```python
# tests/test_permisos_ts_en_sincronia.py
from scripts.generar_permisos_ts import DESTINO, contenido


def test_el_archivo_del_frontend_esta_al_dia():
    assert DESTINO.read_text() == contenido(), "Correr: venv/bin/python scripts/generar_permisos_ts.py"
```

Run el script y el test → PASS.

- [ ] **Step 2: `acceso.ts` (server) y `PermisosProvider.tsx` (client)**

```ts
// lib/authz/acceso.ts
import type { PermissionCode } from './permisos.generated'

export type Acceso = {
  id: string
  email: string
  full_name: string | null
  roles: string[]
  permissions: PermissionCode[]
  aal: 'aal1' | 'aal2' | null
}

/** GET /me desde un server component, con el token de la sesión (mismo
 *  criterio que el proxy /api/v1). null = sin acceso (403) o sin sesión. */
export async function obtenerAccesoServidor(): Promise<Acceso | null> {
  const { cookies } = await import('next/headers')
  const { createServerClient } = await import('@supabase/ssr')
  const cookieStore = await cookies()
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => cookieStore.getAll(), setAll() {} },
  })
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null
  const base = (process.env.FASTAPI_URL ?? 'http://localhost:8001').trim()
  const res = await fetch(`${base}/api/v1/me`, {
    headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store',
  })
  if (!res.ok) return null
  return res.json()
}
```

```tsx
// lib/authz/PermisosProvider.tsx
'use client'

import { createContext, useContext } from 'react'
import type { Acceso } from './acceso'
import type { PermissionCode } from './permisos.generated'

const Contexto = createContext<Acceso | null>(null)

/** Los permisos de la persona, tal como los calcula la API (GET /me). El
 *  layout del dashboard los obtiene una vez en el servidor; ninguna pantalla
 *  repite reglas de rol. */
export function PermisosProvider({ acceso, children }: { acceso: Acceso; children: React.ReactNode }) {
  return <Contexto.Provider value={acceso}>{children}</Contexto.Provider>
}

export function useAcceso(): Acceso {
  const acceso = useContext(Contexto)
  if (!acceso) throw new Error('useAcceso fuera de PermisosProvider')
  return acceso
}

export function usePermiso(permiso: PermissionCode): boolean {
  return useAcceso().permissions.includes(permiso)
}
```

```tsx
// lib/authz/PermisosProvider.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PermisosProvider, usePermiso } from './PermisosProvider'

function Muestra() {
  return <span>{usePermiso('closures.sign') ? 'puede' : 'no puede'}</span>
}
const base = { id: 'u', email: 'a@b.c', full_name: null, roles: [], aal: 'aal1' as const }

describe('usePermiso', () => {
  it('responde con los permisos que dio la API', () => {
    render(<PermisosProvider acceso={{ ...base, permissions: ['closures.sign'] }}><Muestra /></PermisosProvider>)
    expect(screen.getByText('puede')).toBeInTheDocument()
  })
  it('sin el permiso, no', () => {
    render(<PermisosProvider acceso={{ ...base, permissions: ['operations.read'] }}><Muestra /></PermisosProvider>)
    expect(screen.getByText('no puede')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Layouts**
  - `app/dashboard/layout.tsx`: reemplazar la lectura de `profiles` por `const acceso = await obtenerAccesoServidor()`; `if (!acceso) redirect('/auth/access-denied?reason=not-invited')`; MFA: `privilegiado = acceso.permissions.some(p => PERMISOS[p].privileged)`; si `privilegiado && nivel?.nextLevel !== 'aal2'` → `/auth/mfa/setup`. Envolver `children` en `<PermisosProvider acceso={acceso}>`. `Sidebar`/`Topbar` reciben `acceso` en vez de `role`.
  - `app/dashboard/admin/layout.tsx`: permitir si tiene alguno de `users.manage`, `roles.manage`, `settings.manage`, `operations.configure`, `certification.configure`, `insurance.configure`; cada sección de Configuración oculta lo que no le corresponde (`NavDominios` filtra por permiso).
  - `Sidebar.tsx`: `canAdmin` → "ve Configuración" = la misma condición del layout de admin (helper `puedeVerConfiguracion(acceso)` en `lib/authz/acceso.ts`, con test).

- [ ] **Step 4: Reemplazar los 17 llamadores** — regla: **el permiso de la pantalla es el de la ruta que llama el botón**.

| Archivo | Hoy | Permiso |
|---|---|---|
| `app/dashboard/compliance/page.tsx` | `useCanEdit` | `documents.upload` |
| `app/dashboard/compliance/[carrierId]/page.tsx` | `useCanEdit` / `useCanAdmin` (dar de baja) | `documents.upload` (subir, corregir fecha) / `directory.delete` |
| `components/compliance/PuenteALaBandeja.tsx`, `CarrierDrawer.tsx`, `TriageWorkbench.tsx`, `components/dashboard/TransporterDocumentsPanel.tsx` | `useCanEdit` | `documents.upload` (aprobar/rechazar dentro de ellos: `documents.review`) |
| `app/dashboard/operations/monitor/page.tsx` | `useCanEdit` (asignar conductor) | `trips.edit_sensitive` |
| `app/dashboard/operations/closures/page.tsx` | `useCanAdmin` (override, reabrir) | `closures.sign` |
| `app/dashboard/carriers/page.tsx`, `carriers/[id]/page.tsx` | `useCanEdit` / `useCanAdmin` | `directory.edit` / `directory.delete` |
| `app/dashboard/insurance/page.tsx` | `useCanEdit` / `useCanAdmin` | `policies.edit` / `policies.delete` |
| `app/dashboard/admin/settings/EstadoPanel.tsx`, `estados-*` | `useCanAdmin` | `operations.configure` |
| `app/dashboard/admin/settings/CondicionPanel.tsx`, `condiciones-tabla.tsx` | `useCanAdmin` | `certification.configure` |

  Verificar cada fila abriendo el handler del botón y la ruta que llama; si difiere de la tabla, manda la ruta.

- [ ] **Step 5: Guard test del frontend** — reescribir `lib/permisos.test.ts`:

```ts
// @vitest-environment node
/** Los permisos de la pantalla vienen de la API (GET /me). Ninguna pantalla
 *  decide por rol: no hay jerarquía ni nombres de rol en el código. */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = join(__dirname, '..')
function recorrer(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.startsWith('.')) recorrer(ruta, acc) }
    else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.') && !e.name.endsWith('.generated.ts')) acc.push(ruta)
  }
  return acc
}

describe('autorización en el frontend', () => {
  it('nadie decide por nombre de rol', () => {
    const malos = ['app', 'components', 'hooks', 'lib'].flatMap(d => recorrer(join(RAIZ, d)))
      .filter(f => /hasRole\(|useRolMinimo|useCanEdit|useCanAdmin|\.from\('profiles'\)\.select\('role/.test(readFileSync(f, 'utf8')))
    expect(malos).toEqual([])
  })
})
```

- [ ] **Step 6: Run** `npx vitest run && npx tsc --noEmit && npm run build` → verde.
- [ ] **Step 7: Commit** `feat(authz): el frontend consulta permisos (GET /me, usePermiso)`.

---

### Task 11: Borrar la escalera vieja (backend) y desplegar API + frontend

**Files:**
- Modify: `monitor-app/backend/api/app/auth.py` (borrar `require_writer`, `require_editor`, `require_admin`, `EDITOR_ROLES`, `ADMIN_ROLES`, `WRITER_ROLES`)
- Modify: tests que todavía importen esos nombres (los 29 archivos detectados): reemplazar `dependency_overrides[require_*]` por `dependency_overrides[get_current_user] = lambda: usuario(<rol>)`.

- [ ] **Step 1:** `grep -rn "require_writer\|require_editor\|require_admin\|EDITOR_ROLES\|ADMIN_ROLES\|WRITER_ROLES\|ROLE_ORDER" monitor-app/backend/api` → solo debe aparecer en `auth.py`. Borrarlos de `auth.py`, y quitar la clave `"role"` del usuario que devuelve `get_current_user` y del helper `usuario()` de `tests/conftest.py`.
- [ ] **Step 2:** `grep` de nuevo → 0 resultados.
- [ ] **Step 3:** Suite backend completa (`venv/bin/python -m pytest tests/ -q -p no:cacheprovider`, ~25 min, en segundo plano). Rojo preexistente admitido: `test_cargar_catalogo_webcarga.py::test_aplicar_crea_los_nuevos_apagados_y_sin_sembrar`.
- [ ] **Step 4:** Suite frontend completa + `tsc` + `build`.
- [ ] **Step 5:** Commit `refactor(authz): se retira la escalera de roles` y push a `dev`; esperar Deploy Monitor API y Deploy Frontend en verde (`gh run watch`).
- [ ] **Step 6:** Verificación en dev:
  - `curl` sin token a 5 rutas → 401.
  - Playwright con la cuenta owner: entra (MFA), ve Configuración › Personas y accesos, Monitor, Cierre.
  - Consulta de solo lectura: cada persona tiene en `GET /me` (o por SQL de `effective.py`) los permisos esperados por `LEGACY_ROLE_MAP`.

---

### Task 12: Pantallas de Personas y Roles

**Files:**
- Create: maquetas en `monitor-app/docs/mockups/2026-10-roles/` (skill `mockups`), `monitor-app/frontend/app/dashboard/admin/settings/roles-tab.tsx` (+ test), `monitor-app/frontend/components/admin/RolChips.tsx` (+ test), `monitor-app/frontend/lib/api/access.ts`
- Modify: `monitor-app/frontend/components/admin/UsersTable.tsx`, `CreateUserForm.tsx`, `monitor-app/frontend/app/dashboard/admin/settings/usuarios-tab.tsx`

**Interfaces:**
- Consumes: `GET /permissions`, `GET /roles`, `POST/PATCH/DELETE /roles`, `PUT /users/{id}/roles`, `POST /users {roles}` (Task 9); `usePermiso` (Task 10).
- Produces: `accessApi = { permissions(), roles(), createRole(body), updateRole(id, body), deleteRole(id), setUserRoles(userId, roles) }`.

- [ ] **Step 1: Maquetas primero** (gate): Personas (fila con chips de roles, Propietario destacado, último ingreso/MFA), editor de roles de una persona (chips agrupados por área, deshabilitados los que el actor no puede dar, con el motivo), pestaña Roles (lista sistema/personalizados, detalle de permisos por área, crear/editar personalizado). Estados: cargando, vacío, error, 403, 409 "último Propietario". Contrastar con GitHub (Organization roles), Linear (Members) y Notion (Members & groups). **Aprobación del usuario antes del Step 2.**
- [ ] **Step 2: Tests de componentes** (vitest): `RolChips` muestra los roles, deshabilita los que exceden los permisos del actor, `PUT` con la lista nueva; error 409 visible con el mensaje de la API; `roles-tab` muestra los de sistema sin acciones de edición y permite crear uno personalizado solo con permisos que el actor tiene.
- [ ] **Step 3: Implementar** según la maqueta aprobada (tokens del sistema visual, sin color crudo, rutas en inglés, textos en español neutral).
- [ ] **Step 4:** `CreateUserForm`: selector de roles (multi) en lugar de rol único; `mensajeDeAcceso` nombra los roles.
- [ ] **Step 5:** `npx vitest run && npx tsc --noEmit && npm run build`; Playwright en dev: crear rol personalizado, asignarlo, intentar dejar sin Propietario (ver 409).
- [ ] **Step 6:** Commit `feat(admin): personas con roles y pestaña de roles`.

---

### Task 13: Contract (con compuerta)

**Files:**
- Create: `monitor-app/backend/supabase/migrations/2026101XXXXXXX_rbac_contract.sql`
- Modify: `monitor-app/backend/api/app/routers/users.py` (dejar de escribir `admin_whitelist.role` y `profiles.role`), `public.handle_new_user` (sin `role`)

- [ ] **Step 1: Compuerta.** Confirmar con el usuario que `webcarga-monitor-api` (rama `main`) se desplegó con este código o se apagó. Sin eso, **no** seguir (la API de `main` lee `profiles.role`).
- [ ] **Step 2:** Migración:

```sql
-- Retira la escalera vieja (spec RBAC §9, etapa contract). Requiere que ninguna
-- API lea profiles.role (verificado con grep en main y dev).
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_codes text[];
BEGIN
  SELECT role_codes INTO v_codes FROM public.admin_whitelist WHERE email = lower(NEW.email);
  IF v_codes IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.profiles (id, full_name, email) VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.email);
  INSERT INTO app.user_roles (user_id, role_id) SELECT NEW.id, r.id FROM app.roles r WHERE r.code = ANY(v_codes);
  RETURN NEW;
END;
$$;
ALTER TABLE public.admin_whitelist DROP COLUMN role;
ALTER TABLE public.profiles DROP COLUMN role;
```

- [ ] **Step 3:** Ensayo con ROLLBACK (verificar que `is_admin()` y las políticas de `profiles` no referencian `role`; si `is_admin()` lo usa, redefinirla sobre `app.user_roles` en la misma migración).
- [ ] **Step 4:** Aplicar, desplegar el cambio de `users.py`, suite completa, commit `chore(db): retira profiles.role (RBAC contract)`.

---

## Verificación final

- `test_toda_ruta_declara_permiso.py` y `test_matriz_roles.py` en verde.
- Ninguna referencia a la escalera vieja en backend ni frontend (`grep` de la Task 11 y `lib/permisos.test.ts`).
- Las 12 cuentas con sus permisos esperados; WebCarga nombra su segundo Propietario; la cuenta de Sumadots pasa a Soporte técnico.
- AGENTLOG actualizado con lo hecho y la compuerta de la Task 13.
