"""Entrega D (docs/superpowers/plans/2026-10-15-entrega-d-por-asignar.md): una forma de subir
documentos con el contexto que haya, y Por asignar como bandeja de excepciones. D1 y D2."""
from __future__ import annotations

import uuid

import pytest

from app.services.upload_match import match_files
from tests import d1_subjects as s

pytestmark = pytest.mark.integracion


async def _rut(conn) -> str:
    from app.utils.identity import rut_check_digit
    n = str(42_000_000 + uuid.uuid4().int % 1_000_000)
    return f"{n}-{rut_check_digit(n)}"


async def _requisito_con_alias(conn, entity: str, alias: str) -> str:
    """Un requisito activo que se reconoce por `alias` en el nombre del archivo."""
    req = await s.requirement(conn, entity=entity)
    await conn.execute("UPDATE public.compliance_requirements SET is_active = true WHERE id = $1", req)
    await conn.execute(
        "INSERT INTO public.requirement_filename_aliases (requirement_id, alias, priority) VALUES ($1, $2, 100)",
        req, alias)
    return req


async def _empresa_que_debe(conn, req: str) -> tuple[str, str, str]:
    carrier = await s.carrier(conn)
    rut = await _rut(conn)
    await conn.execute("UPDATE public.carriers SET tax_id = $2 WHERE id = $1", carrier, rut)
    await s.without_seeding(conn, carrier)
    record = await s.record(conn, req, "CARRIER", carrier)
    return carrier, rut, record


async def test_d1_sin_contexto_propone_registro_y_tipo_por_el_nombre(conexion_revertida):
    conn = conexion_revertida
    alias = f"ZZDOC{uuid.uuid4().hex[:6].upper()}"
    req = await _requisito_con_alias(conn, "CARRIER", alias)
    carrier, rut, record = await _empresa_que_debe(conn, req)

    res = await match_files(conn, [f"{alias} {rut}.pdf", "IMG_4905.PNG"])

    propuesto, sin_pista = res["files"]
    assert (propuesto["status"], propuesto["record_id"], propuesto["requirement_id"], propuesto["reason"]) == (
        "matched", record, req, "rut")
    assert res["requirements"][req]["requirement_code"].startswith("ZZ_D1_")
    assert sin_pista["status"] == "unmatched" and sin_pista["record_id"] is None


async def test_d1_con_la_empresa_elegida_alcanza_el_alias_y_solo_propone_lo_que_se_debe(conexion_revertida):
    """Desde la ficha: el nombre no trae RUT, pero la empresa es la elegida. Un documento
    que esa empresa ya tiene al día no se propone (queda para Por asignar)."""
    conn = conexion_revertida
    alias = f"ZZDOC{uuid.uuid4().hex[:6].upper()}"
    req = await _requisito_con_alias(conn, "CARRIER", alias)
    carrier, _rut_, record = await _empresa_que_debe(conn, req)

    res = await match_files(conn, [f"{alias} escaneado.pdf"], carrier_id=carrier)
    assert (res["files"][0]["record_id"], res["files"][0]["reason"]) == (record, "declared")

    await conn.execute("UPDATE public.compliance_records SET status = 'APPROVED_MANUAL', file_url = 'zz/x.pdf', "
                       "expiration_date = public.hoy_chile() + 300 WHERE id = $1", record)
    res = await match_files(conn, [f"{alias} escaneado.pdf"], carrier_id=carrier)
    assert res["files"][0]["status"] == "unmatched"


async def test_d1_con_el_tipo_fijado_es_lo_de_pendientes(conexion_revertida):
    """Mismo servicio, con el tipo como contexto: el nombre de la empresa alcanza aunque
    el archivo no diga el tipo, y solo entre quienes lo deben."""
    conn = conexion_revertida
    req = await _requisito_con_alias(conn, "CARRIER", f"ZZDOC{uuid.uuid4().hex[:6].upper()}")
    carrier, _rut_, record = await _empresa_que_debe(conn, req)
    nombre = await conn.fetchval("SELECT business_name FROM public.carriers WHERE id = $1", carrier)

    res = await match_files(conn, [f"{nombre}.pdf"], requirement_id=req)

    assert (res["files"][0]["record_id"], res["files"][0]["reason"]) == (record, "name")


async def test_d2_lo_que_llega_con_tipo_y_sin_titular_queda_en_falta_el_titular(conexion_revertida):
    """Lo Sin asignar de una revisión llega a la bandeja con su tipo (sin mockear el
    reconocedor: el tipo es contexto y el nombre no dice de quién es). La cola lo trae
    con el tipo y sin titular, que es lo que Por asignar agrupa como "Falta el titular"."""
    from app.routers.document_ingest import list_queue
    from tests.conftest import USER, PoolDeUnaConexion
    from tests.test_sin_clasificar_minima_integration import _file, _supabase
    from app.routers.document_ingest import _ingest_files

    conn = conexion_revertida
    req = await _requisito_con_alias(conn, "DRIVER", f"ZZDOC{uuid.uuid4().hex[:6].upper()}")
    _, items, _, _ = await _ingest_files(conn, _supabase(), carrier_id=None, files=[_file(uuid.uuid4().bytes, "IMG_4905.PNG")],
                                         actor=USER["sub"], requirement_id=req)

    rows = (await list_queue(pool=PoolDeUnaConexion(conn), _=None))["rows"]
    row = next(r for r in rows if r["id"] == items[0]["id"])
    assert (row["suggested_requirement_id"], row["suggested_entity_id"]) == (req, None)
