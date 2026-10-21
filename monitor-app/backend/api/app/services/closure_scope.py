"""El alcance del Cierre: Tractoreo o Equipo Completo (spec 2026-10-16, D1 y D6).

Un tracto es de un alcance por el tipo de operación que declara el Directorio
(`public.assets.webcarga_operation_type_id` → `app.status_taxonomies.code`). El
código del catálogo es el identificador estable (no se edita desde la app; la
etiqueta sí) y se escribe SOLO aquí: el roster, las líneas del cierre, el
reporte, los viajes y los avisos de Pendientes lo leen de este módulo.

Un VIAJE tiene su propio tipo (plan 2026-10-21): lo declarado por Operaciones, o el
del cliente si trabaja con uno solo, o el del tracto. La regla vive en la base
(`app.v_trip_fleet_resolution.resolved_operation_type_id`); aquí solo se traduce a
alcance con `operation_type_join`. `tractor_scope_join` queda para lo que es del
equipo (el tracto mismo). Sin tipo, el alcance es `None` y se ve en los dos."""
from __future__ import annotations

# alcance (lo que viaja en la API y la URL) → código del catálogo de tipos de operación
OPERATION_TYPE_CODE: dict[str, str] = {"tractoreo": "TRACTOREO", "equipo_completo": "EQUIPO_COMPLETO"}
TRACTOREO = OPERATION_TYPE_CODE["tractoreo"]
EQUIPO_COMPLETO = OPERATION_TYPE_CODE["equipo_completo"]
_ALCANCE_DE_CODIGO = {code: scope for scope, code in OPERATION_TYPE_CODE.items()}


def scope_of_code(code: str | None) -> str | None:
    return _ALCANCE_DE_CODIGO.get(code) if code else None


def is_scope_sql(taxonomy_alias: str, scope: str) -> str:
    """`<alias>.code = '<CÓDIGO>'` para el alcance dado (el alias es el de status_taxonomies)."""
    return f"{taxonomy_alias}.code = '{OPERATION_TYPE_CODE[scope]}'"


def scope_sql(taxonomy_alias: str) -> str:
    """El alcance de un tipo de operación, o NULL si no es de ninguno."""
    ramas = " ".join(f"WHEN '{code}' THEN '{scope}'" for scope, code in OPERATION_TYPE_CODE.items())
    return f"(CASE {taxonomy_alias}.code {ramas} END)"


def operation_type_join(type_id_expr: str, alias: str) -> str:
    """LEFT JOIN de un tipo de operación ya resuelto (p. ej. el del viaje): deja `<alias>`
    como status_taxonomies. Sin tipo, `<alias>.code` es NULL y el alcance también."""
    return f"LEFT JOIN app.status_taxonomies {alias} ON {alias}.id = ({type_id_expr})::uuid"


def tractor_scope_join(asset_id_expr: str, alias: str) -> str:
    """LEFT JOIN del tracto y su tipo de operación: deja `<alias>` como status_taxonomies.
    Sin tracto (expresión NULL), `<alias>.code` es NULL y el alcance también."""
    return (
        f"LEFT JOIN public.assets {alias}_asset ON {alias}_asset.id = ({asset_id_expr})::uuid "
        f"LEFT JOIN app.status_taxonomies {alias} ON {alias}.id = {alias}_asset.webcarga_operation_type_id"
    )
