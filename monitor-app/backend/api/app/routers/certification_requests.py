"""Pedir a Certificación (Cert 3, Entrega B 14/10). Ver services/certification_requests.py."""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..authz import Permission, require
from ..db import get_pool
from ..schemas.common import EntityType
from ..services.certification_lock import ensure_subject_open
from ..services import certification_requests as svc

router = APIRouter(prefix="/certification-requests", tags=["certification-requests"])


class CertificationRequestBody(BaseModel):
    entity_type: EntityType
    entity_id: str
    requirement_id: Optional[str] = None
    note: Optional[str] = None
    trip_id: Optional[str] = None
    closure_date: Optional[date] = None


class ResolveBody(BaseModel):
    note: Optional[str] = None


@router.get("")
async def list_open_requests(pool=Depends(get_pool), _=Depends(require(Permission.CERTIFICATION_READ))):
    rows = await svc.list_open(pool)
    return {"total": len(rows), "rows": rows}


@router.post("", status_code=201)
async def create_request(
    body: CertificationRequestBody, pool=Depends(get_pool), user=Depends(require(Permission.CERTIFICATION_REQUEST)),
):
    async with pool.acquire() as conn:
        # Operaciones no pide documentos a lo dado de baja.
        await ensure_subject_open(conn, body.entity_type, body.entity_id)
        async with conn.transaction():
            return await svc.create(
                conn, entity_type=body.entity_type, entity_id=body.entity_id, requirement_id=body.requirement_id,
                note=body.note, trip_id=body.trip_id, closure_date=body.closure_date, actor=user["sub"])


@router.post("/{request_id}/resolve")
async def resolve_request(
    request_id: str, body: ResolveBody, pool=Depends(get_pool), user=Depends(require(Permission.DOCUMENTS_REVIEW)),
):
    async with pool.acquire() as conn:
        async with conn.transaction():
            await svc.resolve(conn, request_id, note=body.note, actor=user["sub"])
    return {"ok": True}
