"""La consulta de Analítica: período, filtros, búsqueda, orden y página, en el servidor (HU Analítica, criterios
3 a 5).

El SQL se arma SOLO con expresiones del catálogo (services/analytics_columns.py); todo valor que llega del usuario
va como parámetro. Un id que no está en el catálogo (o una columna personal sin el permiso) es 422."""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date
from typing import Literal

from urllib.parse import unquote

from fastapi import HTTPException

from .analytics_columns import DATE_FIELDS, TABLES, AnalyticsColumn, columns_for

Purpose = Literal["rows", "export", "pivot"]

PAGE_SIZES = (50, 100, 200)
EXPORT_MAX_ROWS = 50_000
PIVOT_MAX_ROWS = 20_000
MAX_PERIOD_DAYS = 400
COUNTS_LIMIT = 200
# 400 días de viajes caben de sobra; más allá, un número de página es un error (desbordaba el OFFSET).
MAX_PAGE = 100_000

# La búsqueda de la barra: qué columnas mira en cada conjunto.
SEARCH: dict[str, tuple[str, ...]] = {
    "trips": ("trip_code", "tractor_plate", "carrier_name"),
    "fleet": ("license_plate", "carrier_name"),
}
DEFAULT_SORT: dict[str, str] = {"trips": "r.planning_date DESC, r.trip_code", "fleet": "r.business_date DESC, r.fleet_day_key"}
ROW_ID: dict[str, str] = {"trips": "r.trip_id::text", "fleet": "r.fleet_day_key"}


@dataclass(frozen=True)
class AnalyticsRequest:
    dataset: str
    date_from: date
    date_to: date
    date_field: str
    filters: dict[str, list[str]] = field(default_factory=dict)
    q: str = ""
    sort: tuple[str, Literal["asc", "desc"]] | None = None
    page: int = 0
    size: int = 50
    purpose: Purpose = "rows"


def _422(msg: str) -> HTTPException:
    return HTTPException(422, msg)


def _fecha(valor: str | None, nombre: str) -> date:
    try:
        return date.fromisoformat(valor or "")
    except ValueError:
        raise _422(f"Fecha inválida en «{nombre}» (formato AAAA-MM-DD)")


def parse_request(params: Mapping[str, str], *, purpose: Purpose) -> AnalyticsRequest:
    """Lee la URL con los nombres del kit de tabla (`f.<id>`, `q`, `sort=id:dir`) más dataset, from, to, date,
    page y size. No mira permisos: las columnas personales se validan en `build_select`."""
    dataset = params.get("dataset", "trips")
    if dataset not in TABLES:
        raise _422(f"Conjunto de datos desconocido: «{dataset}»")
    todas = {c.id: c for c in columns_for(dataset, personal=True)}

    date_from, date_to = _fecha(params.get("from"), "from"), _fecha(params.get("to"), "to")
    if date_from > date_to:
        raise _422("El período empieza después de terminar")
    if (date_to - date_from).days + 1 > MAX_PERIOD_DAYS:
        raise _422(f"El período no puede tener más de {MAX_PERIOD_DAYS} días")

    campos = DATE_FIELDS[dataset]
    date_field = params.get("date") or next(iter(campos))
    if date_field not in campos:
        raise _422(f"Fecha desconocida: «{date_field}»")

    filters: dict[str, list[str]] = {}
    for clave, valor in params.items():
        if not clave.startswith("f."):
            continue
        col = todas.get(clave[2:])
        if col is None or col.filter != "values":
            raise _422(f"No se puede filtrar por «{clave[2:]}»")
        # Cada valor viene codificado (como `writeView` en el frontend): una coma dentro de un valor no lo parte.
        valores = [unquote(v) for v in valor.split(",") if v != ""]
        if valores:
            filters[col.id] = valores

    sort = None
    if params.get("sort"):
        col_id, _, direccion = params["sort"].partition(":")
        if col_id not in todas or direccion not in ("asc", "desc"):
            raise _422(f"Orden inválido: «{params['sort']}»")
        sort = (col_id, direccion)

    try:
        page = int(params.get("page", "0"))
        size = int(params.get("size", "50"))
    except ValueError:
        raise _422("Página o tamaño inválidos")
    if not 0 <= page <= MAX_PAGE:
        raise _422("Página inválida")
    if purpose == "rows" and size not in PAGE_SIZES:
        raise _422(f"Tamaño de página inválido: {size}")
    if purpose == "pivot" and (dataset != "fleet" or not 1 <= size <= PIVOT_MAX_ROWS):
        raise _422("La tabla dinámica es de Flota por día, hasta 20.000 filas")
    if purpose == "export":
        page, size = 0, EXPORT_MAX_ROWS

    return AnalyticsRequest(dataset, date_from, date_to, date_field, filters, (params.get("q") or "").strip(),
                            sort, page, size, purpose)


class _Params:
    """Los parámetros posicionales de asyncpg, numerados al agregarlos."""

    def __init__(self) -> None:
        self.values: list = []

    def add(self, value) -> str:
        self.values.append(value)
        return f"${len(self.values)}"


