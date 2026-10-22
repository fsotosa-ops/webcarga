"""Vistas guardadas de Analítica (HU Analítica, criterios 9 a 11; tabla app.saved_views, migración 20261104090000).

Personal: la ve y la edita su dueño (para otro no existe: 404). Compartida: la ve todo el que tiene analytics.read;
la crea quien tiene analytics.manage_views; la edita o la borra su dueño o un administrador (HU, criterio 9). Las
sembradas (owner_id NULL) solo un administrador, y no pasan a personales.

Datos personales: al leer, quien no tiene el permiso recibe la vista sin columnas, filtros ni orden personales; al
guardar, lo personal que no ve se conserva tal como estaba (no se borra por no verlo). Al escribir, las columnas se
validan contra el catálogo."""
from __future__ import annotations

import json
from typing import Literal
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from ..authz import Permission, exigir, require
from ..db import get_pool
from ..routers.table_preferences import ColumnPreference
from ..services.analytics_columns import can_see_personal, columns_for

router = APIRouter(prefix="/analytics/views", tags=["analytics"])

_COLS = "id::text, owner_id::text, dataset, name, scope, view, columns, updated_at"


class SavedViewBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dataset: Literal["trips", "fleet"]
    name: str = Field(min_length=1, max_length=60)
    scope: Literal["personal", "shared"] = "personal"
    view: dict
    columns: list[ColumnPreference] = Field(max_length=80)


class SavedViewPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=60)
    scope: Literal["personal", "shared"] | None = None
    view: dict | None = None
    columns: list[ColumnPreference] | None = Field(default=None, max_length=80)


def _es_administrador(user: dict) -> bool:
    """"Un administrador" de la HU: quien administra la configuración general (Administración y Propietario)."""
    return Permission.SETTINGS_MANAGE.value in user["permissions"]


def _puede_editar(fila, user: dict) -> bool:
    if fila["owner_id"] is not None and fila["owner_id"] == user["sub"]:
        return True
    return fila["scope"] == "shared" and _es_administrador(user)


def _personales(dataset: str) -> set[str]:
    return {c.id for c in columns_for(dataset, personal=True) if c.personal}


def _vista_sin_personales(vista: dict, personales: set[str]) -> dict:
    filtros = {k: v for k, v in (vista.get("filters") or {}).items() if k not in personales}
    orden = vista.get("sort")
    if orden and orden.get("column") in personales:
        orden = None
    return {**vista, "filters": filtros, "sort": orden}


def _conservar_personales(guardada: list[dict], nueva: list[dict], personales: set[str]) -> list[dict]:
    """Las columnas personales que quien guarda no ve vuelven a su posición de antes."""
    salida = [c for c in nueva if c["id"] not in personales]
    for i, c in enumerate(guardada):
        if c["id"] in personales:
            salida.insert(min(i, len(salida)), c)
    return salida


def _salida(fila, user: dict) -> dict:
    """Una vista como la ve este usuario: sin las columnas personales si no tiene el permiso."""
    columnas = json.loads(fila["columns"])
    vista = json.loads(fila["view"])
    if not can_see_personal(user):
        personales = _personales(fila["dataset"])
        columnas = [c for c in columnas if c["id"] not in personales]
        vista = _vista_sin_personales(vista, personales)
    return {"id": fila["id"], "dataset": fila["dataset"], "name": fila["name"], "scope": fila["scope"],
            "view": vista, "columns": columnas, "can_edit": _puede_editar(fila, user),
            "is_mine": fila["owner_id"] == user["sub"], "updated_at": fila["updated_at"]}


def _validar_columnas(dataset: str, columnas: list[ColumnPreference], user: dict) -> None:
    validas = {c.id for c in columns_for(dataset, personal=can_see_personal(user))}
    fuera = sorted({c.id for c in columnas} - validas)
    if fuera:
        raise HTTPException(422, f"Columna no disponible: {', '.join(fuera)}")


async def _cargar(conn, view_id: UUID, user: dict):
    fila = await conn.fetchrow(f"SELECT {_COLS} FROM app.saved_views WHERE id = $1", view_id)
    # Una vista personal ajena no existe para otro: mismo 404 que una inexistente.
    if fila is None or (fila["scope"] == "personal" and fila["owner_id"] != user["sub"]):
        raise HTTPException(404, "Vista no encontrada")
    return fila


