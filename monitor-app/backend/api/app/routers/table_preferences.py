"""Preferencias de tabla por persona (Cierre con un solo patrón, spec §4.3).

Qué columnas ve cada persona y en qué orden, por tabla del kit (`table_key`, p. ej.
`closure.fleet`). Es de cada persona, así que solo pide sesión, sin permiso de área,
como los grupos del Monitor (`filter_groups.py`). Restablecer = borrar."""
import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, ConfigDict, Field

from ..auth import get_current_user
from ..db import get_pool

router = APIRouter(prefix="/me/table-preferences", tags=["table-preferences"])

TableKey = Annotated[str, Path(pattern=r"^[a-z0-9_.-]{1,64}$")]


class ColumnPreference(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-zA-Z0-9_]{1,40}$")
    hidden: bool


class TablePreferencesBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # 80: Analítica tiene ~40 columnas por conjunto de datos y el catálogo crece por etapas (22/10).
    columns: list[ColumnPreference] = Field(max_length=80)


@router.get("/{table_key}")
async def get_table_preferences(table_key: TableKey, pool=Depends(get_pool), user=Depends(get_current_user)):
    fila = await pool.fetchrow(
        "SELECT columns FROM app.table_preferences WHERE user_id = $1 AND table_key = $2",
        user["sub"], table_key,
    )
    if fila is None:
        raise HTTPException(404, "Sin preferencia guardada")
    # jsonb llega como texto: el pool no registra un codec para jsonb.
    return {"columns": json.loads(fila["columns"])}


@router.put("/{table_key}")
async def put_table_preferences(
    table_key: TableKey, body: TablePreferencesBody, pool=Depends(get_pool), user=Depends(get_current_user),
):
    columnas = [c.model_dump() for c in body.columns]
    await pool.execute(
        """
        INSERT INTO app.table_preferences (user_id, table_key, columns, updated_at)
        VALUES ($1, $2, $3::jsonb, now())
        ON CONFLICT (user_id, table_key) DO UPDATE SET columns = EXCLUDED.columns, updated_at = now()
        """,
        user["sub"], table_key, json.dumps(columnas),
    )
    return {"columns": columnas}


@router.delete("/{table_key}", status_code=204)
async def delete_table_preferences(table_key: TableKey, pool=Depends(get_pool), user=Depends(get_current_user)):
    await pool.execute(
        "DELETE FROM app.table_preferences WHERE user_id = $1 AND table_key = $2", user["sub"], table_key,
    )
