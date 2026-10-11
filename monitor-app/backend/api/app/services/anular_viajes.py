"""Anular viajes manuales con motivo: una regla, un lugar (spec 2026-10-10 anulación y firma versionada, §2).

Reemplaza al borrado físico (eliminar_viajes.py). El viaje queda, con quién, cuándo y
por qué se anuló; app.trips_del_dia y los viajes del día (SQL_VIAJES_DEL_DIA) lo
excluyen, así que el Cierre, el reporte y los disponibles dejan de contarlo.

Qué: sólo lo que la app creó (source_system = 'manual'). Un viaje del TMS vuelve en
la próxima ingesta: anularlo sería mentir.

Quién, según los días firmados que el viaje toca:
  - ninguno: quien lo creó (app.trips_manual.created_by) o trips.void_any;
  - alguno: closures.sign. Toca un día firmado si es su día (planning_date, el que
    firma sus viajes) o si cuenta en él por sus marcas (app.trips_del_dia, la cota
    de 45 días). El día NO se reabre: la firma es una copia inmutable
    (app.closure_signatures) y la anulación aparece como ajuste posterior al cierre.
Revertir pide lo mismo.

Motivo: se elige del catálogo TRIP_VOID_REASON (app.status_taxonomies, editable en
Configuración › Motivos de anulación); el comentario es opcional y pasa a obligatorio
con code = 'OTRO'. La regla mira el código, no la etiqueta: renombrar "Otro" no la
rompe. El detalle y los ajustes leen la etiqueta sin filtrar `active`, así un motivo
desactivado se sigue viendo en los viajes que ya lo usaron. Un viaje anulado ya no está en trips_del_dia, así que al
revertir sólo se ve su propio día.

La regla que decide `can_void` en el listado es `_bloqueo`, la misma que aplica la
escritura: la UI nunca ofrece algo que el backend va a rechazar.

Escribe app.trips_manual y app.trips en la misma transacción: app.trips se reconstruye
desde trips_manual (rama manual del modelo dbt), y el merge no toca estas columnas
(merge_exclude_columns), igual que unassigned_reason_id.
"""
from __future__ import annotations

import asyncpg
from fastapi import HTTPException

from .audit import auditar_en_lote

MAXIMO_POR_LOTE = 200

# Columnas que el listado y el detalle agregan a cada viaje para decidir sin otra
# consulta. `dias_firmados` sólo se calcula para viajes manuales: son pocos, y así el
# listado no paga un EXISTS por cada viaje del TMS.
SQL_COLUMNAS_ANULABLE = """
    tm.created_by::text AS manual_created_by,
    t.voided_at, t.void_reason_id::text AS void_reason_id, void_rs.label AS void_reason_label, t.void_note,
    void_by.full_name AS voided_by_name,
    -- También para un anulado que el TMS reportó después (dejó de ser manual):
    -- deshacer esa anulación sigue mirando sus días firmados.
    CASE WHEN t.source_system = 'manual' OR t.voided_at IS NOT NULL THEN ARRAY(
        SELECT cp.business_date
        FROM app.closure_periods cp
        WHERE cp.status = 'CLOSED'
          -- la misma cota de 45 días que usa app.trips_del_dia
          AND cp.business_date BETWEEN t.planning_date AND t.planning_date + 45
          AND (cp.business_date = t.planning_date
               OR t.id IN (SELECT trip_id FROM app.trips_del_dia(cp.business_date)))
        ORDER BY cp.business_date
    ) END AS dias_firmados
"""

SQL_JOIN_ANULABLE = """
    LEFT JOIN app.trips_manual tm ON tm.id = t.id
    LEFT JOIN public.profiles void_by ON void_by.id = t.voided_by
    LEFT JOIN app.status_taxonomies void_rs ON void_rs.id = t.void_reason_id
"""