@router.get("")
async def list_views(dataset: Literal["trips", "fleet"] = "trips", pool=Depends(get_pool),
                     user=Depends(require(Permission.ANALYTICS_READ))) -> list[dict]:
    filas = await pool.fetch(
        f"SELECT {_COLS} FROM app.saved_views WHERE dataset = $1 AND (scope = 'shared' OR owner_id = $2::uuid) "
        "ORDER BY scope DESC, name", dataset, user["sub"])
    return [_salida(f, user) for f in filas]


@router.post("", status_code=201)
async def create_view(body: SavedViewBody, pool=Depends(get_pool),
                      user=Depends(require(Permission.ANALYTICS_READ))) -> dict:
    if body.scope == "shared":
        exigir(user, Permission.ANALYTICS_MANAGE_VIEWS)
    _validar_columnas(body.dataset, body.columns, user)
    try:
        fila = await pool.fetchrow(
            f"INSERT INTO app.saved_views (owner_id, dataset, name, scope, view, columns) "
            f"VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6::jsonb) RETURNING {_COLS}",
            user["sub"], body.dataset, body.name.strip(), body.scope, json.dumps(body.view),
            json.dumps([c.model_dump() for c in body.columns]))
    except asyncpg.UniqueViolationError:
        raise HTTPException(409, "Ya hay una vista con ese nombre")
    return _salida(fila, user)


@router.patch("/{view_id}")
async def update_view(view_id: UUID, body: SavedViewPatch, pool=Depends(get_pool),
                      user=Depends(require(Permission.ANALYTICS_READ))) -> dict:
    async with pool.acquire() as conn:
        fila = await _cargar(conn, view_id, user)
        if not _puede_editar(fila, user):
            raise HTTPException(403, "Solo su dueño o un administrador puede editarla")
        if body.scope == "shared" and fila["scope"] != "shared":
            exigir(user, Permission.ANALYTICS_MANAGE_VIEWS)
        if body.scope == "personal" and fila["scope"] == "shared" and fila["owner_id"] != user["sub"]:
            raise HTTPException(422, "Solo su dueño puede volver personal una vista compartida")
        if body.columns is not None:
            _validar_columnas(fila["dataset"], body.columns, user)
        columnas = [c.model_dump() for c in body.columns] if body.columns is not None else None
        vista = body.view
        if not can_see_personal(user):
            personales = _personales(fila["dataset"])
            if columnas is not None:
                columnas = _conservar_personales(json.loads(fila["columns"]), columnas, personales)
            if vista is not None:
                guardada = json.loads(fila["view"])
                vista = {**vista, "filters": {**{k: v for k, v in (guardada.get("filters") or {}).items()
                                                  if k in personales}, **(vista.get("filters") or {})}}
                if vista.get("sort") is None and (guardada.get("sort") or {}).get("column") in personales:
                    vista["sort"] = guardada["sort"]
        try:
            fila = await conn.fetchrow(
                f"UPDATE app.saved_views SET name = COALESCE($2, name), scope = COALESCE($3, scope), "
                f"view = COALESCE($4::jsonb, view), columns = COALESCE($5::jsonb, columns), updated_at = now() "
                f"WHERE id = $1 RETURNING {_COLS}",
                view_id, body.name.strip() if body.name else None, body.scope,
                json.dumps(vista) if vista is not None else None,
                json.dumps(columnas) if columnas is not None else None)
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "Ya hay una vista con ese nombre")
    return _salida(fila, user)


@router.delete("/{view_id}", status_code=204)
async def delete_view(view_id: UUID, pool=Depends(get_pool),
                      user=Depends(require(Permission.ANALYTICS_READ))) -> None:
    async with pool.acquire() as conn:
        fila = await _cargar(conn, view_id, user)
        if not _puede_editar(fila, user):
            raise HTTPException(403, "Solo su dueño o un administrador puede borrarla")
        await conn.execute("DELETE FROM app.saved_views WHERE id = $1", view_id)
