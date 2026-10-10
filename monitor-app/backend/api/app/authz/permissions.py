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
    TRIPS_DELETE_ANY = "trips.delete_any"
    CLOSURES_DECLARE = "closures.declare"
    CLOSURES_SIGN = "closures.sign"
    CLOSURES_OVERRIDE = "closures.override"
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
    P.TRIPS_DELETE: PermissionMeta("operations", "Eliminar los viajes manuales que creó uno mismo"),
    P.TRIPS_DELETE_ANY: PermissionMeta("operations", "Eliminar viajes manuales creados por otra persona"),
    P.CLOSURES_DECLARE: PermissionMeta("operations", "Declarar motivos en el cierre del día"),
    P.CLOSURES_SIGN: PermissionMeta("operations", "Firmar y reabrir el cierre del día"),
    P.CLOSURES_OVERRIDE: PermissionMeta("operations", "Firmar el cierre del día con pendientes"),
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
    # CLOSURES_OVERRIDE y TRIPS_DELETE_ANY: hoy solo admin (chequeos que vivían
    # en services/cierre_lineas.py y services/eliminar_viajes.py); se conservan acá.
    _rol("admin", "Administración", "Gestiona personas, roles y la configuración general.",
         P.USERS_MANAGE, P.ROLES_MANAGE, P.SETTINGS_MANAGE, P.CLOSURES_OVERRIDE, P.TRIPS_DELETE_ANY),
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

# Registro histórico de la migración desde la escalera vieja (spec §9; la
# columna profiles.role se borró en el contract, Task 13, con respaldo en
# app.rbac_legacy_roles). Nadie perdió; la única ganancia aprobada fue
# *.configure para los Supervisores (los editor de entonces).
LEGACY_ROLE_MAP: dict[str, tuple[str, ...]] = {
    "owner": ("owner",),
    "admin": ("admin", "operations_supervisor", "certification_supervisor",
              "insurance_supervisor", "commercial_supervisor"),
    "editor": ("operations_supervisor", "certification_supervisor",
               "insurance_supervisor", "commercial_supervisor"),
    "writer": ("operations_operator",),
    "viewer": ("reader",),
}

