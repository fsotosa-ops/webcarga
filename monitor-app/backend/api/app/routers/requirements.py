"""Catálogo de requisitos de cumplimiento (public.compliance_requirements).

Router aparte de compliance.py: el catálogo describe QUÉ se exige, no el
estado de un compliance_record concreto, así que no cuelga de
/compliance-records. Extraído de compliance.py (que ya tenía 982 líneas)
para poder crecer con la configuración de condiciones y el recálculo sin
seguir engordando ese archivo.
"""
import json
from datetime import date
from uuid import UUID
from contextlib import asynccontextmanager
from typing import Literal, Optional

import asyncpg
from fastapi import APIRouter, Depends, HTTPException

from ..auth import get_current_user
from ..authz import Permission, require
from ..db import get_pool
from ..schemas.compliance import RequirementDetail, RequirementOption
from ..schemas.requirement import (
    RecalcPreview,
    RecalcResult,
    RequirementAliasBody,
    RequirementConditionsPatchBody,
    RequirementCreateBody,
    VigenciaBody,
)
from ..services.requirement_conditions import (
    SQL_CONDICION_DE_ENTIDAD,
    TABLA_DE_ENTIDAD,
    calcular_diferencias,
)
from ..services.edicion_catalogo import (
    _CONDITION_COLUMN_CASTS,  # noqa: F401 — lo recorren los tests de la whitelist
    RequisitoNoEncontrado,
    aplicar_cambio,
    aplicar_recalculo,
    contar_estados,
)
from ..services.catalogo import DocumentoYaExiste, crear_requisito
from ..services.vencimientos import cubierto_predicate, exigible_sql, in_scope_sql
from ..services.vigencia import (
    PARAMETROS,
    SQL_HISTORIAL_REGLA_BASE,
    guardar_vigencia,
    regla_base_json_sql,
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


# Cert 4 (L6, Entrega C 14/10): el universo es el que está EN ALCANCE, la misma regla que
# Pendientes (vencimientos.in_scope_sql): empresa activa; conductor o equipo de la flota activa
# (app.active_fleet) de una empresa activa. "Alcanza 5 de 5" contaba también a los dados de
# baja, y Certificación después contaba otra cifra. La siembra no cambia: sigue creando registros
# para todos, para que quien se reactiva vuelva con sus pendientes (ruling del 11/10).
_EN_ALCANCE = {
    "CARRIER": "e.operational_status = 'ACTIVE'",
    "DRIVER": ("EXISTS (SELECT 1 FROM app.active_fleet af JOIN public.carriers ac ON ac.id = af.carrier_id "
               "AND ac.operational_status = 'ACTIVE' WHERE af.entity_type = 'DRIVER' AND af.entity_id = e.id)"),
    "ASSET": ("EXISTS (SELECT 1 FROM app.active_fleet af JOIN public.carriers ac ON ac.id = af.carrier_id "
              "AND ac.operational_status = 'ACTIVE' WHERE af.entity_type = 'ASSET' AND af.entity_id = e.id)"),
}


def _lateral(entidad: str, condicion: str) -> str:
    return f"""
    LEFT JOIN LATERAL (
        SELECT count(*) FILTER (WHERE {condicion}) AS alcanzadas,
               count(*)                            AS universo
        FROM {TABLA_DE_ENTIDAD[entidad]} e
        WHERE req.target_entity = '{entidad}' AND {_EN_ALCANCE[entidad]}
    ) alcance_{entidad.lower()} ON true"""


def _columna(campo: str) -> str:
    ramas = " ".join(
        f"WHEN '{entidad}' THEN alcance_{entidad.lower()}.{campo}"
        for entidad in SQL_CONDICION_DE_ENTIDAD
    )
    return f"CASE req.target_entity {ramas} END AS {campo}"


SQL_CATALOGO = f"""
    SELECT req.id::text, req.target_entity, req.requirement_code, req.name,
           req.requirement_level,
           -- La única fuente de la fecha: el booleano viejo se retiró (HU-C1).
           req.expiration_policy,
           -- La regla base que rige HOY (HU-C1, entrega 2b). Es la misma
           -- consulta de services/vigencia.py, correlacionada con `req`.
           {regla_base_json_sql('req')} AS vigencia,
           (SELECT count(*) > 1 FROM public.compliance_requirement_rules r
            WHERE r.requirement_id = req.id AND r.shipper_id IS NULL) AS tiene_versiones,
           req.exigible_on,
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
           {_columna("universo")},
           COALESCE(cum.cumplen, 0) AS cumplen,
           COALESCE(cum.exigidos, 0) AS exigidos
    FROM public.compliance_requirements req
    LEFT JOIN (
        SELECT requirement_id, array_agg(alias ORDER BY priority DESC, alias) AS aliases
        FROM public.requirement_filename_aliases
        GROUP BY requirement_id
    ) al ON al.requirement_id = req.id
    -- "Cumplen n de m": de los registros que se exigen hoy a quienes están en
    -- alcance (m), cuántos están al día (n). Los dos de la misma población y
    -- con los mismos predicados que Pendientes, así n <= m y "no cumplen" es
    -- lo que Pendientes lista. Una agregación para todo el catálogo.
    LEFT JOIN (
        SELECT cr.requirement_id,
               count(*) FILTER (WHERE {cubierto_predicate('cr')}) AS cumplen,
               count(*) FILTER (WHERE {exigible_sql('cr')})       AS exigidos
        FROM public.compliance_records cr
        WHERE cr.is_current AND {in_scope_sql('cr')}
        GROUP BY cr.requirement_id
    ) cum ON cum.requirement_id = req.id
    {"".join(_lateral(entidad, condicion)
             for entidad, condicion in SQL_CONDICION_DE_ENTIDAD.items())}
    WHERE ($1::text IS NULL OR req.target_entity = $1)
      AND ($2::uuid IS NULL OR req.id = $2)
    ORDER BY req.target_entity, req.name
"""

# La lista blanca de columnas editables vive con el UPDATE que la usa
# (services/edicion_catalogo.py); se reexporta para los tests que la recorren.


@requirements_router.get("", response_model=list[RequirementOption])
async def list_compliance_requirements(
    target_entity: Optional[Literal["CARRIER", "DRIVER", "ASSET"]] = None,
    pool=Depends(get_pool),
    _=Depends(require(Permission.CERTIFICATION_READ)),
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
    return [_fila_del_catalogo(row) for row in await pool.fetch(SQL_CATALOGO, target_entity, None)]


def _fila_del_catalogo(row) -> dict:
    """Una fila de SQL_CATALOGO con la forma de `RequirementOption`: la usan
    la lista y la ficha, para que las dos digan lo mismo del mismo documento."""
    fila = dict(row)
    fila["alcance"] = {"alcanzadas": fila.pop("alcanzadas"),
                       "universo":   fila.pop("universo")}
    # jsonb llega como texto: el pool no registra un codec para jsonb.
    if fila["vigencia"] is not None:
        fila["vigencia"] = json.loads(fila["vigencia"])
    return fila


@requirements_router.get("/{requirement_id}", response_model=RequirementDetail)
async def get_compliance_requirement(
    requirement_id: UUID,
    pool=Depends(get_pool),
    _=Depends(require(Permission.CERTIFICATION_READ)),
):
    """La ficha de un documento (Certificación › Documentos exigidos): la fila
    del catálogo y el historial de la regla base."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(SQL_CATALOGO, None, requirement_id)
        if row is None:
            raise HTTPException(404, "El documento no existe.")
        fila = _fila_del_catalogo(row)
        fila["reglas"] = [
            # -infinity (date.min en asyncpg) es la versión original: "desde siempre".
            {**dict(r), "vigente_desde": None if r["vigente_desde"] == date.min else r["vigente_desde"]}
            for r in await conn.fetch(SQL_HISTORIAL_REGLA_BASE, requirement_id)
        ]
    return fila


# Los mensajes de la base, legibles. La coherencia de la vigencia la valida
# un CONSTRAINT TRIGGER diferido, que falla al CONFIRMAR la transacción: el
# error sale del `async with conn.transaction()`, no de la sentencia. Su
# mensaje ya está escrito para una persona (20261009100000); los CHECK de
# columna no, y se traducen acá por nombre de restricción.
_MENSAJE_DE_RESTRICCION = {
    "compliance_requirements_exigible_on_entity_check":
        "Desde el mes siguiente al ingreso y al término solo aplican a conductores.",
}


@asynccontextmanager
async def _transaccion_legible(conn):
    try:
        async with conn.transaction():
            # Diferidos durante el bloque (el tipo y su regla se escriben en
            # dos sentencias), e inmediatos al final.
            await conn.execute("SET CONSTRAINTS ALL DEFERRED")
            yield
            # Los chequeos diferidos corren al confirmar la transacción de
            # NIVEL SUPERIOR. Forzarlos acá hace que fallen dentro de este
            # `try` —con su mensaje— y no después, como un 500; y que también
            # fallen cuando esta transacción es un savepoint de otra.
            await conn.execute("SET CONSTRAINTS ALL IMMEDIATE")
    except asyncpg.CheckViolationError as error:
        raise HTTPException(
            422, _MENSAJE_DE_RESTRICCION.get(error.constraint_name, error.message)
        ) from error


@requirements_router.post("", status_code=201)
async def create_requirement(
    body: RequirementCreateBody,
    pool=Depends(get_pool), user=Depends(require(Permission.CERTIFICATION_CONFIGURE)),
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
    try:
        async with pool.acquire() as conn, _transaccion_legible(conn):
            return await crear_requisito(conn, body, actor=user["sub"])
    except DocumentoYaExiste as error:
        raise HTTPException(409, str(error)) from error


@requirements_router.get("/{requirement_id}/aliases")
async def list_requirement_aliases(
    requirement_id: str, pool=Depends(get_pool), _=Depends(require(Permission.CERTIFICATION_READ)),
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
    pool=Depends(get_pool), user=Depends(require(Permission.CERTIFICATION_CONFIGURE)),
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
    pool=Depends(get_pool), user=Depends(require(Permission.CERTIFICATION_CONFIGURE)),
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
    pool=Depends(get_pool), user=Depends(require(Permission.CERTIFICATION_CONFIGURE)),
):
    """Cambia la regla, NO los registros. Aplicarla es un acto aparte
    (POST /recalc): guardar y aplicar son dos decisiones distintas.

    Admin, no editor: esto redefine a quién se le exige cada documento del
    catálogo — la misma altura de permiso que el resto de la configuración
    de catálogo del backend (app/routers/config.py, status_taxonomies.py)."""
    if not body.sent_fields():
        raise HTTPException(422, "Ningún campo enviado")
    async with pool.acquire() as conn, _transaccion_legible(conn):
        try:
            return await aplicar_cambio(conn, requirement_id, body, actor=user["sub"])
        except RequisitoNoEncontrado:
            raise HTTPException(404, "Requisito no encontrado")


class _Ensayo(Exception):
    """Se lanza para revertir el ensayo de la vista previa de vigencia."""


@requirements_router.post("/{requirement_id}/expiration-rule/preview")
async def preview_vigencia(
    requirement_id: str, body: VigenciaBody,
    pool=Depends(get_pool), _=Depends(require(Permission.CERTIFICATION_CONFIGURE)),
):
    """Qué pasaría con los documentos de este tipo si se guardara esta
    vigencia, ANTES de guardarla.

    No hay una estimación aparte: se guarda de verdad dentro de una
    transacción, se cuenta con los mismos predicados de vencimientos.py y se
    revierte siempre. Así la vista previa no puede decir algo distinto de lo
    que la pantalla va a mostrar después."""
    async with pool.acquire() as conn:
        antes = await contar_estados(conn, requirement_id)
        resultado: dict = {}
        try:
            async with _transaccion_legible(conn):
                cambio = await guardar_vigencia(conn, requirement_id, body)
                await conn.execute("SET CONSTRAINTS ALL IMMEDIATE")  # validar antes de contar
                resultado = {"despues": await contar_estados(conn, requirement_id),
                             "rige_desde_hoy": cambio["rige_desde_hoy"]}
                raise _Ensayo
        except _Ensayo:
            pass
    return {"antes": antes, **resultado}


@requirements_router.get("/{requirement_id}/recalc-preview", response_model=RecalcPreview)
async def recalc_preview(
    requirement_id: str, pool=Depends(get_pool), _=Depends(require(Permission.CERTIFICATION_READ)),
):
    """Sólo lectura. Sin esto la configuración miente: se cambia la regla y la
    pantalla sigue mostrando lo viejo."""
    d = await calcular_diferencias(pool, requirement_id)
    if d["target_entity"] is None:
        raise HTTPException(404, "Requisito no encontrado")
    return {"crear": len(d["crear"]), "quitar": len(d["quitar"]), "bloqueados": len(d["bloqueados"])}


@requirements_router.post("/{requirement_id}/recalc", response_model=RecalcResult)
async def recalc(
    requirement_id: str, pool=Depends(get_pool), user=Depends(require(Permission.CERTIFICATION_CONFIGURE)),
):
    """Admin, no editor: puede sacar de circulación cientos de
    compliance_records de una (ver docstring de patch_requirement_conditions).

    No borra: enciende y apaga. `is_current` es el interruptor —el mismo que
    ya usa `reconcile_carrier_shipper_link` al desactivar un vínculo
    empresa-cliente— y `compliance_records` no tiene tabla de historial, así
    que un DELETE físico era irreversible por definición. Es además el
    estándar del rubro (cumplimiento, nómina, contabilidad): un requisito que
    deja de corresponder se marca como tal, no se borra."""
    async with pool.acquire() as conn, conn.transaction():
        resultado = await aplicar_recalculo(conn, requirement_id, actor=user["sub"])
    if resultado is None:
        raise HTTPException(404, "Requisito no encontrado")
    return resultado
