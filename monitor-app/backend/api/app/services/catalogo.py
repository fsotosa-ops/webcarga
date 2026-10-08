"""Dar de alta un tipo de documento en el catálogo.

Una sola definición del alta, que comparten "Nuevo documento" en
Configuración (POST /compliance-requirements) y la carga del catálogo de
WebCarga (scripts/cargar_catalogo_webcarga.py, HU-C1 entrega 2b). Dos caminos
de alta serían dos ideas de qué es un documento nuevo bien creado: el código,
el alias que lo hace visible al clasificador y la vigencia.
"""
from __future__ import annotations

import re
import unicodedata

from ..schemas.requirement import RequirementCreateBody
from .audit import log_change
from .document_matcher import normalize_text
from .vigencia import guardar_vigencia


class DocumentoYaExiste(Exception):
    """Ya hay un documento de esa entidad con el mismo código."""

    def __init__(self, entidad: str, codigo: str):
        super().__init__(
            f"Ya existe un documento de {entidad} con el codigo {codigo}. Cambia el nombre.")
        self.codigo = codigo


def codigo_desde_nombre(nombre: str) -> str:
    """`F30 Multas` -> `F30_MULTAS`. Sin acentos, sin puntuacion, sin dobles.

    Se DERIVA y no se recibe: `requirement_code` es la llave del motor de match,
    de los alias y del catalogo de vencimientos. Dejarla escribir invita a que
    dos documentos compartan codigo, o a que alguien la cambie despues y deje al
    clasificador sin poder resolver ese documento.
    """
    sin_acentos = unicodedata.normalize("NFKD", nombre).encode("ascii", "ignore").decode()
    limpio = re.sub(r"[^A-Za-z0-9]+", "_", sin_acentos).strip("_").upper()
    # Cortar a 60 puede dejar un "_" colgando al final (un código es una llave
    # para siempre: mejor que nazca limpio).
    return limpio[:60].rstrip("_") or "REQUISITO"


async def crear_requisito(conn, body: RequirementCreateBody, *, actor: str | None) -> dict:
    """Da de alta un tipo de documento, APAGADO, en la transacción de quien
    llama.

    Apagado no le aplica a nadie, así que el disparador de siembra no escribe
    un solo `compliance_record`. Insertarlo vigente sería una escritura masiva
    —87 registros por un requisito de conductor, hasta 124 por uno de
    vehículo— disparada por un formulario de alta.

    UN DOCUMENTO NUEVO NO PUEDE NACER INVISIBLE: sin un alias, el motor de match
    nunca lo encuentra en el nombre de un archivo. La semilla es el NOMBRE
    normalizado (lo que la gente escribe en el archivo), con la misma función
    que usa el motor, y prioridad 0: un alias más específico le gana.
    """
    codigo = codigo_desde_nombre(body.name)
    if await conn.fetchval(
        "SELECT 1 FROM public.compliance_requirements "
        "WHERE target_entity = $1 AND requirement_code = $2",
        body.target_entity, codigo,
    ):
        raise DocumentoYaExiste(body.target_entity, codigo)
    fila = await conn.fetchrow(
        """
        INSERT INTO public.compliance_requirements
            (requirement_code, name, target_entity, requirement_level,
             expiration_policy, exigible_on, shipper_id, is_active)
        VALUES ($1, $2, $3, $4, 'NONE', $5, $6::uuid, false)
        RETURNING id::text, requirement_code, name, target_entity,
                  requirement_level, exigible_on, is_active
        """,
        codigo, body.name, body.target_entity, body.requirement_level,
        body.exigible_on, body.shipper_id,
    )
    # El tipo y sus parámetros, por el mismo camino que la edición.
    await guardar_vigencia(conn, fila["id"], body.vigencia)
    alias = normalize_text(body.name)
    if alias:
        await conn.execute(
            "INSERT INTO public.requirement_filename_aliases "
            "(requirement_id, alias, priority) VALUES ($1::uuid, $2, 0) "
            "ON CONFLICT DO NOTHING",
            fila["id"], alias,
        )
    await log_change(
        conn, actor=actor, entity_type="REQUIREMENT", entity_id=fila["id"],
        action="create", field="requirement",
        new_value={"name": body.name, "target_entity": body.target_entity,
                   "vigencia": body.vigencia.model_dump(), "exigible_on": body.exigible_on},
    )
    return {**dict(fila), "expiration_policy": body.vigencia.politica}
