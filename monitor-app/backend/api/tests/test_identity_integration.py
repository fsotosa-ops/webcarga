"""Identidad de RUT y patente contra la base real (D1 §7.2, Review Focus 5).

La paridad compara el normalizador de Python con public.canonical_rut y
public.canonical_plate sobre la tabla de casos y 400 cadenas generadas con
semilla fija. Los buscadores se prueban con una empresa guardada con puntos y
otra sin puntos, buscadas al revés."""
from __future__ import annotations

import random
import uuid

import pytest

from app.routers.carriers import buscar_en_el_directorio, list_carriers
from app.routers.drivers import search_drivers
from app.services.document_matcher import EntityUniverse, match_document, Catalog, RequirementAlias
from app.utils.identity import canonical_plate, canonical_rut
from tests.conftest import PoolDeUnaConexion
from tests.test_identity import PLATE_CASES, RUT_CASES

pytestmark = pytest.mark.integracion


def _generadas(n: int = 400) -> list[str]:
    rnd = random.Random(20261012)
    alfabeto = "0123456789" * 3 + "kK.- " + "ABRTZñ·\t"
    return ["".join(rnd.choice(alfabeto) for _ in range(rnd.randint(0, 14))) for _ in range(n)]


async def test_paridad_normalizador_python_y_base(conexion_revertida):
    entradas = [r for r, _ in RUT_CASES] + [p for p, _ in PLATE_CASES] + _generadas()
    filas = await conexion_revertida.fetch(
        "SELECT x.v, public.canonical_rut(x.v) AS rut, public.canonical_plate(x.v) AS plate "
        "FROM unnest($1::text[]) WITH ORDINALITY AS x(v, n) ORDER BY x.n", entradas)
    distintos = [(f["v"], f["rut"], canonical_rut(f["v"]), f["plate"], canonical_plate(f["v"]))
                 for f in filas if (f["rut"], f["plate"]) != (canonical_rut(f["v"]), canonical_plate(f["v"]))]
    assert len(filas) == len(entradas)
    assert distintos == []
    # Sin casos válidos la paridad pasaría por vacío.
    assert sum(f["rut"] is not None for f in filas) >= 10 and sum(f["plate"] is not None for f in filas) >= 5


async def _empresa(conn, tax_id: str) -> str:
    return str(await conn.fetchval(
        "INSERT INTO public.carriers (business_name, tax_id, operational_status) VALUES ($1, $2, 'ACTIVE') RETURNING id",
        f"ZZ-TEST-D1 Identidad {uuid.uuid4().hex[:6]}", tax_id))


async def _ids_de_carriers(pool, q: str) -> set[str]:
    # Si la T5 cambió la firma de list_carriers, se adapta la llamada, no la aserción.
    res = await list_carriers(q=q, operational_status="", page=1, limit=100, pool=pool, _=None)
    return {str(r["id"]) for r in res["data"]}


async def test_rut_con_y_sin_puntos_encuentra_la_misma_empresa(conexion_revertida):
    """Review Focus 5: mismo resultado en /carriers?q, /buscar y el reconocedor (con y
    sin tipo declarado), con el RUT guardado con puntos y buscado sin puntos, y al revés."""
    conn = conexion_revertida
    pool = PoolDeUnaConexion(conn)
    con_puntos = await _empresa(conn, "10.000.013-K")      # guardado no canónico
    canonica = await _empresa(conn, "10000027-K")           # guardado canónico

    for q, esperada in [("10000013-K", con_puntos), ("10000013k", con_puntos),
                        ("10.000.027-k", canonica), ("10000027", canonica)]:
        assert esperada in await _ids_de_carriers(pool, q), f"/carriers?q={q}"
        buscar = await buscar_en_el_directorio(q=q, limit=50, pool=pool, _=None)
        assert esperada in {str(e["id"]) for e in buscar["empresas"]}, f"/buscar?q={q}"

    catalogo = Catalog(aliases=[RequirementAlias("r-f30", "CARRIER", "F30", 100)])
    for tax_id, archivo, esperada in [("10.000.013-K", "F30 10000013k.pdf", con_puntos),
                                      ("10000027-K", "F30 10.000.027-K.pdf", canonica)]:
        universo = EntityUniverse(carriers=[(esperada, tax_id, "ZZ")])
        assert [c.entity_id for c in match_document(file_name=archivo, catalog=catalogo, universe=universo)] == [esperada]
        declarado = match_document(file_name=archivo, catalog=Catalog(), universe=universo,
                                   declared_requirement=RequirementAlias("r-f30", "CARRIER", "F30"))
        assert [c.entity_id for c in declarado] == [esperada]


