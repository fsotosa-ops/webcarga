"""Escribir el catálogo de requisitos: cambiar la regla de un documento y
aplicarla a los registros.

Viven acá, y no en el router, porque los usan dos caminos: el PATCH de un
documento (el panel lateral) y la publicación en lote (la tabla de
Configuración, HU-C1 entrega 2c). Dos copias del UPDATE serían dos
auditorías y dos versionados que tarde o temprano dicen cosas distintas.

Las funciones reciben una conexión que YA está en transacción: quien llama
decide el alcance (un documento, o el lote entero, todo o nada)."""
from __future__ import annotations

from typing import Optional

from ..schemas.requirement import RequirementConditionsPatchBody
from .audit import log_change
from .requirement_conditions import diferencias_en
from .revisiones import registrar_revision
from .solicitudes import encender_registros
from .vencimientos import (
    cubierto_predicate,
    exigible_sql,
    por_vencer_predicate,
    vencido_predicate,
)
from .vigencia import guardar_vigencia

# Lista blanca de columnas tocables — nunca se interpolan nombres que vengan
# del request, solo estas literales. `sent_fields()` ya está acotado al mismo
# conjunto, pero se repite acá para que el cast SQL de cada columna quede a la
# vista de quien lea el UPDATE.
_CONDITION_COLUMN_CASTS: dict[str, Optional[str]] = {
    "is_active": None,
    "applies_to_fleet_service_type_ids": "uuid[]",
    "applies_to_management_types": "text[]",
    # Sin cast: TEXT con CHECK. Desde cuándo se exige (HU-C1, entrega 2b).
    # `expiration_policy` ya no está: se escribe solo junto con sus
    # parámetros, por `vigencia` (services/vigencia.py).
    "exigible_on": None,
    # Sin cast: TEXT y TEXT. `name` es el nombre visible y renombrarlo es
    # inocuo -- nadie guarda copia, todas las pantallas hacen JOIN vivo.
    "name": None,
    # `requirement_level` dice cuan obligatorio es (la ficha y el Diario
    # cuentan solo LEGAL_MANDATORY). No decide la siembra: desde
    # 20260816010000 los disparadores leen `is_active` y `applies_to_*`, no
    # el nivel, asi que cambiarlo no agrega ni quita registros.
    "requirement_level": None,
    # `requirement_code` NO ESTA, y no es un olvido: es la llave de
    # `requirement_filename_aliases`, del motor de match y del catalogo de
    # vencimientos. Renombrarlo dejaria al clasificador sin poder resolver ese
    # documento nunca mas.
}

# Las columnas editables, EN UN SOLO LUGAR. Leerlas antes del UPDATE y
# devolverlas despues son dos listas mas que tienen que decir exactamente lo
# mismo que la whitelist: escribirlas a mano ya dejo `name` fuera del SELECT y
# el registro de auditoria reviento con KeyError sobre un campo recien
# habilitado. Derivarlas hace imposible agregar un campo y olvidar uno de los
# tres lugares.
_COLUMNAS_EDITABLES = ", ".join(_CONDITION_COLUMN_CASTS)


class RequisitoNoEncontrado(LookupError):
    """El documento no existe (404 en el router)."""


async def aplicar_cambio(conn, requirement_id: str, body: RequirementConditionsPatchBody,
                         *, actor: str) -> dict:
    """Cambia la regla de un documento, NO sus registros: aplicarla es
    `aplicar_recalculo`. Audita cada campo y cuenta como revisión."""
    touched = body.sent_fields()
    columnas = [campo for campo in touched if campo in _CONDITION_COLUMN_CASTS]

    current = await conn.fetchrow(
        f"""
        SELECT id, {_COLUMNAS_EDITABLES}
        FROM public.compliance_requirements WHERE id = $1
        """,
        requirement_id,
    )
    if not current:
        raise RequisitoNoEncontrado(requirement_id)

    row = None
    if columnas:
        # UPDATE de ancho variable: solo entran las columnas efectivamente
        # enviadas, cada una con SU valor por placeholder — nunca COALESCE.
        # Con COALESCE, NULL solo puede significar "no lo mandaron", y
        # "lo mandaron NULL/[] a propósito" queda inexpresable. Los nombres
        # de columna salen únicamente de _CONDITION_COLUMN_CASTS (whitelist
        # fija); jamás del request.
        values: list = [requirement_id]
        set_parts = []
        for field in columnas:
            values.append(getattr(body, field))
            cast = _CONDITION_COLUMN_CASTS[field]
            placeholder = f"${len(values)}" + (f"::{cast}" if cast else "")
            set_parts.append(f"{field} = {placeholder}")
        row = await conn.fetchrow(
            f"""
            UPDATE public.compliance_requirements SET {', '.join(set_parts)}
            WHERE id = $1
            RETURNING id, requirement_code, expiration_policy, {_COLUMNAS_EDITABLES}
            """,
            *values,
        )
        for field in columnas:
            await log_change(
                conn, actor=actor, entity_type="REQUIREMENT", entity_id=requirement_id,
                action="update", field=field,
                old_value=current[field], new_value=getattr(body, field),
            )
    if "vigencia" in touched:
        # El tipo y sus parámetros van juntos y versionados
        # (services/vigencia.py); la base valida su coherencia al confirmar.
        cambio = await guardar_vigencia(conn, requirement_id, body.vigencia)
        await log_change(
            conn, actor=actor, entity_type="REQUIREMENT", entity_id=requirement_id,
            action="update", field="vigencia",
            old_value=cambio["antes"], new_value=cambio["despues"],
        )
        # La vigencia cambió después del UPDATE (o sin él): se relee la fila.
        row = await conn.fetchrow(
            f"""
            SELECT id, requirement_code, expiration_policy, {_COLUMNAS_EDITABLES}
            FROM public.compliance_requirements WHERE id = $1
            """,
            requirement_id,
        )
    # GUARDAR CUENTA COMO REVISAR, y va en la MISMA transaccion que el
    # cambio: si el UPDATE se revierte, el registro de revision no puede
    # quedar diciendo que alguien decidio algo que no ocurrio.
    #
    # No se deduce de `audit_log` —que se acaba de escribir dos lineas
    # arriba— a proposito: "hay una fila en el log" significaria a la vez
    # "alguien lo cambio" y "alguien lo confirmo", y separar esos dos es
    # justamente para lo que existe el registro.
    await registrar_revision(conn, "certification", "conditions", requirement_id, actor)
    return dict(row)


