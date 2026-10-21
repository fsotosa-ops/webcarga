"""La zona del destino de un viaje (RM, Z0, Región, Sin clasificar) y el tipo de operación de un local.

Las reglas viven en la base (migración 20261101090000, diseño de Analítica del 21/10): la analítica en dbt las
necesita iguales y un modelo de dbt no puede importar Python. Aquí solo se llaman, en lote:
  - app.location_operation_type(cliente, local): el tipo de un local del cliente (RM, Z0, Region Norte/Sur),
    por número de local y nombre, sin cruzar clientes.
  - app.operation_type_zone(tipo): su zona.
  - app.trip_last_destination_local(viaje): el último destino VIGENTE (app.trips.stops), no una versión vieja de
    trip_stops.
  - app.trip_destination_zone(viaje): las tres juntas.
La usan el Monitor (tipo de operación de cada parada), el Reporte del día y las pestañas del Cierre: un mismo
viaje no puede tener una zona distinta según la pantalla."""
from collections.abc import Iterable

# Las zonas del Reporte y del Cierre, en el orden en que se muestran.
ZONES = ("RM", "Z0", "Región", "Sin clasificar")


def last_destination_sql(trip_alias: str) -> str:
    """El último destino vigente de un viaje (el local que decide su zona), como expresión."""
    return f"app.trip_last_destination_local({trip_alias}.id)"


def _pares(pares: Iterable[tuple[str | None, str | None]]) -> tuple[list[str | None], list[str | None]]:
    unicos = sorted(set(pares), key=lambda p: (p[0] or "", p[1] or ""))
    return [s for s, _ in unicos], [l for _, l in unicos]


async def operation_types_by_local(pool, pares: Iterable[tuple[str | None, str | None]]) -> dict:
    """(shipper_id, local) → tipo de operación del local, o None. Un solo pedido a la base."""
    shippers, locales = _pares(pares)
    if not shippers:
        return {}
    filas = await pool.fetch(
        """
        SELECT u.s AS shipper_id, u.l AS local, app.location_operation_type(u.s::uuid, u.l) AS operation_type
        FROM unnest($1::text[], $2::text[]) AS u(s, l)
        """,
        shippers, locales,
    )
    return {(f["shipper_id"], f["local"]): f["operation_type"] for f in filas}


async def zones_by_destination(pool, destinos: Iterable[tuple[str | None, str | None]]) -> dict:
    """(shipper_id, último destino) → zona, para un lote: un solo pedido a la base."""
    shippers, locales = _pares(destinos)
    if not shippers:
        return {}
    filas = await pool.fetch(
        """
        SELECT u.s AS shipper_id, u.l AS local,
               app.operation_type_zone(app.location_operation_type(u.s::uuid, u.l)) AS zone
        FROM unnest($1::text[], $2::text[]) AS u(s, l)
        """,
        shippers, locales,
    )
    return {(f["shipper_id"], f["local"]): f["zone"] for f in filas}


async def trip_zones(pool, trip_ids: Iterable[str]) -> dict[str, str]:
    """Viaje → zona de su destino. Los viajes que no existen no aparecen."""
    ids = sorted({str(t) for t in trip_ids if t})
    if not ids:
        return {}
    filas = await pool.fetch(
        "SELECT t.id::text AS trip_id, app.trip_destination_zone(t.id) AS zone FROM app.trips t WHERE t.id = ANY($1::uuid[])",
        ids,
    )
    return {f["trip_id"]: f["zone"] for f in filas}