def _bloqueo(fila: dict, user: dict, *, revertir: bool) -> tuple[int, str] | None:
    """(status HTTP, motivo en español) si `user` NO puede anular (o revertir) el viaje."""
    permisos = user.get("permissions", ())
    # La ruta exige trips.void: sin él, `can_void` no puede ofrecer lo que la ruta rechaza.
    if "trips.void" not in permisos:
        return 403, "No tienes permiso para anular viajes"
    # Un anulado que el TMS reportó después (mismo id md5) dejó de ser manual, pero su
    # anulación quedó (merge_exclude_columns): se puede deshacer, no volver a anular.
    if fila.get("source_system") != "manual" and not (revertir and fila.get("voided_at") is not None):
        return 409, "Sólo se pueden anular viajes creados manualmente en la app"
    if revertir and fila.get("voided_at") is None:
        return 409, "El viaje no está anulado"
    if not revertir and fila.get("voided_at") is not None:
        return 409, "El viaje ya está anulado"
    firmados = fila.get("dias_firmados") or []
    if firmados:
        if "closures.sign" in permisos:
            return None
        dias = ", ".join(d.strftime("%d/%m") for d in firmados)
        return 403, f"Toca el cierre firmado del {dias}: lo anula quien puede firmar el cierre"
    if "trips.void_any" not in permisos and fila.get("manual_created_by") != user.get("sub"):
        return 403, "Sólo quien creó el viaje o Administración puede anularlo"
    return None


def anotar_anulable(d: dict, user: dict) -> None:
    """Deja en el viaje `can_void`, `void_blocked_reason` y `can_revert_void`, y quita
    las columnas de apoyo (no son parte del contrato)."""
    anulado = d.get("voided_at") is not None
    bloqueo = _bloqueo(d, user, revertir=anulado)
    d["can_void"] = not anulado and bloqueo is None
    d["void_blocked_reason"] = None if anulado or bloqueo is None else bloqueo[1]
    d["can_revert_void"] = anulado and bloqueo is None
    d.pop("manual_created_by", None)
    d.pop("dias_firmados", None)


async def _validar(conn, trip_ids: list[str], user: dict, *, revertir: bool) -> list[str]:
    ids = list(dict.fromkeys(trip_ids))
    if not ids:
        raise HTTPException(422, "Selecciona al menos un viaje")
    if len(ids) > MAXIMO_POR_LOTE:
        raise HTTPException(422, f"Máximo {MAXIMO_POR_LOTE} viajes por anulación")
    # Los períodos que la regla mira (su día y los 45 siguientes), FOR SHARE: `cerrar`
    # los toma FOR UPDATE (bloquear_periodo), así que una firma concurrente espera a
    # que esta anulación termine, y al revés. Sin esto, el día podía firmarse entre la
    # lectura de la regla y la escritura.
    await conn.execute(
        """
        SELECT 1 FROM app.closure_periods cp
        WHERE cp.business_date BETWEEN
              (SELECT min(planning_date) FROM app.trips WHERE id = ANY($1::uuid[]))
          AND (SELECT max(planning_date) FROM app.trips WHERE id = ANY($1::uuid[])) + 45
        ORDER BY cp.business_date
        FOR SHARE
        """,
        ids,
    )
    # FOR UPDATE: que nadie edite estos viajes mientras se decide.
    filas = await conn.fetch(
        f"""
        SELECT t.id::text AS id, t.source_system, t.planning_date, {SQL_COLUMNAS_ANULABLE}
        FROM app.trips t
        {SQL_JOIN_ANULABLE}
        WHERE t.id = ANY($1::uuid[])
        FOR UPDATE OF t
        """,
        ids,
    )
    por_id = {f["id"]: dict(f) for f in filas}
    errores, estados = [], set()
    for tid in ids:
        fila = por_id.get(tid)
        bloqueo = (404, "Viaje no encontrado") if fila is None else _bloqueo(fila, user, revertir=revertir)
        if bloqueo:
            estados.add(bloqueo[0])
            errores.append({"trip_id": tid, "error": bloqueo[1]})
    if errores:
        accion = "revirtió" if revertir else "anuló"
        # Un solo tipo de rechazo conserva su status; una mezcla es conflicto.
        raise HTTPException(
            estados.pop() if len(estados) == 1 else 409,
            {"message": f"No se {accion} ningún viaje", "errors": errores},
        )
    return ids


