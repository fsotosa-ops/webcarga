"""Tarea de arreglo (punto 5): el cableado del clasificador ejercitado contra
Postgres de verdad, no contra un AsyncMock.

QUE CUBRE ESTO QUE `test_document_ingest.py` NO CUBRE. Los tests de ese
archivo mockean `conn.fetchrow`: el mock devuelve lo que le pusimos, nunca lo
que Postgres aceptaria. Aserciones como `assert "entity_id" in sql` miran el
TEXTO de la consulta — el codigo diciendo su propio nombre — y siguen en
verde aunque se intercambien los argumentos posicionales (`mejor.entity_type`
por `mejor.entity_id`, por ejemplo). Esto ejecuta el INSERT real con un
candidato conocido y lee las seis columnas de vuelta, columna por columna:
cubre de una vez la alineacion de los 12 placeholders, la conversion
`float` -> `numeric` y los casts `::uuid`.

Corre dentro de la transaccion revertida de `conexion_revertida`: nada de
esto queda escrito.
"""
from __future__ import annotations

import io
import json
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import UploadFile
from starlette.datastructures import Headers

from app.routers.document_ingest import _ingest_files
from app.services.document_matcher import MatchCandidate
from tests.conftest import USER

pytestmark = pytest.mark.integracion

PREFIJO = "ZZ-TEST-INTEGRACION"


def _archivo(nombre: str = "licencia.pdf") -> UploadFile:
    return UploadFile(
        io.BytesIO(b"%PDF-1.4"),
        filename=nombre,
        headers=Headers({"content-type": "application/pdf"}),
    )


def _supabase_ok():
    supabase = MagicMock()
    supabase.storage.from_.return_value.upload.return_value = None
    return supabase


async def _requisito(conn) -> str:
    """Un requisito sintetico, solo para tener un `requirement_id` real que
    el `::uuid` de la columna FK pueda aceptar."""
    return await conn.fetchval(
        """
        INSERT INTO public.compliance_requirements
            (target_entity, requirement_code, name, requirement_level, expiration_policy)
        VALUES ('DRIVER', $1, $2, 'LEGAL_MANDATORY', 'NONE')
        RETURNING id::text
        """,
        f"ZZ_{uuid4().hex[:8].upper()}", f"{PREFIJO} requisito",
    )


async def test_las_seis_columnas_de_destino_llegan_a_su_columna(conexion_revertida, monkeypatch):
    conn = conexion_revertida
    requirement_id = await _requisito(conn)
    entity_id = str(uuid4())
    candidato = MatchCandidate(
        entity_type="DRIVER",
        entity_id=entity_id,
        requirement_id=requirement_id,
        confidence=0.95,
        evidence={"entity": {"via": "RUT", "score": 0.95, "raw": "1-9"}},
    )
    monkeypatch.setattr(
        "app.routers.document_ingest.match_document", lambda **kw: [candidato],
    )

    batch_id, items, errors = await _ingest_files(
        conn, _supabase_ok(), carrier_id=None, files=[_archivo()], actor=USER["sub"],
    )

    assert not errors
    assert len(items) == 1
    item_id = items[0]["id"]

    fila = await conn.fetchrow(
        """
        SELECT match_status, entity_type, entity_id::text, requirement_id::text,
               confidence, match_evidence, error
        FROM public.document_ingest_items WHERE id = $1
        """,
        item_id,
    )

    # AUTO porque hay un solo candidato, con requisito resuelto y confianza
    # >= 0.90 — es la misma regla que classify_match aplica en document_matcher.py.
    assert fila["match_status"] == "AUTO"
    assert fila["entity_type"] == "DRIVER"
    assert fila["entity_id"] == entity_id
    assert fila["requirement_id"] == requirement_id
    assert float(fila["confidence"]) == pytest.approx(0.95)
    assert json.loads(fila["match_evidence"])["entity"]["via"] == "RUT"
    assert fila["error"] is None


async def test_un_empate_real_deja_las_cuatro_columnas_de_destino_en_null(conexion_revertida, monkeypatch):
    """AMBIGUOUS no tiene un ganador: escribir `candidatos[0]` seria un
    desempate arbitrario definido por el orden de recorrido del motor. Las
    cuatro columnas de destino tienen que llegar en NULL de verdad —no solo
    en el objeto Python en memoria— y `candidates` tiene que conservar las
    dos opciones."""
    conn = conexion_revertida
    d1, d2 = str(uuid4()), str(uuid4())
    empatados = [
        MatchCandidate(entity_type="DRIVER", entity_id=d1, requirement_id=None,
                        confidence=0.70, evidence={"entity": {"via": "NOMBRE_FUZZY"}}),
        MatchCandidate(entity_type="DRIVER", entity_id=d2, requirement_id=None,
                        confidence=0.69, evidence={"entity": {"via": "NOMBRE_FUZZY"}}),
    ]
    monkeypatch.setattr(
        "app.routers.document_ingest.match_document", lambda **kw: empatados,
    )

    batch_id, items, errors = await _ingest_files(
        conn, _supabase_ok(), carrier_id=None, files=[_archivo("ANEXO 3 Felipe.jpeg")],
        actor=USER["sub"],
    )

    assert not errors
    item_id = items[0]["id"]

    fila = await conn.fetchrow(
        """
        SELECT match_status, entity_type, entity_id, requirement_id, confidence, candidates
        FROM public.document_ingest_items WHERE id = $1
        """,
        item_id,
    )

    assert fila["match_status"] == "AMBIGUOUS"
    assert fila["entity_type"] is None
    assert fila["entity_id"] is None
    assert fila["requirement_id"] is None
    assert fila["confidence"] is None
    assert len(json.loads(fila["candidates"])) == 2
