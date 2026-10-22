"""Analítica: la BDOT reconstruida desde la app (HU monitor-app/docs/user-stories/20261022/01-hu-analitica.md).

Lee solo el schema `analytics` (tablas de dbt que el pipeline analytics_gold recarga cada hora)."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from ..authz import Permission, require
from ..db import get_pool
from ..services.analytics_columns import can_see_personal, columns_for
from ..services.analytics_export import export_workbook, personal_requested
from ..services.analytics_query import fetch_page, parse_request

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/columns")
async def list_columns(dataset: Literal["trips", "fleet"] = "trips",
                       user=Depends(require(Permission.ANALYTICS_READ))) -> list[dict]:
    """El catálogo que ve el frontend. Sin el permiso de datos personales, esas columnas no existen."""
    return [
        {"id": c.id, "label": c.label, "group": c.group, "type": c.type, "filter": c.filter,
         "default_visible": c.default_visible, "personal": c.personal}
        for c in columns_for(dataset, personal=can_see_personal(user))
    ]


@router.get("/rows")
async def list_rows(request: Request, pool=Depends(get_pool), user=Depends(require(Permission.ANALYTICS_READ))) -> dict:
    """Una página de filas, el total y las cifras de cada filtro. `mode=pivot` (solo Flota por día) admite hasta
    20.000 filas de una vez, para la tabla dinámica."""
    params = dict(request.query_params)
    purpose = "pivot" if params.get("mode") == "pivot" else "rows"
    req = parse_request(params, purpose=purpose)
    async with pool.acquire() as conn:
        return await fetch_page(conn, req, personal=can_see_personal(user))


@router.get("/export")
async def export_rows(request: Request, pool=Depends(get_pool),
                      user=Depends(require(Permission.ANALYTICS_EXPORT))) -> Response:
    """El Excel de lo que se ve: mismos parámetros que /rows más `columns` (las visibles, en orden). Una columna
    personal sin su permiso es 403, no se omite en silencio. Más de 50.000 filas: 413 con el total."""
    params = dict(request.query_params)
    req = parse_request(params, purpose="export")
    columnas = [c for c in params.get("columns", "").split(",") if c]
    if not columnas:
        raise HTTPException(422, "Elige al menos una columna")
    personal = can_see_personal(user)
    if personal_requested(req.dataset, columnas) and not personal:
        raise HTTPException(403, "Descargar nombre o RUT del conductor requiere el permiso de datos personales")
    async with pool.acquire() as conn:
        contenido, nombre, _ = await export_workbook(conn, req, columns=columnas, personal=personal,
                                                     actor=user["sub"])
    return Response(content=contenido, media_type=XLSX,
                    headers={"Content-Disposition": f'attachment; filename="{nombre}"'})
