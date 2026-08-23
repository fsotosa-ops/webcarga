"""Catálogo de requisitos de cumplimiento (public.compliance_requirements).

Router aparte de compliance.py: el catálogo describe QUÉ se exige, no el
estado de un compliance_record concreto, así que no cuelga de
/compliance-records. Extraído de compliance.py (que ya tenía 982 líneas)
para poder crecer con la configuración de condiciones y el recálculo sin
seguir engordando ese archivo.
"""
import re
import unicodedata
from typing import Literal, Optional

import asyncpg
from fastapi import APIRouter, Depends, HTTPException

from ..services.document_matcher import normalize_text
from ..auth import get_current_user, require_admin
from ..db import get_pool
from ..schemas.compliance import RequirementOption
from ..schemas.requirement import (
    RecalcPreview,
    RecalcResult,
    RequirementAliasBody,
    RequirementConditionsPatchBody,
    RequirementCreateBody,
)
from ..services.audit import log_change
from ..services.revisiones import registrar_revision
from ..services.requirement_conditions import (
    SQL_CONDICION_DE_ENTIDAD,
    TABLA_DE_ENTIDAD,
    calcular_diferencias,
)

requirements_router = APIRouter(prefix="/compliance-requirements", tags=["compliance"])

# ── El alcance de cada regla ───────────────────────────────────────────────
#
# "Sólo Furgón Congelado" no dice si son veinte vehículos o dos. El alcance
# —"36 de 118"— es lo que convierte la regla en algo que se puede juzgar
# antes de aplicarla.
#
# La condición de cada entidad NO se escribe acá: se interpola desde
# `app/services/requirement_conditions.py`, que es donde vive la única
# definición. Una tercera copia del predicado (el trigger de siembra, la
# vista previa y esto) es exactamente el defecto que costó el crítico del
# Tramo 3: dos textos correctos por separado, y una pantalla mostrando lo que
# la otra no aplica.
#
# La condición está escrita sobre los alias `e` y `req`, así que el catálogo
# los provee: `req` es la fila que ya está leyendo, `e` la entidad candidata
# del LATERAL. Un LATERAL por entidad porque los universos son tablas
# distintas; el `WHERE req.target_entity = '...'` de adentro Postgres lo
# resuelve como One-Time Filter, así que para una fila ASSET las tablas de
# empresas y conductores no se recorren (37 filas: 3,7 ms medidos contra
# producción).
#
# El alcance NO mira `is_active`: cuenta a cuántos alcanza la CONDICIÓN. Una
# regla apagada sigue diciendo "248 de 248", que es lo que alguien necesita
# saber antes de encenderla; que esté vigente o no lo dice su propia columna.


def _lateral(entidad: str, condicion: str) -> str:
    return f"""
    LEFT JOIN LATERAL (
        SELECT count(*) FILTER (WHERE {condicion}) AS alcanzadas,
               count(*)                            AS universo
        FROM {TABLA_DE_ENTIDAD[entidad]} e
        WHERE req.target_entity = '{entidad}'
    ) alcance_{entidad.lower()} ON true"""


def _columna(campo: str) -> str:
    ramas = " ".join(
        f"WHEN '{entidad}' THEN alcance_{entidad.lower()}.{campo}"
        for entidad in SQL_CONDICION_DE_ENTIDAD
    )
    return f"CASE req.target_entity {ramas} END AS {campo}"


SQL_CATALOGO = f"""
    SELECT req.id::text, req.target_entity, req.requirement_code, req.name,
           req.requirement_level, COALESCE(req.has_expiration, false) AS has_expiration,
           -- La fuente de verdad de la fecha. `has_expiration` sigue viajando
           -- porque tiene lectores vivos, pero es el booleano de dos valores
           -- que cargaba tres significados: quien decida algo mira esta.
           req.expiration_policy,
           req.is_active,
           req.applies_to_fleet_service_type_ids::text[] AS applies_to_fleet_service_type_ids,
           req.applies_to_management_types,
           -- Los alias vienen EN el catálogo y no por fila. Son 37 documentos:
           -- pedirlos de a uno serían 37 consultas para dibujar una tabla, que
           -- es el patrón que este proyecto ya pagó al firmar una URL por
           -- archivo dentro de un listado. Además hace visible de un vistazo el
           -- documento que NO tiene ninguno — que es el que el clasificador no
           -- puede encontrar.
           COALESCE(al.aliases, ARRAY[]::text[]) AS aliases,
           {_columna("alcanzadas")},
           {_columna("universo")}
    FROM public.compliance_requirements req
    LEFT JOIN (
        SELECT requirement_id, array_agg(alias ORDER BY priority DESC, alias) AS aliases
        FROM public.requirement_filename_aliases
        GROUP BY requirement_id
    ) al ON al.requirement_id = req.id
    {"".join(_lateral(entidad, condicion)
             for entidad, condicion in SQL_CONDICION_DE_ENTIDAD.items())}
    WHERE ($1::text IS NULL OR req.target_entity = $1)
    ORDER BY req.target_entity, req.name
"""

