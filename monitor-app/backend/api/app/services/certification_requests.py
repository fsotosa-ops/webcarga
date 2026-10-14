"""Pedir a Certificación (Cert 3, Entrega B 14/10).

Operaciones no sube documentos: pide. Un pedido apunta a una entidad (y, si se sabe, a un
requisito) y lleva el contexto del viaje o del día del Cierre. Certificación lo ve arriba
de Pendientes y lo resuelve.

Un pedido con requisito se da por resuelto cuando ese documento queda al día: se calcula
al leer (sin trigger). Pedir de nuevo un documento que ya volvió a estar al día cierra el
pedido viejo y abre uno nuevo.
"""
from __future__ import annotations

from datetime import date

from fastapi import HTTPException

from .audit import log_change
from .vencimientos import document_state_sql

# El documento pedido ya está al día: el pedido no espera a nadie.
_SATISFIED = f"""EXISTS (
    SELECT 1 FROM public.compliance_records cr
    WHERE cr.entity_type = rq.entity_type AND cr.entity_id = rq.entity_id
      AND cr.requirement_id = rq.requirement_id AND cr.is_current
      AND {document_state_sql('cr')} IN ('UP_TO_DATE', 'NOT_REQUIRED'))"""

_ENTITY_NAME = """CASE rq.entity_type
    WHEN 'CARRIER' THEN (SELECT c.business_name FROM public.carriers c WHERE c.id = rq.entity_id)
    WHEN 'DRIVER'  THEN (SELECT d.full_name FROM public.drivers d WHERE d.id = rq.entity_id)
    WHEN 'ASSET'   THEN (SELECT a.license_plate FROM public.assets a WHERE a.id = rq.entity_id)
END"""

_LIST_SQL = f"""
SELECT rq.id::text, rq.entity_type, rq.entity_id::text, {_ENTITY_NAME} AS entity_name,
       c.id::text AS carrier_id, c.business_name AS carrier_name,
       rq.requirement_id::text, req.name AS requirement_name,
       rq.note, rq.trip_id::text, t.source_system_trip_id AS trip_number, rq.closure_date,
       rq.created_at, p.full_name AS created_by_name
FROM app.certification_requests rq
LEFT JOIN public.compliance_requirements req ON req.id = rq.requirement_id
LEFT JOIN public.carriers c ON c.id = app.carrier_of(rq.entity_type, rq.entity_id)
LEFT JOIN app.trips t ON t.id = rq.trip_id
LEFT JOIN public.profiles p ON p.id = rq.created_by
WHERE rq.status = 'OPEN'
  AND NOT (rq.requirement_id IS NOT NULL AND {_SATISFIED})
ORDER BY rq.created_at
"""

_ENTITY_TABLES = {"CARRIER": "carriers", "DRIVER": "drivers", "ASSET": "assets"}


async def list_open(db) -> list[dict]:
    return [dict(r) for r in await db.fetch(_LIST_SQL)]


async def create(conn, *, entity_type: str, entity_id: str, requirement_id: str | None, note: str | None,
                 trip_id: str | None, closure_date: date | None, actor: str) -> dict:
    """Crea el pedido, o devuelve el que ya está abierto para lo mismo (`created`: False)."""
    if not await conn.fetchval(f"SELECT 1 FROM public.{_ENTITY_TABLES[entity_type]} WHERE id = $1", entity_id):
        raise HTTPException(404, "No existe esa empresa, conductor o equipo")
    abierto = await conn.fetchrow(
        f"""
        SELECT rq.id::text, ({_SATISFIED}) AS satisfied
        FROM app.certification_requests rq
        WHERE rq.status = 'OPEN' AND rq.entity_type = $1 AND rq.entity_id = $2
          AND rq.requirement_id IS NOT DISTINCT FROM $3::uuid
        FOR UPDATE
        """,
        entity_type, entity_id, requirement_id,
    )
    if abierto and not (requirement_id and abierto["satisfied"]):
        return {"id": abierto["id"], "created": False}
    if abierto:
        # El documento ya se había regularizado: ese pedido terminó; este es otro.
        await conn.execute(
            "UPDATE app.certification_requests SET status = 'RESOLVED', resolved_at = now(), "
            "resolution_note = 'Se resolvió solo: el documento quedó al día' WHERE id = $1",
            abierto["id"])
    new_id = await conn.fetchval(
        """
        INSERT INTO app.certification_requests
            (entity_type, entity_id, requirement_id, note, trip_id, closure_date, created_by)
        VALUES ($1, $2, $3::uuid, $4, $5::uuid, $6, $7::uuid)
        RETURNING id::text
        """,
        entity_type, entity_id, requirement_id, note, trip_id, closure_date, actor,
    )
    await log_change(conn, actor=actor, entity_type=entity_type, entity_id=entity_id,
                     action="certification_request", new_value={"request_id": new_id, "requirement_id": requirement_id})
    return {"id": new_id, "created": True}


async def resolve(conn, request_id: str, *, note: str | None, actor: str) -> None:
    result = await conn.execute(
        """
        UPDATE app.certification_requests
        SET status = 'RESOLVED', resolved_by = $2::uuid, resolved_at = now(), resolution_note = $3
        WHERE id = $1 AND status = 'OPEN'
        """,
        request_id, actor, note,
    )
    if result == "UPDATE 0":
        raise HTTPException(404, "No hay un pedido abierto con ese id")
