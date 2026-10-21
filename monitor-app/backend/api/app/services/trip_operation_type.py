"""Lo que Operaciones declara como tipo de operación de un viaje (plan 2026-10-21).

El tipo de un viaje se resuelve en la base (`app.v_trip_fleet_resolution`): lo
declarado gana sobre el cliente de un solo tipo y sobre el tracto. Se declara al
crear un viaje de un cliente que trabaja con los dos tipos o sin tipo (Spot), o al
resolver un aviso OPERATION_TYPE_CONFLICT. Quitarlo vuelve a lo calculado.
"""
from __future__ import annotations

import asyncpg
from fastapi import HTTPException

from .audit import log_change

OPERATION_TYPE_DOMAIN = "WEBCARGA_OPERATION_TYPE"


async def _valid_type(conn, operation_type_id: str) -> str:
    """La etiqueta del tipo, o 422 si no es un tipo de operación activo."""
    try:
        label = await conn.fetchval(
            "SELECT label FROM app.status_taxonomies WHERE id = $1::uuid AND domain = $2 AND active",
            operation_type_id, OPERATION_TYPE_DOMAIN)
    except (asyncpg.DataError, ValueError):
        label = None
    if label is None:
        raise HTTPException(422, "Tipo de operación inválido")
    return label


async def declare(conn, trip_id: str, operation_type_id: str, *, note: str | None, actor: str) -> str:
    """Declara (o reemplaza) el tipo del viaje. Devuelve su etiqueta. Debe correr en una transacción."""
    label = await _valid_type(conn, operation_type_id)
    clean_note = (note or "").strip() or None
    previous = await conn.fetchval(
        "SELECT operation_type_id::text FROM app.trip_operation_types WHERE trip_id = $1", trip_id)
    await conn.execute(
        """
        INSERT INTO app.trip_operation_types (trip_id, operation_type_id, note, declared_by, declared_at)
        VALUES ($1, $2::uuid, $3, $4::uuid, now())
        ON CONFLICT (trip_id) DO UPDATE
            SET operation_type_id = EXCLUDED.operation_type_id, note = EXCLUDED.note,
                declared_by = EXCLUDED.declared_by, declared_at = now()
        """,
        trip_id, operation_type_id, clean_note, actor)
    await log_change(conn, actor=actor, entity_type="TRIP", entity_id=trip_id,
                     action="declare_operation_type", field="operation_type_id",
                     old_value=previous, new_value={"operation_type_id": operation_type_id, "note": clean_note})
    return label


async def clear(conn, trip_id: str, *, actor: str) -> bool:
    """Quita lo declarado: el viaje vuelve al tipo del cliente o del tracto."""
    previous = await conn.fetchval(
        "DELETE FROM app.trip_operation_types WHERE trip_id = $1 RETURNING operation_type_id::text", trip_id)
    if previous:
        await log_change(conn, actor=actor, entity_type="TRIP", entity_id=trip_id,
                         action="clear_operation_type", field="operation_type_id", old_value=previous)
    return previous is not None
