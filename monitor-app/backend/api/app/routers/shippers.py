"""public.shippers — solo lectura por ahora. Antes solo se exponía anidado
bajo /carriers/{id}/shippers (relación carrier↔shipper vía
public.carrier_shippers); este endpoint plano lista el catálogo completo,
lo necesita el selector de generador de carga en la administración del
catálogo de locales (H2.6)."""
from fastapi import APIRouter, Depends

from ..auth import get_current_user
from ..db import get_pool

router = APIRouter(prefix="/shippers", tags=["shippers"])


@router.get("")
async def list_shippers(pool=Depends(get_pool), _=Depends(get_current_user)):
    rows = await pool.fetch(
        "SELECT id, name, status FROM public.shippers ORDER BY name"
    )
    return [dict(r) for r in rows]
