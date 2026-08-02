"""Fase 5 (HU-04) — Reporte de estatus del día. Los tests se centran en las
funciones puras que construyen cada sección a partir de una lista de filas
por equipo ya armada (no en mockear las ~6 queries secuenciales de
_build_asset_rows) — ahí es donde vive la lógica real de negocio."""
from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.db import get_pool
from app.routers.status_report import (
    _filter_by_client,
    _section1_resumen,
    _section2_tractoreo_asignado,
    _section3_vueltas,
    _section4_tractoreo_no_trabajando,
    _section5_equipos_completos,
    _section6_resumen_general,
    _summary,
    _zone_bucket,
    router,
)
from tests.conftest import USER, wire_transactional_conn


def _row(**overrides):
    base = {
        "asset_id": "a1", "tractor_plate": "ABCD12", "carrier_id": "c1", "carrier_name": "Transportes Sur",
        "categories": ["TRACTOREO"], "con_carga": True, "origin_cd": "CD Lo Aguirre", "client_name": "Walmart",
        "destination_zone": "RM", "dias_en_curso": 0, "vueltas": 1, "unassigned_reason_label": None,
    }
    base.update(overrides)
    return base


def test_zone_bucket_maps_region_norte_y_sur_a_region():
    assert _zone_bucket("RM") == "RM"
    assert _zone_bucket("Z0") == "Z0"
    assert _zone_bucket("Region Norte") == "Región"
    assert _zone_bucket("Region Sur") == "Región"
    assert _zone_bucket(None) == "Sin clasificar"
    assert _zone_bucket("algo raro") == "Sin clasificar"


def test_summary_computa_utilization_pct_y_maneja_lista_vacia():
    assert _summary([_row(con_carga=True), _row(asset_id="a2", con_carga=False)]) == {
        "total": 2, "assigned": 1, "unassigned": 1, "utilization_pct": 50.0,
    }
    assert _summary([]) == {"total": 0, "assigned": 0, "unassigned": 0, "utilization_pct": 0.0}


def test_section1_resumen_separa_tractoreo_y_equipo_completo_y_cuenta_multidia():
    rows = [
        _row(asset_id="a1", categories=["TRACTOREO"], con_carga=True, dias_en_curso=0),
        _row(asset_id="a2", categories=["TRACTOREO"], con_carga=True, dias_en_curso=2),
        _row(asset_id="a3", categories=["EQUIPO_COMPLETO"], con_carga=False, dias_en_curso=None, unassigned_reason_label=None),
    ]
    result = _section1_resumen(rows)
    assert result["total_equipos_activos"] == 3
    assert result["tractoreo"]["assigned"] == 2
    assert result["equipos_completos"]["unassigned"] == 1
    assert result["multi_dia_activos"] == {"total": 1, "por_dias_atras": {"2": 1}}


def test_section2_cruza_por_cd_y_por_empresa_y_cd_sin_incluir_sin_carga():
    rows = [
        _row(asset_id="a1", origin_cd="CD Lo Aguirre", destination_zone="RM"),
        _row(asset_id="a2", origin_cd="CD Lo Aguirre", destination_zone="Z0", carrier_name="Otra Spa"),
        _row(asset_id="a3", origin_cd="CD Lo Aguirre", con_carga=False, destination_zone=None),
    ]
    result = _section2_tractoreo_asignado(rows)
    assert result["por_cd"] == [{"cd": "CD Lo Aguirre", "RM": 1, "Z0": 1, "Región": 0, "Sin clasificar": 0, "total": 2}]
    assert {"cd": "CD Lo Aguirre", "carrier_name": "Otra Spa", "RM": 0, "Z0": 1, "Región": 0, "Sin clasificar": 0, "total": 1} in result["por_empresa_y_cd"]


def test_section3_vueltas_solo_incluye_equipos_con_2_o_mas_viajes_hoy():
    rows = [
        _row(asset_id="a1", vueltas=1),
        _row(asset_id="a2", vueltas=2),
        _row(asset_id="a3", vueltas=3, carrier_name="Otra Spa"),
        _row(asset_id="a4", con_carga=False, vueltas=0),
    ]
    result = _section3_vueltas(rows)
    assert len(result) == 2
    assert {"carrier_name": "Transportes Sur", "cd_origen": "CD Lo Aguirre", "tipo_destino": "RM", "vueltas": 2} in result
    assert {"carrier_name": "Otra Spa", "cd_origen": "CD Lo Aguirre", "tipo_destino": "RM", "vueltas": 3} in result


