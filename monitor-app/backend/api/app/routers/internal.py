"""Endpoints que solo llama la infraestructura (Cloud Scheduler)."""
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from ..authz.servicio_interno import requiere_scheduler
from ..db import get_pool
from ..services.cola_del_cierre import procesar_cola

router = APIRouter(prefix="/internal", tags=["internal"])


@router.post("/closures/recompute")
async def recalcular_cola_del_cierre(pool=Depends(get_pool), _=Depends(requiere_scheduler)):
    resumen = await procesar_cola(pool)
    # 500 si algún día falló, para que el Scheduler lo registre; la entrada
    # queda en la cola y se reintenta en la corrida siguiente.
    return JSONResponse(resumen, status_code=500 if resumen["fallidos"] else 200)
