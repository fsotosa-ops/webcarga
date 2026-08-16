"""Quién revisó cada elemento de Configuración, y el gesto de confirmar."""
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from ..auth import get_current_user, require_admin
from ..db import get_pool
from ..services.revisiones import exigir_seccion, registrar_revision

router = APIRouter(prefix="/config/reviews", tags=["config"])


class ConfirmacionBody(BaseModel):
    domain: str
    section: str
    element_id: str


@router.get("")
async def list_reviews(
    domain: str = Query(...),
    section: str = Query(...),
    pool=Depends(get_pool),
):
    """Los elementos YA revisados de una sección.

    Se devuelven los revisados y no los pendientes: la lista de elementos ya la
    tiene la pantalla, y pedirle al backend que la repita crearía una segunda
    definición de qué elementos hay."""
    exigir_seccion(domain, section)
    filas = await pool.fetch(
        """
        SELECT r.element_id,
               r.reviewed_at,
               COALESCE(p.full_name, p.email) AS reviewed_by
          FROM app.config_reviews r
          LEFT JOIN public.profiles p ON p.id = r.reviewed_by
         WHERE r.domain = $1 AND r.section = $2
        """,
        domain, section,
    )
    return [dict(f) for f in filas]


@router.post("")
async def confirm_review(
    body: ConfirmacionBody,
    pool=Depends(get_pool),
    usuario=Depends(get_current_user),
    _=Depends(require_admin),
):
    """"Lo miré y está bien así".

    Es el único caso que no deja rastro solo: guardar un cambio ya cuenta como
    revisar, y lo hace el propio endpoint que guarda."""
    exigir_seccion(body.domain, body.section)
    await registrar_revision(pool, body.domain, body.section, body.element_id, usuario["sub"])
    return {"revisado": True}
