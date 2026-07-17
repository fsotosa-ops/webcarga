"""public.coverage_types — catálogo de solo lectura (H2.3), usado por el
frontend para el selector de coberturas al vincular una póliza."""
from fastapi import APIRouter, Depends

from ..auth import get_current_user
from ..db import get_pool

router = APIRouter(prefix="/coverage-types", tags=["insurance"])


@router.get("")
async def list_coverage_types(pool=Depends(get_pool), _=Depends(get_current_user)):
    rows = await pool.fetch(
        "SELECT id, code, name, description FROM public.coverage_types "
        "WHERE is_active = true ORDER BY name",
    )
    return [dict(r) for r in rows]