def _visibles(req: AnalyticsRequest, personal: bool) -> dict[str, AnalyticsColumn]:
    cols = {c.id: c for c in columns_for(req.dataset, personal=personal)}
    pedidas = set(req.filters) | ({req.sort[0]} if req.sort else set())
    fuera = sorted(pedidas - set(cols))
    if fuera:
        raise _422(f"Columna no disponible: {', '.join(fuera)}")
    return cols


def _condicion(col: AnalyticsColumn, valores: list[str], p: _Params) -> str:
    if col.type == "list":
        return f"({col.sql})::text[] && {p.add(valores)}::text[]"
    return f"({col.sql})::text = ANY({p.add(valores)}::text[])"


def _where(req: AnalyticsRequest, cols: dict[str, AnalyticsColumn], p: _Params, *, sin: str | None = None) -> str:
    fecha = DATE_FIELDS[req.dataset][req.date_field]
    partes = [f"{fecha} BETWEEN {p.add(req.date_from)} AND {p.add(req.date_to)}"]
    for col_id, valores in req.filters.items():
        if col_id != sin:
            partes.append(_condicion(cols[col_id], valores, p))
    if req.q:
        patron = p.add(f"%{req.q}%")
        partes.append("(" + " OR ".join(f"r.{c} ILIKE {patron}" for c in SEARCH[req.dataset]) + ")")
    return " AND ".join(partes)


def _from(req: AnalyticsRequest, cols: Mapping[str, AnalyticsColumn]) -> str:
    sql = f"FROM {TABLES[req.dataset]} r"
    if any(c.personal for c in cols.values()):
        sql += " LEFT JOIN analytics.driver_identity p ON p.driver_id = r.driver_id"
    return sql


def build_select(req: AnalyticsRequest, *, personal: bool, columns: Sequence[str] | None = None) -> tuple[str, list]:
    """El SELECT de una página (o de toda la descarga): filas con `_id` y las columnas pedidas (por defecto,
    todas las que el usuario puede ver). Une driver_identity solo si hay una columna personal en juego."""
    cols = _visibles(req, personal)
    if columns is not None:
        fuera = [c for c in columns if c not in cols]
        if fuera:
            raise _422(f"Columna no disponible: {', '.join(fuera)}")
        salida = [cols[c] for c in columns]
    else:
        salida = list(cols.values())
    en_juego = {c.id: c for c in salida} | {k: cols[k] for k in req.filters} | (
        {req.sort[0]: cols[req.sort[0]]} if req.sort else {})
    p = _Params()
    where = _where(req, cols, p)
    orden = (f"{cols[req.sort[0]].sql} {req.sort[1].upper()} NULLS LAST, " if req.sort else "") + DEFAULT_SORT[req.dataset]
    select = ", ".join([f"{ROW_ID[req.dataset]} AS _id", *(f"{c.sql} AS {c.id}" for c in salida)])
    sql = (f"SELECT {select} {_from(req, en_juego)} WHERE {where} ORDER BY {orden} "
           f"LIMIT {p.add(req.size)} OFFSET {p.add(req.page * req.size)}")
    return sql, p.values


async def _count(conn, req: AnalyticsRequest, cols: dict[str, AnalyticsColumn]) -> int:
    p = _Params()
    where = _where(req, cols, p)
    en_juego = {k: cols[k] for k in req.filters}
    return await conn.fetchval(f"SELECT count(*) {_from(req, en_juego)} WHERE {where}", *p.values)


async def _counts(conn, req: AnalyticsRequest, cols: dict[str, AnalyticsColumn]) -> dict[str, dict[str, int]]:
    """Facetadas: cada columna con filtro cuenta con los demás filtros y sin el suyo."""
    salida: dict[str, dict[str, int]] = {}
    for col in cols.values():
        if col.filter != "values":
            continue
        p = _Params()
        where = _where(req, cols, p, sin=col.id)
        en_juego = {k: cols[k] for k in req.filters if k != col.id} | {col.id: col}
        valor = f"unnest(({col.sql})::text[])" if col.type == "list" else f"({col.sql})::text"
        filas = await conn.fetch(
            f"SELECT v, count(*) AS n FROM (SELECT {valor} AS v {_from(req, en_juego)} WHERE {where}) x "
            f"WHERE v IS NOT NULL GROUP BY v ORDER BY n DESC, v LIMIT {COUNTS_LIMIT}", *p.values)
        salida[col.id] = {f["v"]: f["n"] for f in filas}
    return salida


async def loaded_at(conn):
    """Cuándo se recargó el modelo: lo hace la misma corrida para los dos conjuntos."""
    return await conn.fetchval("SELECT max(loaded_at) FROM analytics.bdot")


async def fetch_page(conn, req: AnalyticsRequest, *, personal: bool) -> dict:
    cols = _visibles(req, personal)
    sql, params = build_select(req, personal=personal)
    filas = await conn.fetch(sql, *params)
    return {
        "rows": [dict(f) for f in filas],
        "total": await _count(conn, req, cols),
        "counts": await _counts(conn, req, cols),
        "loaded_at": await loaded_at(conn),
    }
