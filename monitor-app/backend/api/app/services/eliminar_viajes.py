"""Eliminar viajes manuales: una regla, un lugar.

Sólo se elimina lo que la app creó. Un viaje del TMS vuelve en la próxima
ingesta, y "eliminarlo" sería mentir; si el TMS ya reportó un viaje que nació
manual (mismo id md5), deja de ser manual (`source_system`) y tampoco se puede.

Quién: admin/owner, o quien lo creó (`app.trips_manual.created_by`). El resto
no, aunque sea editor: eliminar lo de otro no es corregir un error propio.

Cuándo no: si el viaje está en un día ya firmado. Un día cerrado no se
recalcula (modelo de cierre, Ronda 161), y borrar una línea suya cambiaría sus
cifras sin reabrirlo. Para eliminarlo, se reabre el día primero.

Qué se borra: en producción NO hay ninguna FK hacia app.trips (el
--full-refresh de dbt las borra al recrear la tabla), así que cada dependiente
se borra a mano. Y app.trips se reconstruye desde app.trips_manual (rama UNION
de app_trips.sql), así que hay que borrar en las dos, o el viaje resucita en
la próxima corrida.

La regla que decide `can_delete` en el listado es `motivo_no_eliminable` —la
misma que aplica el borrado—, así la UI nunca ofrece algo que el backend va a
rechazar.
"""
from __future__ import annotations

from fastapi import HTTPException

from ..auth import ADMIN_ROLES
from .audit import log_change

MAXIMO_POR_LOTE = 200

# Columnas que el listado agrega a cada viaje para poder decidir sin otra
# consulta. `manual_closed_dates` sólo se calcula para viajes manuales: son
# pocos, y así el listado no paga un EXISTS por cada viaje del TMS.
SQL_COLUMNAS_ELIMINABLE = """
    tm.created_by::text AS manual_created_by,
    CASE WHEN t.source_system = 'manual' THEN ARRAY(
        SELECT DISTINCT cl.business_date
        FROM app.closure_lines cl
        JOIN app.closure_periods cp
          ON cp.business_date = cl.business_date AND cp.status = 'CLOSED'
        WHERE cl.subject_type = 'TRIP' AND cl.subject_id = t.id
        ORDER BY cl.business_date
    ) END AS manual_closed_dates
"""

SQL_JOIN_ELIMINABLE = "LEFT JOIN app.trips_manual tm ON tm.id = t.id"


def _bloqueo(fila: dict, user: dict) -> tuple[int, str] | None:
    """(status HTTP, motivo en español) si `user` NO puede eliminar el viaje.

    `fila` trae `source_system`, `manual_created_by` y `manual_closed_dates`
    (ver SQL_COLUMNAS_ELIMINABLE)."""
    if fila.get("source_system") != "manual":
        return 409, "Sólo se pueden eliminar viajes creados manualmente en la app"
    if user.get("role") not in ADMIN_ROLES and fila.get("manual_created_by") != user.get("sub"):
        return 403, "Sólo quien creó el viaje o un administrador puede eliminarlo"
    cerrados = fila.get("manual_closed_dates") or []
    if cerrados:
        dias = ", ".join(d.strftime("%d/%m") for d in cerrados)
        return 409, f"Pertenece al cierre firmado del {dias}; reabre ese día para eliminarlo"
    return None


def motivo_no_eliminable(fila: dict, user: dict) -> str | None:
    """None si `user` puede eliminar el viaje; si no, el motivo."""
    bloqueo = _bloqueo(fila, user)
    return bloqueo[1] if bloqueo else None


def anotar_eliminable(d: dict, user: dict) -> None:
    """Deja en el viaje `can_delete` y su motivo, y quita las columnas de
    apoyo (no son parte del contrato del listado)."""
    motivo = motivo_no_eliminable(d, user)
    d["can_delete"] = motivo is None
    d["delete_blocked_reason"] = motivo
    d.pop("manual_created_by", None)
    d.pop("manual_closed_dates", None)


async def eliminar_viajes_manuales(conn, trip_ids: list[str], user: dict) -> list[str]:
    """Elimina los viajes, todo o nada. Debe correr dentro de una transacción.

    Valida TODOS antes de borrar ninguno; si alguno no se puede, responde con
    la lista completa de motivos por viaje. Devuelve las rutas de Storage de
    los adjuntos, para borrarlas DESPUÉS del commit (un archivo no se puede
    devolver con un rollback)."""
    ids = list(dict.fromkeys(trip_ids))
    if not ids:
        raise HTTPException(422, "Selecciona al menos un viaje")
    if len(ids) > MAXIMO_POR_LOTE:
        raise HTTPException(422, f"Máximo {MAXIMO_POR_LOTE} viajes por eliminación")

    # FOR UPDATE: que nadie edite ni cierre el día de estos viajes mientras
    # se decide y se borra.
    filas = await conn.fetch(
        f"""
        SELECT t.id::text AS id, t.source_system, t.client_name, t.planning_date,
               t.trip_status, t.source_system_trip_id, {SQL_COLUMNAS_ELIMINABLE}
        FROM app.trips t
        {SQL_JOIN_ELIMINABLE}
        WHERE t.id = ANY($1::uuid[])
        FOR UPDATE OF t
        """,
        ids,
    )
    por_id = {f["id"]: dict(f) for f in filas}

    errores, estados = [], set()
    for tid in ids:
        fila = por_id.get(tid)
        bloqueo = (404, "Viaje no encontrado") if fila is None else _bloqueo(fila, user)
        if bloqueo:
            estados.add(bloqueo[0])
            errores.append({"trip_id": tid, "error": bloqueo[1]})
    if errores:
        # Un solo tipo de rechazo conserva su status; una mezcla es conflicto.
        raise HTTPException(
            estados.pop() if len(estados) == 1 else 409,
            {"message": "No se eliminó ningún viaje", "errors": errores},
        )

    rutas = [r["storage_path"] for r in await conn.fetch(
        """
        SELECT a.storage_path FROM app.trip_note_attachments a
        JOIN app.trip_notes n ON n.id = a.note_id
        WHERE n.trip_id = ANY($1::uuid[])
        """,
        ids,
    )]

    # Sólo quedan líneas de días ABIERTOS: las de días cerrados bloquearon arriba.
    await conn.execute(
        "DELETE FROM app.closure_lines WHERE subject_type = 'TRIP' AND subject_id = ANY($1::uuid[])", ids)
    # Los adjuntos caen por su FK ON DELETE CASCADE a trip_notes.
    await conn.execute("DELETE FROM app.trip_notes WHERE trip_id = ANY($1::uuid[])", ids)
    await conn.execute("DELETE FROM app.trip_fleet_links WHERE trip_id = ANY($1::uuid[])", ids)
    await conn.execute("DELETE FROM app.trip_stops WHERE trip_id = ANY($1::uuid[])", ids)
    await conn.execute("DELETE FROM app.trips WHERE id = ANY($1::uuid[])", ids)
    await conn.execute("DELETE FROM app.trips_manual WHERE id = ANY($1::uuid[])", ids)

    for tid in ids:
        fila = por_id[tid]
        await log_change(
            conn, actor=user["sub"], entity_type="TRIP", entity_id=tid, action="delete",
            old_value={
                "client_name": fila["client_name"],
                "planning_date": fila["planning_date"],
                "trip_status": fila["trip_status"],
                "source_system_trip_id": fila["source_system_trip_id"],
                "created_by": fila["manual_created_by"],
            },
        )
    return rutas
