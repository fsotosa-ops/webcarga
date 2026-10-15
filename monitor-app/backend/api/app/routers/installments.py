"""Seguros › Cuotas: la cola de pagos de todas las pólizas (Seguros, Entrega 1)."""
from fastapi import APIRouter, Depends, HTTPException, Query

from ..authz import Permission, require
from ..db import get_pool
from ..services import insurance

router = APIRouter(prefix="/installments", tags=["insurance"])


@router.get("")
async def list_installments(
    state: str = Query("OVERDUE"),
    q: str = Query(""),
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=500),
    pool=Depends(get_pool),
    _=Depends(require(Permission.INSURANCE_READ)),
):
    if state not in insurance.INSTALLMENT_FILTERS:
        raise HTTPException(422, "state inválido")
    return await insurance.list_installments(pool, state=state, q=q, page=page, limit=limit)
