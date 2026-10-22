"""La consulta de Analítica en el servidor (plan del módulo, Task 4).

Las filas se crean a mano en las tablas de `analytics` (son tablas de dbt, se puede insertar) en enero de 2025,
donde no hay nada más: así el total y las cifras son exactamente los del caso."""
from __future__ import annotations

import uuid
from datetime import date

import pytest
from fastapi import HTTPException

from app.services.analytics_query import fetch_page, parse_request

pytestmark = pytest.mark.integracion


async def _viaje(conn, *, codigo, planificado, entregado=None, cliente="Walmart", zona="RM", conductor=None,
                 empresa="Transportes Sur"):
    await conn.execute(
        "INSERT INTO analytics.bdot (trip_id, trip_code, planning_date, delivered_date, client_name, "
        "destination_zone, carrier_name, driver_id, is_assigned) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)",
        uuid.uuid4(), codigo, planificado, entregado, cliente, zona, empresa, conductor)


def _req(**params):
    base = {"dataset": "trips", "from": "2025-01-01", "to": "2025-01-31"}
    return parse_request({**base, **{k: str(v) for k, v in params.items()}}, purpose="rows")


async def test_el_periodo_usa_la_fecha_elegida(conexion_revertida):
    await _viaje(conexion_revertida, codigo="ZZ-A", planificado=date(2025, 1, 1), entregado=date(2025, 1, 3))
    por_plan = await fetch_page(conexion_revertida, _req(**{"from": "2025-01-01", "to": "2025-01-01"}), personal=False)
    por_entrega = await fetch_page(conexion_revertida, _req(**{"from": "2025-01-03", "to": "2025-01-03",
                                                              "date": "delivered"}), personal=False)
    al_reves = await fetch_page(conexion_revertida, _req(**{"from": "2025-01-03", "to": "2025-01-03"}), personal=False)
    assert [r["trip_code"] for r in por_plan["rows"]] == ["ZZ-A"]
    assert [r["trip_code"] for r in por_entrega["rows"]] == ["ZZ-A"]
    assert al_reves["total"] == 0


async def test_filtro_y_cifras_facetadas(conexion_revertida):
    for codigo, cliente, zona in [("ZZ-1", "Walmart", "RM"), ("ZZ-2", "Walmart", "RM"), ("ZZ-3", "Walmart", "Z0"),
                                  ("ZZ-4", "Sodimac", "RM")]:
        await _viaje(conexion_revertida, codigo=codigo, planificado=date(2025, 1, 10), cliente=cliente, zona=zona)
    page = await fetch_page(conexion_revertida, _req(**{"f.destination_zone": "RM"}), personal=False)
    assert page["total"] == 3
    assert page["counts"]["client_name"] == {"Walmart": 2, "Sodimac": 1}
    # La cifra de la columna filtrada no se cuenta con su propio filtro: muestra lo que habría al cambiarlo.
    assert page["counts"]["destination_zone"] == {"RM": 3, "Z0": 1}


async def test_paginacion_y_orden(conexion_revertida):
    for i in range(120):
        await _viaje(conexion_revertida, codigo=f"ZZ-{i:03d}", planificado=date(2025, 1, 5))
    page = await fetch_page(conexion_revertida, _req(size=50, page=1, sort="trip_code:asc"), personal=False)
    assert page["total"] == 120
    assert [r["trip_code"] for r in page["rows"]] == [f"ZZ-{i:03d}" for i in range(50, 100)]


@pytest.mark.parametrize("params", [{"f.drop_table": "x"}, {"sort": "1;--:asc"}, {"date": "otra"},
                                    {"size": "75"}, {"dataset": "gold"}])
def test_id_inventado_es_422(params):
    with pytest.raises(HTTPException) as exc:
        _req(**params)
    assert exc.value.status_code == 422


@pytest.mark.parametrize("params", [{"from": "2025-02-01", "to": "2025-01-01"},
                                    {"from": "2024-01-01", "to": "2025-02-05"}])
def test_periodo_invalido_es_422(params):
    with pytest.raises(HTTPException) as exc:
        _req(**params)
    assert exc.value.status_code == 422


async def test_sin_permiso_no_viaja_el_rut(conexion_revertida):
    conductor = uuid.uuid4()
    await conexion_revertida.execute(
        "INSERT INTO analytics.driver_identity (driver_id, driver_name, driver_tax_id) VALUES ($1, 'ZZ Persona', '1-9')",
        conductor)
    await _viaje(conexion_revertida, codigo="ZZ-P", planificado=date(2025, 1, 7), conductor=conductor)
    sin = await fetch_page(conexion_revertida, _req(), personal=False)
    con = await fetch_page(conexion_revertida, _req(), personal=True)
    assert all("driver_tax_id" not in r and "driver_name" not in r for r in sin["rows"])
    assert con["rows"][0]["driver_tax_id"] == "1-9"
    # Sin el permiso, filtrar por una columna personal tampoco existe.
    with pytest.raises(HTTPException):
        await fetch_page(conexion_revertida, _req(**{"f.driver_name": "ZZ Persona"}), personal=False)


async def test_filtro_de_lista_en_flota(conexion_revertida):
    for clave, clientes in [("k1", ["Walmart", "Sodimac"]), ("k2", ["Sodimac"]), ("k3", [])]:
        await conexion_revertida.execute(
            "INSERT INTO analytics.fleet_daily (fleet_day_key, business_date, subject_type, client_names) "
            "VALUES ($1, '2025-01-04', 'DRIVER', $2)", f"zz-{clave}", clientes)
    page = await fetch_page(conexion_revertida, parse_request(
        {"dataset": "fleet", "from": "2025-01-01", "to": "2025-01-31", "f.client_names": "Walmart"},
        purpose="rows"), personal=False)
    assert [r["_id"] for r in page["rows"]] == ["zz-k1"]
    assert page["counts"]["client_names"] == {"Sodimac": 2, "Walmart": 1}


async def test_un_valor_con_coma_viaja_codificado(conexion_revertida):
    """El frontend codifica cada valor (como writeView) para que una coma dentro de un valor no lo parta."""
    await _viaje(conexion_revertida, codigo="ZZ-C", planificado=date(2025, 1, 9), cliente="Lider, Express")
    page = await fetch_page(conexion_revertida, _req(**{"f.client_name": "Walmart,Lider%2C%20Express"}),
                            personal=False)
    assert [r["trip_code"] for r in page["rows"]] == ["ZZ-C"]


def test_la_tabla_dinamica_es_de_flota_y_hasta_20000():
    base = {"dataset": "fleet", "from": "2025-01-01", "to": "2025-01-31"}
    assert parse_request({**base, "size": "20000"}, purpose="pivot").size == 20000
    for malo in ({**base, "size": "20001"}, {**base, "dataset": "trips", "size": "100"}):
        with pytest.raises(HTTPException) as exc:
            parse_request(malo, purpose="pivot")
        assert exc.value.status_code == 422


def test_una_pagina_absurda_es_422():
    """Fix pass (M8): page=10**20 desbordaba el OFFSET de asyncpg (500)."""
    with pytest.raises(HTTPException) as exc:
        _req(page=10**20)
    assert exc.value.status_code == 422
