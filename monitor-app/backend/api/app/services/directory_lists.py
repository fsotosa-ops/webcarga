"""Directorio › Conductores y Equipos: una lista por objeto (D4, Entrega C 14/10).

Todos los conductores o equipos, con su empresa de hoy (app.carrier_of), su ciclo de vida y
su resumen documental (el mismo de los rosters: entity_compliance_cte). Certificación abre
esta misma lista con el filtro de documentos puesto: no hay una segunda lista del mismo objeto.
"""
from __future__ import annotations

from typing import Literal

from ..utils.identity import plate_matches_sql, rut_matches_sql
from .fleet_compliance import entity_compliance_cte, entity_summary_columns_sql, take_summary

Kind = Literal["DRIVER", "ASSET"]
DocumentsFilter = Literal["pending", "overdue", "expiring", "missing"]

_DOCUMENTS = {
    "pending": "worst_state IS NOT NULL",
    "overdue": "overdue > 0",
    "expiring": "expiring > 0",
    "missing": "missing > 0",
}

_BASE = {
    "DRIVER": """
        SELECT d.id, d.full_name, d.tax_id, d.operational_status, d.home_location_id,
               NULL::text AS license_plate, NULL::text AS asset_type, NULL::text AS operation_type,
               c.id AS carrier_id, c.business_name AS carrier_name, c.operational_status AS carrier_status,
               {summary}
        FROM public.drivers d
        LEFT JOIN public.carriers c ON c.id = app.carrier_of('DRIVER', d.id)
        LEFT JOIN entity_compliance ec ON ec.entity_type = 'DRIVER' AND ec.entity_id = d.id""",
    "ASSET": """
        SELECT a.id, NULL::text AS full_name, NULL::text AS tax_id, a.operational_status, NULL::uuid AS home_location_id,
               a.license_plate, a.asset_type, wot.label AS operation_type,
               c.id AS carrier_id, c.business_name AS carrier_name, c.operational_status AS carrier_status,
               {summary}
        FROM public.assets a
        LEFT JOIN app.status_taxonomies wot ON wot.id = a.webcarga_operation_type_id
        LEFT JOIN public.carriers c ON c.id = app.carrier_of('ASSET', a.id)
        LEFT JOIN entity_compliance ec ON ec.entity_type = 'ASSET' AND ec.entity_id = a.id""",
}

# Los filtros de la lista, por nombre: así los conteos de las pestañas salen de la misma regla.
_FILTERS = {
    "without_carrier": "carrier_id IS NULL",
    "inactive": "operational_status <> 'ACTIVE'",
    "without_origin": "home_location_id IS NULL",             # solo conductores
    "without_type": "public.is_power_unit(asset_type) AND operation_type IS NULL",  # solo tractos
}


def _search(kind: Kind) -> str:
    if kind == "DRIVER":
        return f"($1 = '' OR full_name ILIKE '%'||$1||'%' OR {rut_matches_sql('tax_id', '$1')})"
    return f"($1 = '' OR {plate_matches_sql('license_plate', '$1')})"


async def directory_list(db, kind: Kind, *, q: str = "", flag: str | None = None,
                         documents: DocumentsFilter | None = None, limit: int = 50, offset: int = 0) -> dict:
    base = _BASE[kind].format(summary=entity_summary_columns_sql("ec"))
    where = [_search(kind)]
    if flag:
        where.append(_FILTERS[flag])
    if documents:
        where.append(_DOCUMENTS[documents])
    order = "full_name, id" if kind == "DRIVER" else "license_plate, id"
    rows = await db.fetch(
        f"""
        WITH {entity_compliance_cte()}, base AS ({base})
        SELECT *, count(*) OVER () AS total_count FROM base
        WHERE {' AND '.join(where)}
        ORDER BY (operational_status = 'ACTIVE') DESC, {order}
        LIMIT $2 OFFSET $3
        """,
        q.strip(), limit, offset,
    )
    flags = ["without_carrier", "inactive", "without_origin" if kind == "DRIVER" else "without_type"]
    facets = dict(await db.fetchrow(
        f"""
        WITH {entity_compliance_cte()}, base AS ({base})
        SELECT count(*)::int AS all,
               {', '.join(f"(count(*) FILTER (WHERE {_FILTERS[f]}))::int AS {f}" for f in flags)},
               (count(*) FILTER (WHERE {_DOCUMENTS['pending']}))::int AS documents_pending
        FROM base WHERE {_search(kind)}
        """,
        q.strip(),
    ))
    total = rows[0]["total_count"] if rows else 0
    out = []
    for r in rows:
        row = dict(r)
        row.pop("total_count", None)
        row["compliance_summary"] = take_summary(row, with_fleet=False)
        row["carrier"] = ({"id": str(row["carrier_id"]), "name": row["carrier_name"],
                           "operational_status": row["carrier_status"]} if row["carrier_id"] else None)
        for k in ("carrier_id", "carrier_name", "carrier_status"):
            row.pop(k)
        out.append(row)
    return {"total": total, "rows": out, "facets": facets}