async def _motivo_valido(conn, reason_id: str | None, note: str | None) -> tuple[str, str, str | None]:
    """(id, etiqueta, nota limpia) del motivo, o 422. El motivo es del catálogo
    TRIP_VOID_REASON y está activo; la nota es obligatoria si su código es OTRO."""
    if not reason_id:
        raise HTTPException(422, "Elige un motivo de anulación")
    try:
        fila = await conn.fetchrow(
            "SELECT id::text AS id, label, code FROM app.status_taxonomies "
            "WHERE id = $1::uuid AND domain = 'TRIP_VOID_REASON' AND active",
            reason_id,
        )
    except (asyncpg.DataError, ValueError):
        fila = None
    if fila is None:
        raise HTTPException(422, "Motivo de anulación inválido")
    nota = (note or "").strip() or None
    if fila["code"] == "OTRO" and nota is None:
        raise HTTPException(422, "Con «Otro» escribe un comentario que diga por qué")
    return fila["id"], fila["label"], nota


async def anular_viajes(conn, trip_ids: list[str], reason_id: str | None, note: str | None, user: dict) -> int:
    """Anula los viajes, todo o nada. Debe correr dentro de una transacción."""
    motivo_id, etiqueta, nota = await _motivo_valido(conn, reason_id, note)
    ids = await _validar(conn, trip_ids, user, revertir=False)
    for tabla in ("app.trips_manual", "app.trips"):
        await conn.execute(
            f"UPDATE {tabla} SET voided_at = now(), voided_by = $2::uuid, "
            "void_reason_id = $3::uuid, void_note = $4 WHERE id = ANY($1::uuid[])",
            ids, user["sub"], motivo_id, nota,
        )
    await auditar_en_lote(
        conn, actor=user["sub"], entity_type="TRIP", action="void", field="voided_at", source="api",
        filas=[(tid, None, {"reason_id": motivo_id, "reason": etiqueta, "note": nota}) for tid in ids],
    )
    return len(ids)


async def revertir_anulacion(conn, trip_ids: list[str], user: dict) -> int:
    """Devuelve los viajes al día, todo o nada. Debe correr dentro de una transacción."""
    ids = await _validar(conn, trip_ids, user, revertir=True)
    anteriores = {r["id"]: (r["motivo"], r["void_note"]) for r in await conn.fetch(
        "SELECT t.id::text, r.label AS motivo, t.void_note FROM app.trips t "
        "LEFT JOIN app.status_taxonomies r ON r.id = t.void_reason_id WHERE t.id = ANY($1::uuid[])", ids)}
    for tabla in ("app.trips_manual", "app.trips"):
        await conn.execute(
            f"UPDATE {tabla} SET voided_at = NULL, voided_by = NULL, void_reason_id = NULL, void_note = NULL "
            "WHERE id = ANY($1::uuid[])",
            ids,
        )
    await auditar_en_lote(
        conn, actor=user["sub"], entity_type="TRIP", action="void_revert", field="voided_at", source="api",
        filas=[(tid, dict(zip(("reason", "note"), anteriores.get(tid, (None, None)))), None) for tid in ids],
    )
    return len(ids)


async def exigir_vigentes(db, trip_ids) -> None:
    """409 si alguno de los viajes está anulado. Un anulado es de solo lectura: para
    editarlo se deshace la anulación (spec 2026-10-10, revisión final). `db` es un
    pool o una conexión; `is True` porque un mock que devuelve otra cosa no es un sí."""
    anulado = await db.fetchval(
        "SELECT bool_or(voided_at IS NOT NULL) FROM app.trips WHERE id = ANY($1::uuid[])",
        [str(t) for t in trip_ids],
    )
    if anulado is True:
        raise HTTPException(409, "El viaje está anulado: deshaz la anulación para editarlo")
