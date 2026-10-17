"""Seguros › Empresas (Seguros por empresa, 17/10): ¿cada transportista está al día con
sus pólizas? La lista por empresa y el detalle de una empresa; el veredicto lo calcula la
base (`app.carrier_insurance_summary`)."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from ..authz import Permission, require
from ..db import get_pool
from ..services import insurance

router = APIRouter(prefix="/insurance", tags=["insurance"])


@router.get("/carriers")
async def list_insurance_carriers(pool=Depends(get_pool), _=Depends(require(Permission.INSURANCE_READ))):
    return await insurance.carrier_overview(pool)


@router.get("/carriers/{carrier_id}")
async def get_insurance_carrier(carrier_id: UUID, pool=Depends(get_pool), _=Depends(require(Permission.INSURANCE_READ))):
    detalle = await insurance.carrier_insurance(pool, str(carrier_id))
    if detalle is None:
        raise HTTPException(404, "La empresa no existe")
    return detalle
