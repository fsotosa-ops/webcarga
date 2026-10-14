"""Resumen de una empresa, un conductor o un equipo para la vista rápida del Cierre
(minuta 09/10, ítem 21; HU 20261011/01).

Una consulta por entidad y sin URLs firmadas: la ficha completa firma un enlace por
documento, y eso no escala para un panel que se abre con un clic. El estado de cada
documento sale de la misma regla que el resto de la app (services/vencimientos.py);
acá solo se cuenta y se ordena.
"""
from __future__ import annotations

from typing import Literal
from uuid import UUID

from .fleet_compliance import (
    carrier_compliance_cte, carrier_summary_columns_sql, entity_compliance_cte,
    entity_summary_columns_sql, take_summary,
)
from .vencimientos import document_state_sql, vence_el_sql

EntityType = Literal["CARRIER", "DRIVER", "ASSET"]

# Lo que hay que atender, en este orden: lo vencido, lo que vence pronto y lo que falta.
_ATTENTION_ORDER = {"expired": 0, "expiring": 1, "missing": 2}
ATTENTION_LIMIT = 3

# Un estado por documento vigente: el de document_state_sql, la única definición
# (Entrega B, 14/10; hasta acá este archivo armaba su propio CASE y la vista rápida
# podía contar distinto que Pendientes). Lo que todavía no se exige no cuenta.
_DOCUMENTS_SQL = f"""
SELECT req.name,
       NULLIF({vence_el_sql('cr')}, '-infinity') AS due_on,
       CASE {document_state_sql('cr')}
           WHEN 'UP_TO_DATE' THEN 'ok'
           WHEN 'OVERDUE'    THEN 'expired'
           WHEN 'EXPIRING'   THEN 'expiring'
           WHEN 'MISSING'    THEN 'missing'
       END AS state
FROM public.compliance_records cr
JOIN public.compliance_requirements req ON req.id = cr.requirement_id
WHERE cr.entity_id = $1 AND cr.entity_type = $2 AND cr.is_current
"""


async def document_summary(conn, entity_id: UUID, entity_type: EntityType) -> dict:
    """Cuántos documentos están al día, por vencer, vencidos o faltan, y los que hay
    que atender primero (como máximo `ATTENTION_LIMIT`)."""
    rows = await conn.fetch(_DOCUMENTS_SQL, entity_id, entity_type)
    counts = {"ok": 0, "expiring": 0, "expired": 0, "missing": 0}
    for row in rows:
        if row["state"]:
            counts[row["state"]] += 1
    attention = sorted(
        (r for r in rows if r["state"] in _ATTENTION_ORDER),
        key=lambda r: (_ATTENTION_ORDER[r["state"]], r["due_on"] is None, r["due_on"], r["name"]),
    )[:ATTENTION_LIMIT]
    return {
        **counts,
        "attention": [{"name": r["name"], "state": r["state"], "due_on": r["due_on"]} for r in attention],
    }


def _ref(row, id_key: str, name_key: str) -> dict | None:
    """{id, name} de una entidad relacionada, o None si no hay."""
    if row[id_key] is None:
        return None
    return {"id": str(row[id_key]), "name": row[name_key]}


def _carrier_ref(row) -> dict | None:
    """La empresa, con su estado: un conductor o equipo de una empresa dada de
    baja tiene que poder decirlo (bloque 0, 0.9)."""
    if row["carrier_id"] is None:
        return None
    return {"id": str(row["carrier_id"]), "name": row["carrier_name"],
            "operational_status": row["carrier_status"]}


_PRIMARY_PHONE = """
    (SELECT ct.phone FROM public.contacts ct
     WHERE ct.entity_type = {kind} AND ct.entity_id = {entity}
       AND ct.is_active AND NULLIF(btrim(ct.phone), '') IS NOT NULL
     ORDER BY ct.is_primary DESC, ct.created_at
     LIMIT 1)
"""


def usual_tractor_lateral(driver_expr: str, alias: str = "a") -> str:
    """El tracto habitual de un conductor: el de su asignación ACTIVE más
    reciente. Un conductor puede tener varios tractos activos (el índice único
    de vehicle_driver_assignments es por tracto, no por conductor): un LEFT
    JOIN plano lo devuelve una vez por tracto (F-07). Una sola regla para la
    vista rápida, la búsqueda del Monitor y los disponibles del día. Un tracto
    dado de baja nunca se ofrece como habitual (F13). Columnas: `id`,
    `license_plate`."""
    return f"""
        LEFT JOIN LATERAL (
            SELECT vg_ut.id, vg_ut.license_plate
            FROM public.vehicle_driver_assignments vg_vda
            JOIN public.assets vg_ut ON vg_ut.id = vg_vda.asset_id
            WHERE vg_vda.driver_id = {driver_expr} AND vg_vda.status = 'ACTIVE'
              AND vg_ut.operational_status = 'ACTIVE'
            ORDER BY vg_vda.start_date DESC NULLS LAST, vg_vda.created_at DESC, vg_ut.id
            LIMIT 1
        ) {alias} ON true"""


