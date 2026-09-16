"""El cierre del día: firmar y reabrir, los dos ejes juntos.

Reemplaza a POST /daily-closures/close y POST /equipment-closures/close, que el
frontend encadenaba: si el segundo fallaba, el día quedaba medio firmado y nada
lo decía. Las reglas viven en services/cierre_lineas.py.
"""
from datetime import date as _date

from fastapi import APIRouter, Depends, HTTPException

from ..auth import require_writer
from ..db import get_pool
from ..schemas.closures import CerrarDiaBody, ReabrirDiaBody
from ..services.cierre_lineas import cerrar, reabrir

router = APIRouter(prefix="/closures", tags=["closures"])


def _fecha(fecha: str) -> _date:
    try:
        return _date.fromisoformat(fecha)
    except ValueError:
        raise HTTPException(422, f"Fecha inválida: '{fecha}' (formato esperado YYYY-MM-DD)")


# `require_writer`: firmar el día es el trabajo de Operaciones (07/09). Forzar
# con pendientes y reabrir exigen admin, y eso lo resuelve el servicio.
@router.post("/{fecha}/close")
async def cerrar_dia(fecha: str, body: CerrarDiaBody, pool=Depends(get_pool), user=Depends(require_writer)):
    return await cerrar(pool, _fecha(fecha), override=body.override, override_note=body.override_note, user=user)


@router.post("/{fecha}/reopen")
async def reabrir_dia(fecha: str, body: ReabrirDiaBody, pool=Depends(get_pool), user=Depends(require_writer)):
    return await reabrir(pool, _fecha(fecha), nota=body.nota, user=user)
