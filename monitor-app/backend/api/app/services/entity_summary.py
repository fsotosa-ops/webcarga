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

from .vencimientos import cubierto_predicate, exigible_sql, por_vencer_predicate, vence_el_sql, vencido_predicate

EntityType = Literal["CARRIER", "DRIVER", "ASSET"]

# Lo que hay que atender, en este orden: lo vencido, lo que vence pronto y lo que falta.
_ATTENTION_ORDER = {"expired": 0, "expiring": 1, "missing": 2}
ATTENTION_LIMIT = 3

# Un estado por documento vigente, excluyente: un documento que todavía no se exige
# no cuenta para nada (no está "al día" ni "falta").
_DOCUMENTS_SQL = f"""
SELECT req.name,
       NULLIF({vence_el_sql('cr')}, '-infinity') AS due_on,
       CASE
           WHEN NOT {exigible_sql('cr')} THEN NULL
           WHEN cr.status = 'EXPIRED' OR {vencido_predicate('cr')} THEN 'expired'
           WHEN {por_vencer_predicate('cr')} THEN 'expiring'
           WHEN cr.status = 'MISSING' THEN 'missing'
           WHEN {cubierto_predicate('cr')} THEN 'ok'
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
        SELECT d.id, d.full_name, d.tax_id, d.operational_status,
               c.id AS carrier_id, c.business_name AS carrier_name,
               c.operational_status AS carrier_status,
               hl.name AS home_location_name, hs.name AS home_location_shipper,
               a.id AS tractor_id, a.license_plate AS tractor_plate,
               {_PRIMARY_PHONE.format(kind="'DRIVER'", entity="d.id")} AS phone
        FROM public.drivers d
        LEFT JOIN public.driver_assignments da ON da.driver_id = d.id AND da.status = 'ACTIVE'
        LEFT JOIN public.carriers c ON c.id = da.carrier_id
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
        "documents": await document_summary(conn, row["id"], "DRIVER"),
    }


async def asset_summary(conn, asset_id: UUID) -> dict | None:
    row = await conn.fetchrow(
        """
        SELECT a.id, a.license_plate, a.asset_type, a.manufacture_year, a.operational_status,
               wot.label AS operation_type,
               c.id AS carrier_id, c.business_name AS carrier_name,
               c.operational_status AS carrier_status,
               d.id AS driver_id, d.full_name AS driver_name
        FROM public.assets a
        LEFT JOIN app.status_taxonomies wot ON wot.id = a.webcarga_operation_type_id
        LEFT JOIN public.asset_assignments aa ON aa.asset_id = a.id AND aa.status = 'ACTIVE'
        LEFT JOIN public.carriers c ON c.id = aa.carrier_id
        LEFT JOIN public.vehicle_driver_assignments vda ON vda.asset_id = a.id AND vda.status = 'ACTIVE'
        LEFT JOIN public.drivers d ON d.id = vda.driver_id
        WHERE a.id = $1
        LIMIT 1
        """,
        asset_id,
    )
    if row is None:
        return None
    return {
        "id": str(row["id"]),
        "license_plate": row["license_plate"],
        "asset_type": row["asset_type"],
        "manufacture_year": row["manufacture_year"],
        "operation_type": row["operation_type"],
        "operational_status": row["operational_status"],
        "carrier": _carrier_ref(row),
        "usual_driver": _ref(row, "driver_id", "driver_name"),
        "documents": await document_summary(conn, row["id"], "ASSET"),
    }


async def carrier_summary(conn, carrier_id: UUID) -> dict | None:
    row = await conn.fetchrow(
        f"""
        SELECT c.id, c.business_name, c.tax_id, c.operational_status,
               (SELECT count(*) FROM public.driver_assignments da
                WHERE da.carrier_id = c.id AND da.status = 'ACTIVE') AS active_drivers,
               (SELECT count(*) FROM public.asset_assignments aa
                WHERE aa.carrier_id = c.id AND aa.status = 'ACTIVE') AS active_assets,
               pc.name AS contact_name, pc.phone AS contact_phone
        FROM public.carriers c
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
        "primary_contact": (
            {"name": row["contact_name"], "phone": row["contact_phone"]} if has_contact else None
        ),
        "documents": await document_summary(conn, row["id"], "CARRIER"),
    }