async def driver_summary(conn, driver_id: UUID) -> dict | None:
    row = await conn.fetchrow(
        f"""
        WITH {entity_compliance_cte()}
        SELECT d.id, d.full_name, d.tax_id, d.operational_status,
               {entity_summary_columns_sql('ec')},
               c.id AS carrier_id, c.business_name AS carrier_name,
               c.operational_status AS carrier_status,
               hl.name AS home_location_name, hs.name AS home_location_shipper,
               a.id AS tractor_id, a.license_plate AS tractor_plate,
               {_PRIMARY_PHONE.format(kind="'DRIVER'", entity="d.id")} AS phone
        FROM public.drivers d
        -- "¿De qué empresa es?" tiene una sola respuesta (D1, spec §4.2).
        LEFT JOIN public.carriers c ON c.id = app.carrier_of('DRIVER', d.id)
        LEFT JOIN entity_compliance ec ON ec.entity_type = 'DRIVER' AND ec.entity_id = d.id
        LEFT JOIN public.locations hl ON hl.id = d.home_location_id
        LEFT JOIN public.shippers hs ON hs.id = hl.entity_id AND hl.entity_type = 'SHIPPER'
        {usual_tractor_lateral('d.id', 'a')}
        WHERE d.id = $1
        LIMIT 1
        """,
        driver_id,
    )
    if row is None:
        return None
    compliance_summary = take_summary(dict(row), with_fleet=False)
    return {
        "id": str(row["id"]),
        "full_name": row["full_name"],
        "tax_id": row["tax_id"],
        "operational_status": row["operational_status"],
        "carrier": _carrier_ref(row),
        "home_location": (
            {"name": row["home_location_name"], "shipper": row["home_location_shipper"]}
            if row["home_location_name"] else None
        ),
        "usual_tractor": (
            {"id": str(row["tractor_id"]), "plate": row["tractor_plate"]} if row["tractor_id"] else None
        ),
        "phone": row["phone"],
        "compliance_summary": compliance_summary,
        "documents": await document_summary(conn, row["id"], "DRIVER"),
    }


async def asset_summary(conn, asset_id: UUID) -> dict | None:
    row = await conn.fetchrow(
        f"""
        WITH {entity_compliance_cte()}
        SELECT a.id, a.license_plate, a.asset_type, a.manufacture_year, a.operational_status,
               {entity_summary_columns_sql('ec')},
               wot.label AS operation_type,
               c.id AS carrier_id, c.business_name AS carrier_name,
               c.operational_status AS carrier_status,
               d.id AS driver_id, d.full_name AS driver_name
        FROM public.assets a
        LEFT JOIN app.status_taxonomies wot ON wot.id = a.webcarga_operation_type_id
        LEFT JOIN public.carriers c ON c.id = app.carrier_of('ASSET', a.id)
        LEFT JOIN entity_compliance ec ON ec.entity_type = 'ASSET' AND ec.entity_id = a.id
        LEFT JOIN public.vehicle_driver_assignments vda ON vda.asset_id = a.id AND vda.status = 'ACTIVE'
        LEFT JOIN public.drivers d ON d.id = vda.driver_id
        WHERE a.id = $1
        LIMIT 1
        """,
        asset_id,
    )
    if row is None:
        return None
    compliance_summary = take_summary(dict(row), with_fleet=False)
    return {
        "id": str(row["id"]),
        "license_plate": row["license_plate"],
        "asset_type": row["asset_type"],
        "manufacture_year": row["manufacture_year"],
        "operation_type": row["operation_type"],
        "operational_status": row["operational_status"],
        "carrier": _carrier_ref(row),
        "usual_driver": _ref(row, "driver_id", "driver_name"),
        "compliance_summary": compliance_summary,
        "documents": await document_summary(conn, row["id"], "ASSET"),
    }


async def carrier_summary(conn, carrier_id: UUID) -> dict | None:
    row = await conn.fetchrow(
        f"""
        WITH {carrier_compliance_cte()}
        SELECT c.id, c.business_name, c.tax_id, c.operational_status,
               -- La flota activa: una sola definición (app.active_fleet, D1).
               -- Contar por asignación sola incluía a los dados de baja (F-03).
               (SELECT count(*) FROM app.active_fleet f
                WHERE f.carrier_id = c.id AND f.entity_type = 'DRIVER') AS active_drivers,
               (SELECT count(*) FROM app.active_fleet f
                WHERE f.carrier_id = c.id AND f.entity_type = 'ASSET') AS active_assets,
               pc.name AS contact_name, pc.phone AS contact_phone,
               {carrier_summary_columns_sql('cc')}
        FROM public.carriers c
        LEFT JOIN carrier_compliance cc ON cc.carrier_id = c.id
        LEFT JOIN LATERAL (
            SELECT NULLIF(btrim(concat_ws(' ', ct.first_name, ct.last_name)), '') AS name, ct.phone
            FROM public.contacts ct
            WHERE ct.entity_type = 'CARRIER' AND ct.entity_id = c.id AND ct.is_active
            ORDER BY ct.is_primary DESC, ct.created_at
            LIMIT 1
        ) pc ON true
        WHERE c.id = $1
        """,
        carrier_id,
    )
    if row is None:
        return None
    compliance_summary = take_summary(dict(row), with_fleet=True)
    shippers = await conn.fetch(
        """
        SELECT s.id, s.name FROM public.carrier_shippers cs
        JOIN public.shippers s ON s.id = cs.shipper_id
        WHERE cs.carrier_id = $1 AND cs.status = 'ACTIVE'
        ORDER BY s.name
        """,
        carrier_id,
    )
    has_contact = row["contact_name"] or row["contact_phone"]
    return {
        "id": str(row["id"]),
        "business_name": row["business_name"],
        "tax_id": row["tax_id"],
        "operational_status": row["operational_status"],
        "shippers": [{"id": str(s["id"]), "name": s["name"]} for s in shippers],
        "active_drivers": row["active_drivers"],
        "active_assets": row["active_assets"],
        "compliance_summary": compliance_summary,
        "primary_contact": (
            {"name": row["contact_name"], "phone": row["contact_phone"]} if has_contact else None
        ),
        "documents": await document_summary(conn, row["id"], "CARRIER"),
    }
