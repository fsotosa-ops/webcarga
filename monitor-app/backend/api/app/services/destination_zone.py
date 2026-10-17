"""La zona del destino de un viaje (RM, Z0, Región, Sin clasificar), en un solo lugar.

El tipo de operación de un local sale del catálogo de lugares del cliente
(`public.locations.operation_type`), resuelto por número de local y nombre; la zona
agrupa esos tipos. La usan el Monitor (tipo de operación de cada parada), el Reporte
del día y las pestañas del Cierre (Flota del día, Viajes, Pendientes): así un mismo
viaje no puede tener una zona distinta según la pantalla.

Las funciones vivían en `routers/trips.py` y el Reporte las importaba de ese router;
se movieron aquí sin cambios cuando el Cierre también las necesitó (16/10)."""
import re
import unicodedata
from collections.abc import Iterable

LOCAL_NUMBER_PATTERN = re.compile(r"^(.*?)\s*-\s*(\d+)\s*$")


def split_local(local: str | None) -> tuple[str | None, str | None]:
    """Extrae (nombre, número) de un string de local tipo "ALAMEDA - 72"
    (patrón real de stops[].local para Walmart). Si no matchea (ej. los CDs
    de origen: "CD LO AGUIRRE", que nunca traen número) el string completo
    se trata como nombre, sin número — resuelve por nombre solo."""
    if not local:
        return None, None
    local = local.strip()
    m = LOCAL_NUMBER_PATTERN.match(local)
    if m:
        return m.group(1).strip(), m.group(2)
    return local, None


def normalize_location_name(name: str) -> str:
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", name).strip().upper()


async def load_operation_type_buckets(pool, shipper_ids: set[str]) -> dict:
    """shipper_id -> {"by_number": {site_number: [(nombre_norm, operation_type)]},
    "by_name": {nombre_norm: operation_type}} — resuelve operation_type contra
    public.locations, siempre scopeado por shipper (nunca un lookup global de
    site_number, que sería ambiguo si dos shippers reusan el mismo número)."""
    if not shipper_ids:
        return {}
    rows = await pool.fetch(
        """
        SELECT s.id::text AS shipper_id, l.name, l.site_number, l.operation_type
        FROM public.locations l
        JOIN public.shippers s ON s.id = l.entity_id AND l.entity_type = 'SHIPPER'
        WHERE s.id = ANY($1::uuid[])
          AND l.operational_status = 'ACTIVE' AND l.operation_type IS NOT NULL
        """,
        list(shipper_ids),
    )
    buckets: dict = {}
    for r in rows:
        bucket = buckets.setdefault(r["shipper_id"], {"by_number": {}, "by_name": {}})
        norm_name = normalize_location_name(r["name"])
        if r["site_number"]:
            bucket["by_number"].setdefault(r["site_number"], []).append((norm_name, r["operation_type"]))
        bucket["by_name"].setdefault(norm_name, r["operation_type"])
    return buckets


def resolve_operation_type(bucket: dict | None, local: str | None) -> str | None:
    """Resuelve primero por número (clave más exacta cuando existe); si el
    número aparece más de una vez para el shipper (pasa en 3/490 casos
    reales — ver plan maestro H2.6), desempata por nombre normalizado.
    Sin número (o sin match), cae a lookup por nombre solo."""
    if not bucket or not local:
        return None
    name, number = split_local(local)
    if number:
        candidates = bucket["by_number"].get(number, [])
        if len(candidates) == 1:
            return candidates[0][1]
        if len(candidates) > 1:
            if name:
                norm = normalize_location_name(name)
                for cand_name, op in candidates:
                    if cand_name == norm:
                        return op
                # El nombre que reporta el TMS a veces trae el formato como
                # prefijo (ej. parada real "SBA San Bernardo Eucaliptus" vs
                # nombre maestro "San Bernardo Eucaliptus", formato "SBA"
                # aparte) — contención en cualquier sentido, verificado en
                # vivo contra un viaje real 2026-07-17. Solo se acepta si
                # desambigua a un único candidato.
                contained = [op for cand_name, op in candidates if cand_name in norm or norm in cand_name]
                if len(contained) == 1:
                    return contained[0]
            return None
    if name:
        return bucket["by_name"].get(normalize_location_name(name))
    return None


# Las zonas del Reporte y del Cierre, en el orden en que se muestran.
ZONES = ("RM", "Z0", "Región", "Sin clasificar")


def zone_of(operation_type: str | None) -> str:
    """El tipo de operación de un local, agrupado en su zona."""
    if operation_type == "RM":
        return "RM"
    if operation_type == "Z0":
        return "Z0"
    if operation_type in ("Region Norte", "Region Sur"):
        return "Región"
    return "Sin clasificar"


def last_destination_sql(trip_alias: str) -> str:
    """El último destino de un viaje (el local que decide su zona), como subconsulta."""
    return f"""(
        SELECT ts.local FROM app.trip_stops ts
        WHERE ts.trip_id = {trip_alias}.id AND ts.stop_type = 'DESTINATION'
        ORDER BY ts.stop_order DESC LIMIT 1
    )"""


async def zones_by_destination(pool, destinos: Iterable[tuple[str | None, str | None]]) -> dict:
    """(shipper_id, último destino) → zona, para un lote: un solo pedido al catálogo."""
    destinos = list(destinos)
    buckets = await load_operation_type_buckets(pool, {s for s, _ in destinos if s})
    return {(s, local): zone_of(resolve_operation_type(buckets.get(s), local)) for s, local in destinos}


async def trip_zones(pool, trip_ids: Iterable[str]) -> dict[str, str]:
    """Viaje → zona de su destino. Los viajes que no existen no aparecen."""
    ids = sorted({str(t) for t in trip_ids if t})
    if not ids:
        return {}
    filas = await pool.fetch(
        f"""
        SELECT t.id::text AS trip_id, t.shipper_id::text AS shipper_id,
               {last_destination_sql('t')} AS last_destination_local
        FROM app.trips t
        WHERE t.id = ANY($1::uuid[])
        """,
        ids,
    )
    zonas = await zones_by_destination(pool, ((f["shipper_id"], f["last_destination_local"]) for f in filas))
    return {f["trip_id"]: zonas[(f["shipper_id"], f["last_destination_local"])] for f in filas}
