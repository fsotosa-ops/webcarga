"""Analítica: la BDOT reconstruida desde la app (HU monitor-app/docs/user-stories/20261022/01-hu-analitica.md).

Lee solo el schema `analytics` (tablas de dbt que el pipeline analytics_gold recarga cada hora)."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends

from ..authz import Permission, require
from ..services.analytics_columns import can_see_personal, columns_for

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
