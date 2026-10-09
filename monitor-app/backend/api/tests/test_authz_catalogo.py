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


def test_lo_que_hoy_es_solo_de_admin_queda_en_administracion():
    """Chequeos que vivían dentro de los servicios (ADMIN_ROLES): forzar el
    cierre con pendientes y eliminar viajes manuales de otra persona. Se
    conservan en Administración: nadie gana ni pierde (spec §9)."""
    admin = next(r for r in SYSTEM_ROLES if r.code == "admin")
    assert {Permission.CLOSURES_OVERRIDE, Permission.TRIPS_DELETE_ANY} <= admin.permissions
    for r in SYSTEM_ROLES:
        if r.code not in ("admin", "owner"):
            assert Permission.CLOSURES_OVERRIDE not in r.permissions, r.code
            assert Permission.TRIPS_DELETE_ANY not in r.permissions, r.code