def test_section4_tractoreo_no_trabajando_cruza_por_motivo_solo_sin_carga():
    rows = [
        _row(asset_id="a1", con_carga=False, unassigned_reason_label="Panne", origin_cd="CD El Peñón"),
        _row(asset_id="a2", con_carga=False, unassigned_reason_label="Panne", origin_cd="CD El Peñón"),
        _row(asset_id="a3", con_carga=False, unassigned_reason_label="A confirmar", origin_cd="CD El Peñón", carrier_name="Otra Spa"),
        _row(asset_id="a4", con_carga=True),  # no debe contar, tiene carga
    ]
    result = _section4_tractoreo_no_trabajando(rows)
    cd_row = next(r for r in result["por_cd"] if r["cd"] == "CD El Peñón")
    assert cd_row["Panne"] == 2
    assert cd_row["A confirmar"] == 1
    assert cd_row["total"] == 3
    empresa_row = next(r for r in result["por_empresa_y_cd"] if r["carrier_name"] == "Otra Spa")
    assert empresa_row["A confirmar"] == 1
    assert empresa_row["total"] == 1


def test_section5_equipos_completos_ordena_desc_por_utilizacion():
    rows = [
        _row(asset_id="a1", categories=["EQUIPO_COMPLETO"], carrier_name="Baja Utilización", con_carga=False),
        _row(asset_id="a2", categories=["EQUIPO_COMPLETO"], carrier_name="Baja Utilización", con_carga=False),
        _row(asset_id="a3", categories=["EQUIPO_COMPLETO"], carrier_name="Alta Utilización", con_carga=True),
    ]
    result = _section5_equipos_completos(rows)
    assert result[0]["carrier_name"] == "Alta Utilización"
    assert result[0]["utilization_pct"] == 100.0
    assert result[1]["carrier_name"] == "Baja Utilización"
    assert result[1]["utilization_pct"] == 0.0


def test_section6_resumen_general_por_cd_y_por_cliente():
    rows = [
        _row(asset_id="a1", categories=["TRACTOREO"], origin_cd="CD Lo Aguirre", client_name="Walmart", con_carga=True),
        _row(asset_id="a2", categories=["TRACTOREO"], origin_cd="CD Lo Aguirre", con_carga=False, client_name=None),
        _row(asset_id="a3", categories=["EQUIPO_COMPLETO"], origin_cd="CD El Peñón", client_name="Sodimac", con_carga=True),
    ]
    result = _section6_resumen_general(rows)
    assert result["tractoreo"]["total"] == 2
    assert result["equipos_completos"]["total"] == 1
    assert {"cd": "CD Lo Aguirre", "enrolled": 2, "assigned": 1} in result["por_cd"]
    assert {"client_name": "Walmart", "assigned": 1} in result["por_cliente"]
    assert {"client_name": "Sodimac", "assigned": 1} in result["por_cliente"]


def test_filter_by_client_mantiene_equipos_sin_carga_y_filtra_los_con_carga_de_otro_cliente():
    rows = [
        _row(asset_id="a1", con_carga=True, client_name="Walmart"),
        _row(asset_id="a2", con_carga=True, client_name="Sodimac"),
        _row(asset_id="a3", con_carga=False, client_name=None),
    ]
    result = _filter_by_client(rows, "walmart")
    ids = {r["asset_id"] for r in result}
    assert ids == {"a1", "a3"}


def test_get_status_report_requires_valid_fecha():
    pool = AsyncMock()
    conn = AsyncMock()
    conn.fetch.return_value = []
    wire_transactional_conn(pool, conn)
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: USER
    client = TestClient(app)

    res = client.get("/api/v1/status-report?fecha=no-es-una-fecha")

    assert res.status_code == 422


def test_get_status_report_returns_all_6_sections_with_empty_roster():
    pool = AsyncMock()
    conn = AsyncMock()
    conn.fetch.return_value = []
    wire_transactional_conn(pool, conn)
    pool.fetch.return_value = []  # roster vacío -> el resto de queries no importan
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: USER
    client = TestClient(app)

    res = client.get("/api/v1/status-report?fecha=2026-08-02")

    assert res.status_code == 200
    body = res.json()
    assert set(body.keys()) == {
        "business_date", "client_filter",
        "section1_resumen", "section2_tractoreo_asignado", "section3_vueltas",
        "section4_tractoreo_no_trabajando", "section5_equipos_completos", "section6_resumen_general",
    }
    assert body["section1_resumen"]["total_equipos_activos"] == 0