# Lista blanca de columnas tocables por PATCH /conditions — nunca se
# interpolan nombres que vengan del request, solo estas tres literales.
# `sent_fields()` ya está acotado al mismo conjunto, pero se repite acá para
# que el cast SQL de cada columna quede a la vista de quien lea el router.
_CONDITION_COLUMN_CASTS: dict[str, Optional[str]] = {
    "is_active": None,
    "applies_to_fleet_service_type_ids": "uuid[]",
    "applies_to_management_types": "text[]",
    # Sin cast: es TEXT con CHECK, y el CHECK es la ultima red. La primera es
    # el `Literal` del schema, que devuelve 422 en vez de dejar reventar la
    # base con 500.
    "expiration_policy": None,
    # Sin cast: TEXT y TEXT. `name` es el nombre visible y renombrarlo es
    # inocuo -- nadie guarda copia, todas las pantallas hacen JOIN vivo.
    "name": None,
    # `requirement_level` decide A QUIEN SE LE EXIGE: los disparadores de
    # siembra sólo siembran LEGAL_MANDATORY. Cambiarlo agrega o quita
    # registros, y por eso -- como las condiciones -- guardar no aplica: eso
    # es POST /recalc.
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


@requirements_router.get("", response_model=list[RequirementOption])
async def list_compliance_requirements(
    target_entity: Optional[Literal["CARRIER", "DRIVER", "ASSET"]] = None,
    pool=Depends(get_pool),
    _=Depends(get_current_user),
):
    """Tipos de documento del catálogo, opcionalmente acotados a un tipo de
    entidad. Solo lectura: administrar el catálogo requiere migración (ver
    HU-05 de la épica Red de Transporte).

    Incluye is_active/applies_to_* (Tramo 3): la pantalla de condiciones
    (Task 5) los pinta directo desde esta lista, no hay un segundo endpoint
    "de detalle" para el catálogo. Y el alcance (Task 4), que la consulta
    trae en dos columnas planas y acá se agrupa en un solo objeto: la
    pantalla los muestra siempre juntos ("36 de 118") y separados invitan a
    leer uno sin el otro. El `pop` va sin valor por defecto a propósito — si
    la consulta dejara de traer una de las dos columnas, esto tiene que
    romperse, no devolver un cero inventado."""
    rows = await pool.fetch(SQL_CATALOGO, target_entity)
    catalogo = []
    for row in rows:
        fila = dict(row)
        fila["alcance"] = {"alcanzadas": fila.pop("alcanzadas"),
                           "universo":   fila.pop("universo")}
        catalogo.append(fila)
    return catalogo


def _codigo_desde_nombre(nombre: str) -> str:
    """`F30 Multas` -> `F30_MULTAS`. Sin acentos, sin puntuacion, sin dobles.

    Se DERIVA y no se recibe: `requirement_code` es la llave del motor de match,
    de los alias y del catalogo de vencimientos. Dejarla escribir invita a que
    dos documentos compartan codigo, o a que alguien la cambie despues y deje al
    clasificador sin poder resolver ese documento.
    """
    sin_acentos = unicodedata.normalize("NFKD", nombre).encode("ascii", "ignore").decode()
    limpio = re.sub(r"[^A-Za-z0-9]+", "_", sin_acentos).strip("_").upper()
    return limpio[:60] or "REQUISITO"


@requirements_router.post("", status_code=201)
async def create_requirement(
    body: RequirementCreateBody,
    pool=Depends(get_pool), user=Depends(require_admin),
):
    """Da de alta un tipo de documento, APAGADO.

    Apagado no le aplica a nadie, asi que el disparador de siembra no escribe
    un solo `compliance_record`. La siembra ocurre al activarlo, por el mismo
    camino que ya usa cambiar una condicion: `PATCH /conditions` para guardar
    la regla y `POST /recalc` para aplicarla, con su vista previa en medio.

    Insertarlo vigente seria una escritura masiva -- 87 registros por un
    requisito de conductor, hasta 124 por uno de vehiculo, sobre 5.121 -- 
    disparada por un formulario de alta.
    """
    codigo = _codigo_desde_nombre(body.name)
    async with pool.acquire() as conn:
        ya_existe = await conn.fetchval(
            "SELECT 1 FROM public.compliance_requirements "
            "WHERE target_entity = $1 AND requirement_code = $2",
            body.target_entity, codigo,
        )
        if ya_existe:
            raise HTTPException(
                409,
                f"Ya existe un documento de {body.target_entity} con el codigo "
                f"{codigo}. Cambia el nombre.",
            )
        fila = await conn.fetchrow(
            """
            INSERT INTO public.compliance_requirements
                (requirement_code, name, target_entity, requirement_level,
                 expiration_policy, shipper_id, is_active)
            VALUES ($1, $2, $3, $4, $5, $6::uuid, false)
            RETURNING id::text, requirement_code, name, target_entity,
                      requirement_level, expiration_policy, is_active
            """,
            codigo, body.name, body.target_entity, body.requirement_level,
            body.expiration_policy, body.shipper_id,
        )
        # UN DOCUMENTO NUEVO NO PUEDE NACER INVISIBLE.
        #
        # El motor de match resuelve buscando alias dentro del nombre del
        # archivo normalizado; sin un solo alias, el documento es invisible para
        # el clasificador y todo archivo suyo cae en "sin resolver" para
        # siempre. Desde que se pueden crear documentos desde la pantalla
        # (Ronda 140) eso pasaba con cada alta, en silencio: nada falla, el
        # documento simplemente nunca matchea.
        #
        # La semilla es el NOMBRE normalizado y no el `requirement_code`, porque
        # el nombre es lo que la gente escribe en el archivo: "Carpeta
        # Tributaria" aparece en "Carpeta_Tributaria_Regular_77094744-8.pdf",
        # mientras que un codigo interno no aparece en ningun archivo real.
        # Se normaliza con la MISMA funcion que usa el motor, para que no haya
        # dos ideas de "normalizado".
        #
        # Prioridad 0: es la semilla mas generica. Un alias mas especifico que
        # se agregue despues le gana, que es como esta disenado el desempate.
        alias = normalize_text(body.name)
        if alias:
            await conn.execute(
                "INSERT INTO public.requirement_filename_aliases "
                "(requirement_id, alias, priority) VALUES ($1::uuid, $2, 0) "
                "ON CONFLICT DO NOTHING",
                fila["id"], alias,
            )
    return dict(fila)


@requirements_router.get("/{requirement_id}/aliases")
async def list_requirement_aliases(
    requirement_id: str, pool=Depends(get_pool), _=Depends(get_current_user),
):
    """Las formas de escribir este documento en el nombre de un archivo."""
    rows = await pool.fetch(
        "SELECT id::text, alias, priority FROM public.requirement_filename_aliases "
        "WHERE requirement_id = $1::uuid ORDER BY priority DESC, alias",
        requirement_id,
    )
    return [dict(r) for r in rows]


@requirements_router.post("/{requirement_id}/aliases", status_code=201)
async def create_requirement_alias(
    requirement_id: str, body: RequirementAliasBody,
    pool=Depends(get_pool), user=Depends(require_admin),
):
    """Agrega una forma de escribirlo. Sin alias, un documento nuevo nace
    INVISIBLE para el clasificador."""
    try:
        fila = await pool.fetchrow(
            "INSERT INTO public.requirement_filename_aliases (requirement_id, alias, priority) "
            "VALUES ($1::uuid, $2, $3) RETURNING id::text, alias, priority",
            requirement_id, body.alias.strip().upper(), body.priority,
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(409, "Ese alias ya existe para este documento")
    return dict(fila)


@requirements_router.delete("/{requirement_id}/aliases/{alias_id}", status_code=204)
async def delete_requirement_alias(
    requirement_id: str, alias_id: str,
    pool=Depends(get_pool), user=Depends(require_admin),
):
    """Quita una forma de escribirlo. Acotado al requisito a proposito: sin el
    `requirement_id` en el WHERE, un id de otro documento se borraria igual."""
    result = await pool.execute(
        "DELETE FROM public.requirement_filename_aliases "
        "WHERE id = $1::uuid AND requirement_id = $2::uuid",
        alias_id, requirement_id,
    )
    if str(result).rsplit(" ", 1)[-1] == "0":
        raise HTTPException(404, "Ese alias no existe en este documento")


@requirements_router.patch("/{requirement_id}/conditions")
async def patch_requirement_conditions(
    requirement_id: str, body: RequirementConditionsPatchBody,
    pool=Depends(get_pool), user=Depends(require_admin),
):
    """Cambia la regla, NO los registros. Aplicarla es un acto aparte
    (POST /recalc): guardar y aplicar son dos decisiones distintas.

    Admin, no editor: esto redefine a quién se le exige cada documento del
    catálogo — la misma altura de permiso que el resto de la configuración
    de catálogo del backend (app/routers/config.py, status_taxonomies.py)."""
    touched = body.sent_fields()
    if not touched:
        raise HTTPException(422, "Ningún campo enviado")

    async with pool.acquire() as conn:
        async with conn.transaction():
            current = await conn.fetchrow(
                f"""
                SELECT id, {_COLUMNAS_EDITABLES}
                FROM public.compliance_requirements WHERE id = $1
                """,
                requirement_id,
            )
            if not current:
                raise HTTPException(404, "Requisito no encontrado")

            # UPDATE de ancho variable: solo entran las columnas efectivamente
            # enviadas, cada una con SU valor por placeholder — nunca COALESCE.
            # Con COALESCE, NULL solo puede significar "no lo mandaron", y
            # "lo mandaron NULL/[] a propósito" queda inexpresable. Los nombres
            # de columna salen únicamente de _CONDITION_COLUMN_CASTS (whitelist
            # fija); jamás del request.
            values: list = [requirement_id]
            set_parts = []
            for field in touched:
                values.append(getattr(body, field))
                cast = _CONDITION_COLUMN_CASTS[field]
                placeholder = f"${len(values)}" + (f"::{cast}" if cast else "")
                set_parts.append(f"{field} = {placeholder}")

            row = await conn.fetchrow(
                f"""
                UPDATE public.compliance_requirements SET
                    {", ".join(set_parts)}
                WHERE id = $1
                RETURNING id, requirement_code, {_COLUMNAS_EDITABLES}
                """,
                *values,
            )
            for field in touched:
                await log_change(
                    conn, actor=user["sub"], entity_type="REQUIREMENT", entity_id=requirement_id,
                    action="update", field=field,
                    old_value=current[field], new_value=getattr(body, field),
                )
            # GUARDAR CUENTA COMO REVISAR, y va en la MISMA transaccion que el
            # cambio: si el UPDATE se revierte, el registro de revision no puede
            # quedar diciendo que alguien decidio algo que no ocurrio.
            #
            # No se deduce de `audit_log` —que se acaba de escribir dos lineas
            # arriba— a proposito: "hay una fila en el log" significaria a la vez
            # "alguien lo cambio" y "alguien lo confirmo", y separar esos dos es
            # justamente para lo que existe el registro.
            await registrar_revision(
                conn, "certification", "conditions", requirement_id, user["sub"])
    return dict(row)


@requirements_router.get("/{requirement_id}/recalc-preview", response_model=RecalcPreview)
async def recalc_preview(
    requirement_id: str, pool=Depends(get_pool), _=Depends(get_current_user),
):
    """Sólo lectura. Sin esto la configuración miente: se cambia la regla y la
    pantalla sigue mostrando lo viejo."""
    d = await calcular_diferencias(pool, requirement_id)
    if d["target_entity"] is None:
        raise HTTPException(404, "Requisito no encontrado")
    return {"crear": len(d["crear"]), "quitar": len(d["quitar"]), "bloqueados": len(d["bloqueados"])}


@requirements_router.post("/{requirement_id}/recalc", response_model=RecalcResult)
async def recalc(
    requirement_id: str, pool=Depends(get_pool), user=Depends(require_admin),
):
    """Admin, no editor: puede sacar de circulación cientos de
    compliance_records de una (ver docstring de patch_requirement_conditions).

    No borra: enciende y apaga. `is_current` es el interruptor —el mismo que
    ya usa `reconcile_carrier_shipper_link` al desactivar un vínculo
    empresa-cliente— y `compliance_records` no tiene tabla de historial, así
    que un DELETE físico era irreversible por definición. Es además el
    estándar del rubro (cumplimiento, nómina, contabilidad): un requisito que
    deja de corresponder se marca como tal, no se borra."""
    d = await calcular_diferencias(pool, requirement_id)
    if d["target_entity"] is None:
        raise HTTPException(404, "Requisito no encontrado")

    creados_ids: list = []
    quitados_ids: list = []

    async with pool.acquire() as conn:
        async with conn.transaction():
            if d["crear"]:
                # `crear` incluye tanto entidades sin registro como entidades
                # con uno APAGADO (el `NOT EXISTS (... AND cr.is_current)` de
                # `calcular_diferencias` no distingue: para la regla, un
                # registro apagado es "no lo tiene"). El índice único
                # (entity_id, requirement_id) es TOTAL, no parcial, así que la
                # fila apagada sigue ocupando el lugar: con `DO NOTHING` el
                # INSERT la saltearía en silencio y el endpoint reportaría
                # "creados: N" sin haber encendido nada. El `DO UPDATE` toca
                # SÓLO el interruptor: un registro apagado puede tener
                # documento cargado (lo pudo apagar el trigger del vínculo
                # empresa-cliente, que no mira D13), y pisarle status/file_url/
                # metadata/expiration_date al resucitarlo sería destruir
                # trabajo real. `updated_at` tampoco se toca: alimenta
                # `last_document_update` de la lista de empresas, y volver a
                # exigir un requisito no es haber actualizado un documento.
                #
                # El `WHERE NOT is_current` del DO UPDATE es el ESPEJO del
                # `AND is_current` que el apagado de abajo lleva a propósito.
                # `d["crear"]` se calculó en otra conexión y en otra
                # transacción, así que entre el cálculo y este INSERT alguien
                # pudo encender una fila —reactivando un vínculo empresa-cliente
                # o recalculando en paralelo—. Sin el WHERE, esa fila se
                # reescribe `true` sobre `true`: entra en el RETURNING, infla
                # `creados`, y deja en `audit_log` un id que este recálculo
                # nunca cambió. Con el WHERE, encender es idempotente igual que
                # apagar.
                creados_rows = await conn.fetch(
                    """
                    INSERT INTO public.compliance_records
                        (entity_id, entity_type, requirement_id, status, is_current)
                    SELECT unnest($1::uuid[]), $2, $3, 'MISSING', true
                    ON CONFLICT (entity_id, requirement_id) DO UPDATE SET
                        is_current = true
                    WHERE NOT public.compliance_records.is_current
                    RETURNING id
                    """,
                    d["crear"], d["target_entity"], requirement_id,
                )
                creados_ids = [str(r["id"]) for r in creados_rows]
            if d["quitar"]:
                # D13, sin depender del reloj: la vista previa se calculó
                # fuera de esta transacción, así que el UPDATE vuelve a
                # comprobar el predicado en vez de confiar ciegamente en los
                # IDs que trajo `calcular_diferencias`. Si alguien subió un
                # archivo entre el cálculo y acá, la fila ya no matchea y
                # sigue vigente. `AND is_current` hace el apagado idempotente:
                # recalcular dos veces no vuelve a contar lo ya apagado.
                # `quitados` reporta lo efectivamente apagado (RETURNING), no
                # lo planeado.
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
            # Rastro forense: compliance_records no tiene tabla de historial,
            # así que aunque apagar ya no destruya nada, esto sigue siendo lo
            # único que dice QUÉ filas tocó cada recálculo.
            #
            # OJO con los nombres: `old_value` NO son filas borradas — son las
            # que se APAGARON (is_current = false), y siguen en la tabla con su
            # documento intacto. `new_value` incluye tanto filas nuevas como
            # filas que estaban apagadas y se volvieron a encender. Los nombres
            # vienen del contrato viejo (cuando esto sí borraba) y se conservan
            # a propósito para no partir a los consumidores en el mismo commit.
            await log_change(
                conn, actor=user["sub"], entity_type="REQUIREMENT", entity_id=requirement_id,
                action="recalc", field="compliance_records",
                old_value=quitados_ids, new_value=creados_ids, source="api",
            )
    # `quitados` = apagados, `creados` = creados o re-encendidos. Ver el
    # comentario del log_change de arriba: los nombres son del contrato
    # anterior al recálculo reversible; ninguna fila se borra acá.
    return {"creados": len(creados_ids), "quitados": len(quitados_ids),
            "bloqueados": len(d["bloqueados"])}