async def aplicar_recalculo(conn, requirement_id: str, *, actor: str) -> Optional[dict]:
    """Enciende y apaga registros para que coincidan con la regla. None si el
    documento no existe.

    No borra: `is_current` es el interruptor —el mismo que ya usa
    `reconcile_carrier_shipper_link` al desactivar un vínculo empresa-cliente—
    y `compliance_records` no tiene tabla de historial, así que un DELETE
    físico era irreversible por definición. Es además el estándar del rubro
    (cumplimiento, nómina, contabilidad): un requisito que deja de
    corresponder se marca como tal, no se borra."""
    d = await diferencias_en(conn, requirement_id)
    if d["target_entity"] is None:
        return None

    creados_ids: list = []
    quitados_ids: list = []
    if d["crear"]:
        # `crear` incluye entidades sin registro y entidades con uno APAGADO.
        # El índice único (entity_id, requirement_id) es TOTAL, así que la fila
        # apagada sigue ocupando el lugar: `encender_registros` hace
        # `ON CONFLICT ... DO UPDATE SET is_current = true WHERE NOT is_current`
        # y toca SÓLO el interruptor — un registro apagado puede tener
        # documento cargado, y pisarle status/file_url/expiration_date al
        # resucitarlo sería destruir trabajo real.
        creados_ids = await encender_registros(
            conn, d["crear"], d["target_entity"], requirement_id, manual=False)
    if d["quitar"]:
        # D13: el UPDATE vuelve a comprobar el predicado en vez de confiar
        # ciegamente en los ids. Con READ COMMITTED, alguien pudo subir un
        # archivo entre la lectura de las diferencias y acá; si pasó, la fila
        # ya no matchea y sigue vigente. `AND is_current` hace el apagado
        # idempotente. `quitados` reporta lo efectivamente apagado (RETURNING).
        quitados_rows = await conn.fetch(
            """
            UPDATE public.compliance_records
               SET is_current = false
             WHERE id = ANY($1::uuid[])
               AND is_current
               AND file_url IS NULL AND NOT is_manual_override
               AND status IS NOT DISTINCT FROM 'MISSING'
            RETURNING id
            """,
            d["quitar"],
        )
        quitados_ids = [str(r["id"]) for r in quitados_rows]
    # Rastro forense: compliance_records no tiene tabla de historial, así que
    # esto es lo único que dice QUÉ filas tocó cada recálculo.
    #
    # OJO con los nombres: `old_value` NO son filas borradas — son las que se
    # APAGARON, y siguen en la tabla con su documento intacto. `new_value`
    # incluye filas nuevas y filas re-encendidas. Los nombres vienen del
    # contrato viejo (cuando esto sí borraba) y se conservan a propósito.
    await log_change(
        conn, actor=actor, entity_type="REQUIREMENT", entity_id=requirement_id,
        action="recalc", field="compliance_records",
        old_value=quitados_ids, new_value=creados_ids, source="api",
    )
    return {"creados": len(creados_ids), "quitados": len(quitados_ids),
            "bloqueados": len(d["bloqueados"])}


async def contar_estados(conn, requirement_id: str) -> dict:
    """Los registros de un documento por estado, con los mismos predicados
    que /status y /pending (services/vencimientos.py)."""
    fila = await conn.fetchrow(
        f"""
        SELECT count(*) FILTER (WHERE {exigible_sql('cr')} AND {vencido_predicate('cr')})    AS vencidos,
               count(*) FILTER (WHERE {exigible_sql('cr')} AND {por_vencer_predicate('cr')}) AS por_vencer,
               count(*) FILTER (WHERE {cubierto_predicate('cr')})   AS al_dia,
               count(*) FILTER (WHERE cr.status = 'MISSING' AND {exigible_sql('cr')}) AS falta
        FROM public.compliance_records cr
        WHERE cr.requirement_id = $1 AND cr.is_current
        """,
        requirement_id,
    )
    return dict(fila)
