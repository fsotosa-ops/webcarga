"""public.shippers — catálogo de clientes/shippers reales. GET es de solo
lectura desde H2.6 (selector del generador de carga en Configuración); POST
se suma en la Ronda 26 (Fase 2) para que TripAssignDialog pueda crear un
shipper nuevo al vuelo cuando el operador tipea un cliente que no existe
todavía — antes client_name era texto libre sin ningún vínculo real."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth import get_current_user, require_editor
from ..db import get_pool

router = APIRouter(prefix="/shippers", tags=["shippers"])


class ShipperCreateBody(BaseModel):
    name: str


@router.get("")
async def list_shippers(pool=Depends(get_pool), _=Depends(get_current_user)):
    rows = await pool.fetch(
        "SELECT id, name, status FROM public.shippers ORDER BY name"
    )
    return [dict(r) for r in rows]


@router.post("", status_code=201)
async def create_shipper(
    body: ShipperCreateBody,
    pool=Depends(get_pool),
    _=Depends(require_editor),
):
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "El nombre no puede estar vacío")
    try:
        row = await pool.fetchrow(
            "INSERT INTO public.shippers (name, status) VALUES ($1, 'ACTIVE') RETURNING id, name, status",
            name,
        )
    except Exception as e:
        if "shippers_name_key" in str(e):
            raise HTTPException(409, f"Ya existe un cliente llamado '{name}'")
        raise
    return dict(row)