async def test_rut_de_conductor_con_puntos_en_drivers(conexion_revertida):
    conn = conexion_revertida
    driver = str(await conn.fetchval(
        "INSERT INTO public.drivers (full_name, tax_id, operational_status) VALUES ($1, '10000004-0', 'ACTIVE') RETURNING id",
        f"ZZ-TEST-D1 Conductor {uuid.uuid4().hex[:6]}"))
    filas = await search_drivers(q="10.000.004-0", limit=50, pool=PoolDeUnaConexion(conn), _=None)
    assert driver in {str(r["driver_id"]) for r in filas}


async def test_patente_con_guion_en_buscar(conexion_revertida):
    conn = conexion_revertida
    plate = f"ZZ{uuid.uuid4().hex[:4].upper()}"
    asset = str(await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type) VALUES ($1, 'TRACTOCAMION') RETURNING id", plate))
    q = f"{plate[:4]}-{plate[4:]}".lower()
    r = await buscar_en_el_directorio(q=q, limit=50, pool=PoolDeUnaConexion(conn), _=None)
    assert asset in {str(v["id"]) for v in r["vehiculos"]}


async def test_un_texto_con_letras_no_busca_por_rut(conexion_revertida):
    """C-R12: "Transportes 2000" no puede traer a cada empresa cuyo RUT contenga 2000."""
    conn = conexion_revertida
    cid = await _empresa(conn, "12000000-4")   # DV válido (rut_check_digit("12000000") == "4")
    pool = PoolDeUnaConexion(conn)
    assert cid not in await _ids_de_carriers(pool, "ZZQQ 2000")
    # Sin letras, la clave sí busca: si esto falla, la exclusión de arriba pasaba por vacío.
    assert cid in await _ids_de_carriers(pool, "2000000")


async def test_la_patente_con_guion_vincula_el_equipo(conexion_revertida):
    from app.routers.trips import _activo_de_la_patente
    conn = conexion_revertida
    plate = f"ZZ{uuid.uuid4().hex[:4].upper()}"
    asset = str(await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type) VALUES ($1, 'TRACTOCAMION') RETURNING id", plate))
    assert await _activo_de_la_patente(conn, f"{plate[:4]}-{plate[4:]}", None) == (asset, plate)


async def test_fuzzy_match_prioriza_el_rut_exacto_del_tms(conexion_revertida):
    """El TMS adjunta el RUT ("NOMBRE / 12345678-9"): un RUT exacto va primero,
    aunque el nombre difiera."""
    from app.routers.drivers import fuzzy_match_drivers
    conn = conexion_revertida
    driver = str(await conn.fetchval(
        "INSERT INTO public.drivers (full_name, tax_id, operational_status) VALUES ($1, '10000004-0', 'ACTIVE') RETURNING id",
        f"ZZ-TEST-D1 Fuzzy {uuid.uuid4().hex[:6]}"))
    filas = await fuzzy_match_drivers(name="Qwerty Asdfgh / 10.000.004-0", limit=5, pool=PoolDeUnaConexion(conn), _=None)
    assert filas and str(filas[0]["driver_id"]) == driver
