"""Analítica: la BDOT reconstruida desde la app (HU monitor-app/docs/user-stories/20261022/01-hu-analitica.md).

Lee solo el schema `analytics` (tablas de dbt que el pipeline analytics_gold recarga cada hora)."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Request

from ..authz import Permission, require
from ..db import get_pool
from ..services.analytics_columns import can_see_personal, columns_for
from ..services.analytics_query import fetch_page, parse_request

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/columns")
async def list_columns(dataset: Literal["trips", "fleet"] = "trips",
                       user=Depends(require(Permission.ANALYTICS_READ))) -> list[dict]:
    """El catálogo que ve el frontend. Sin el permiso de datos personales, esas columnas no existen."""
    return [
        {"id": c.id, "label": c.label, "group": c.group, "type": c.type, "filter": c.filter,
         "default_visible": c.default_visible}
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
