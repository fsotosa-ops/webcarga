"""Fase 5 (HU-04) — Reporte de estatus del día. Los tests se centran en las
funciones puras que construyen cada sección a partir de una lista de filas
por equipo ya armada (no en mockear las ~6 queries secuenciales de
_build_asset_rows) — ahí es donde vive la lógica real de negocio."""
from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.db import get_pool
from app.routers.status_report import (
    _build_driver_rows,
    _section_desvios_de_cd,
    _filter_by_client,
    _section1_resumen,
    _section2_tractoreo_asignado,
    _section3_vueltas,
    _section4_tractoreo_no_trabajando,
    _section5_equipos_completos,
    _section6_resumen_general,
    _section_tractoreo_por_empresa,
    _summary,
    _zone_bucket,
    router,
)
from tests.conftest import USER, wire_transactional_conn


def _row(**overrides):
    base = {
        "asset_id": "a1", "tractor_plate": "ABCD12", "carrier_id": "c1", "carrier_name": "Transportes Sur",
        "categories": ["TRACTOREO"], "con_carga": True,
        # Dos dimensiones distintas desde HU-28: `home_cd` es el CD DECLARADO
        # (agrupa la asistencia) y `origin_cd` el origen REAL del viaje de hoy
        # (agrupa el volumen). Antes eran el mismo campo, con la adivinanza
        # tapando el hueco de quien no salio.
        "home_cd": "CD Lo Aguirre", "origin_cd": "CD Lo Aguirre", "client_name": "Walmart",
        "destination_zone": "RM", "dias_en_curso": 0, "vueltas": 1, "unassigned_reason_label": None,
    }
    base.update(overrides)
    return base


# Tarea 6 (plan 2.3, minuta 2026-08-03): fila de _build_driver_rows — la
# Sección 4 pasa a agruparse por CONDUCTOR. con_carga siempre False acá "de
# compatibilidad" con _cross_tab_by_motivo (ver brief de la tarea).
def _driver_row(**overrides):
    base = {
        "driver_id": "d1", "full_name": "Juan Pérez", "carrier_name": "Transportes Sur",
        "status": "UNASSIGNED", "unassigned_reason_label": "Panne",
        # Un conductor de esta lista NO trabajo, asi que no tiene origen real:
        # su CD es el declarado y nada mas.
        "home_cd": "CD Lo Aguirre", "tractor_plate": "ABCD12", "operation_type": "Tractoreo",
        "con_carga": False,
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
        _row(asset_id="a1", home_cd="CD Lo Aguirre", destination_zone="RM"),
        _row(asset_id="a2", home_cd="CD Lo Aguirre", destination_zone="Z0", carrier_name="Otra Spa"),
        _row(asset_id="a3", home_cd="CD Lo Aguirre", con_carga=False, destination_zone=None),
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


# Tarea 6 (plan 2.3, minuta 2026-08-03): _section4_tractoreo_no_trabajando
# cambia de contrato — antes recibía filas de tracto (_build_asset_rows) y
# filtraba internamente por categories; ahora recibe directamente filas de
# conductor (_build_driver_rows), ya acotadas a Tractoreo+UNASSIGNED por
# construcción. El viejo test con filas de tracto (asset_id/categories)
# quedó reemplazado por los de abajo, que verifican el mismo cross-tab por
# motivo pero contra el contrato nuevo.

# ── Tarea 6 (plan 2.3, minuta 2026-08-03): Sección 4 pasa a agruparse por
# CONDUCTOR — decisión de negocio confirmada, ya no se reabre acá. El
# caller (_build_driver_rows) ya acota a Tractoreo + UNASSIGNED por
# construcción, así que la función deja de filtrar por categories. ──────

def test_section4_por_conductor_cruza_por_motivo_y_arma_driver_detail():
    driver_rows = [
        _driver_row(driver_id="d1", full_name="Juan Pérez", carrier_name="Transportes Sur",
                    home_cd="CD El Peñón", unassigned_reason_label="Panne", operation_type="Tractoreo"),
        _driver_row(driver_id="d2", full_name="Ana Soto", carrier_name="Transportes Sur",
                    home_cd="CD El Peñón", unassigned_reason_label="Panne", operation_type="Tractoreo"),
        _driver_row(driver_id="d3", full_name="Luis Rojas", carrier_name="Otra Spa",
                    home_cd="CD El Peñón", unassigned_reason_label="A confirmar", operation_type="Tractoreo"),
    ]
    result = _section4_tractoreo_no_trabajando(driver_rows, ["Panne", "A confirmar"])

    cd_row = next(r for r in result["por_cd"] if r["cd"] == "CD El Peñón")
    assert cd_row["Panne"] == 2
    assert cd_row["A confirmar"] == 1
    assert cd_row["total"] == 3
    empresa_row = next(r for r in result["por_empresa_y_cd"] if r["carrier_name"] == "Otra Spa")
    assert empresa_row["A confirmar"] == 1
    assert empresa_row["total"] == 1

    assert result["driver_detail"] == [
        {
            "driver_id": "d1", "full_name": "Juan Pérez", "carrier_name": "Transportes Sur",
            "cd_origen": "CD El Peñón", "unassigned_reason_label": "Panne",
            "tractor_plate": "ABCD12", "operation_type": "Tractoreo",
        },
        {
            "driver_id": "d2", "full_name": "Ana Soto", "carrier_name": "Transportes Sur",
            "cd_origen": "CD El Peñón", "unassigned_reason_label": "Panne",
            "tractor_plate": "ABCD12", "operation_type": "Tractoreo",
        },
        {
            "driver_id": "d3", "full_name": "Luis Rojas", "carrier_name": "Otra Spa",
            "cd_origen": "CD El Peñón", "unassigned_reason_label": "A confirmar",
            "tractor_plate": "ABCD12", "operation_type": "Tractoreo",
        },
    ]


def test_section4_driver_detail_muestra_operation_type_del_tracto_habitual_no_del_roster():
    """El roster se arma a nivel EMPRESA (Tractoreo) pero el tracto habitual
    del conductor puede venir clasificado Equipo Completo si la empresa
    opera flota mixta — driver_detail no debe "corregir" ese valor."""
    driver_rows = [
        _driver_row(driver_id="d1", carrier_name="Transportes Mixta", operation_type="Equipo Completo"),
    ]
    result = _section4_tractoreo_no_trabajando(driver_rows, ["Panne", "A confirmar"])
    assert result["driver_detail"][0]["operation_type"] == "Equipo Completo"


def test_section4_driver_sin_cd_base_cae_en_sin_cd():
    """"Sin origen" cambio de significado con HU-28: antes era "no pudimos
    adivinar"; ahora es "este conductor no tiene CD asignado", que es un
    pendiente accionable del directorio."""
    driver_rows = [
        _driver_row(driver_id="d1", home_cd=None, tractor_plate=None, operation_type=None,
                    unassigned_reason_label="A confirmar"),
    ]
    result = _section4_tractoreo_no_trabajando(driver_rows, ["Panne", "A confirmar"])

    cd_row = next(r for r in result["por_cd"] if r["cd"] == "Sin origen")
    assert cd_row["A confirmar"] == 1
    assert cd_row["total"] == 1
    detail = result["driver_detail"][0]
    assert detail["cd_origen"] is None
    assert detail["tractor_plate"] is None
    assert detail["operation_type"] is None


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


def test_section_tractoreo_por_empresa_ordena_desc_por_utilizacion():
    """Paridad con Sección 5 (pedido explícito del usuario 2026-08-04): la
    tab "por empresa" ahora existe también para Tractoreo, mismo shape."""
    rows = [
        _row(asset_id="a1", categories=["TRACTOREO"], carrier_name="Baja Utilización", con_carga=False),
        _row(asset_id="a2", categories=["TRACTOREO"], carrier_name="Baja Utilización", con_carga=False),
        _row(asset_id="a3", categories=["TRACTOREO"], carrier_name="Alta Utilización", con_carga=True),
        # Un equipo Equipo Completo no debe colarse en la tabla de Tractoreo
        _row(asset_id="a4", categories=["EQUIPO_COMPLETO"], carrier_name="Alta Utilización", con_carga=False),
    ]
    result = _section_tractoreo_por_empresa(rows)
    assert result[0]["carrier_name"] == "Alta Utilización"
    assert result[0]["utilization_pct"] == 100.0
    assert result[0]["enrolled"] == 1
    assert result[1]["carrier_name"] == "Baja Utilización"
    assert result[1]["utilization_pct"] == 0.0


def test_section6_resumen_general_por_cd_y_por_cliente():
    rows = [
        _row(asset_id="a1", categories=["TRACTOREO"], home_cd="CD Lo Aguirre", client_name="Walmart", con_carga=True),
        _row(asset_id="a2", categories=["TRACTOREO"], home_cd="CD Lo Aguirre", con_carga=False, client_name=None),
        _row(asset_id="a3", categories=["EQUIPO_COMPLETO"], home_cd="CD El Peñón", client_name="Sodimac", con_carga=True),
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


def test_get_status_report_returns_all_sections_with_empty_roster():
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
        "section4_tractoreo_no_trabajando", "section_tractoreo_por_empresa",
        "section5_equipos_completos", "section6_resumen_general",
        # HU-28 (ola 4.1): los que cargaron en un CD distinto al suyo. Declarar
        # el origen habitual no sirve para que todos calcen, sino para poder VER cuando
        # no calzan.
        "section7_desvios_de_cd",
    }
    assert body["section1_resumen"]["total_equipos_activos"] == 0


# ── Tarea 6 (plan 2.3, minuta 2026-08-03): _build_driver_rows — roster
# Tractoreo por conductor, recompute previo (mismo criterio que
# _build_asset_rows con el tracto), y filtro final a solo UNASSIGNED (ni
# ASSIGNED ni MISMATCH, que queda para Pendientes/pre-cierre). ──────────

async def test_build_driver_rows_deja_solo_a_quien_no_trabajo_o_no_se_sabe():
    """Solicitud 16/09: quien trabajó sin asignación ("Esperando carga",
    "Se retira sin carga") no es "No trabajando". Un conductor sin motivo sí
    entra, como hasta ahora: no se sabe si trabajó."""
    pool = AsyncMock()
    conn = AsyncMock()
    conn.fetch.return_value = []
    wire_transactional_conn(pool, conn)
    roster_rows = [
        {"driver_id": "d1", "full_name": "Juan Pérez", "carrier_id": "c1", "carrier_name": "Transportes Sur"},
        {"driver_id": "d2", "full_name": "Ana Soto", "carrier_id": "c1", "carrier_name": "Transportes Sur"},
        {"driver_id": "d3", "full_name": "Luis Rojas", "carrier_id": "c1", "carrier_name": "Transportes Sur"},
    ]
    roster_rows.append(
        {"driver_id": "d4", "full_name": "Pía Díaz", "carrier_id": "c1", "carrier_name": "Transportes Sur"})
    roster_rows.append(
        {"driver_id": "d5", "full_name": "Eva Ríos", "carrier_id": "c1", "carrier_name": "Transportes Sur"})
    status_rows = [
        {"driver_id": "d1", "status": "UNASSIGNED", "category": "NO_TRABAJANDO",
         "unassigned_reason_label": "Panne", "home_cd": "CD Lo Aguirre"},
        {"driver_id": "d2", "status": "ASSIGNED", "category": "ASIGNADO", "unassigned_reason_label": None},
        {"driver_id": "d3", "status": "MISMATCH", "category": "POR_REGULARIZAR", "unassigned_reason_label": None},
        {"driver_id": "d4", "status": "UNASSIGNED", "category": "TRABAJANDO_SIN_ASIGNACION",
         "unassigned_reason_label": "Esperando carga"},
        {"driver_id": "d5", "status": "UNASSIGNED", "category": "SIN_RESOLVER", "unassigned_reason_label": None},
    ]
    # HU-28 (ola 4): ya no hay consulta de "ultimo origen conocido" — el CD
    # llega en la misma fila de estado, desde app.closure_lines.
    tractor_rows = [{"driver_id": "d1", "tractor_plate": "ABCD12", "operation_type": "Tractoreo"}]
    pool.fetch.side_effect = [roster_rows, status_rows, tractor_rows]

    result = await _build_driver_rows(pool, date(2026, 8, 2))

    assert [r["driver_id"] for r in result] == ["d1", "d5"]
    row = result[0]
    assert row["full_name"] == "Juan Pérez"
    assert row["carrier_name"] == "Transportes Sur"
    assert row["unassigned_reason_label"] == "Panne"
    assert row["home_cd"] == "CD Lo Aguirre"
    assert row["tractor_plate"] == "ABCD12"
    assert row["operation_type"] == "Tractoreo"
    assert row["con_carga"] is False  # compatibilidad con _cross_tab_by_motivo


async def test_build_driver_rows_sin_historial_no_rompe():
    pool = AsyncMock()
    conn = AsyncMock()
    conn.fetch.return_value = []
    wire_transactional_conn(pool, conn)
    roster_rows = [
        {"driver_id": "d1", "full_name": "Juan Pérez", "carrier_id": "c1", "carrier_name": "Transportes Sur"},
    ]
    status_rows = [{"driver_id": "d1", "status": "UNASSIGNED", "category": "NO_TRABAJANDO",
                    "unassigned_reason_label": "A confirmar", "home_cd": None}]
    pool.fetch.side_effect = [roster_rows, status_rows, []]

    result = await _build_driver_rows(pool, date(2026, 8, 2))

    assert len(result) == 1
    assert result[0]["home_cd"] is None
    assert result[0]["tractor_plate"] is None
    assert result[0]["operation_type"] is None


# ── Integración: get_status_report agrega driver_rows a la Sección 4 sin
# aplicar _filter_by_client (esos conductores son por definición sin
# cliente). ──────────

def test_get_status_report_includes_section4_driver_detail():
    pool = AsyncMock()
    conn = AsyncMock()
    conn.fetch.return_value = []
    wire_transactional_conn(pool, conn)
    pool.fetch.return_value = []  # roster de equipo vacío -> las demás secciones no aportan
    driver_rows = [
        {
            "driver_id": "d1", "full_name": "Juan Pérez", "carrier_name": "Transportes Sur",
            "status": "UNASSIGNED", "unassigned_reason_label": "Panne",
            "home_cd": "CD Lo Aguirre", "tractor_plate": "ABCD12", "operation_type": "Tractoreo",
            "con_carga": False,
        },
    ]
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: USER
    client = TestClient(app)

    with patch("app.routers.status_report._build_driver_rows", AsyncMock(return_value=driver_rows)):
        res = client.get("/api/v1/status-report?fecha=2026-08-02")

    assert res.status_code == 200
    detail = res.json()["section4_tractoreo_no_trabajando"]["driver_detail"]
    assert detail == [
        {
            "driver_id": "d1", "full_name": "Juan Pérez", "carrier_name": "Transportes Sur",
            "cd_origen": "CD Lo Aguirre", "unassigned_reason_label": "Panne",
            "tractor_plate": "ABCD12", "operation_type": "Tractoreo",
        },
    ]


# ── FIX 2026-08-18: la Sección 4 decidía Tractoreo/Equipo Completo
# comparando contra la ETIQUETA visible ('Tractoreo'), así que renombrarla
# desde Configuración vaciaba el roster en silencio. Pasa a leer `code`, el
# identificador estable que no se edita desde la app (columna agregada en la
# migración 20260816090000). ──────────

def test_roster_sql_lee_el_codigo_no_la_etiqueta():
    from app.routers.status_report import _ROSTER_SQL
    assert "wot.code AS webcarga_operation_type_code" in _ROSTER_SQL
    assert "wot.label AS webcarga_operation_type_label" not in _ROSTER_SQL


def test_las_columnas_de_motivo_salen_del_catalogo_y_suman_las_retiradas_que_aparecen():
    """Antes eran una lista escrita a mano en dos lugares, y 9 motivos del
    catálogo sólo sumaban al total."""
    from app.routers.status_report import _columnas_de_motivo

    filas = [{"unassigned_reason_label": "Panne"}, {"unassigned_reason_label": "En abstención"},
             {"unassigned_reason_label": None}]

    assert _columnas_de_motivo(["Panne", "Vacaciones"], filas) == ["Panne", "Vacaciones", "En abstención"]


# ── HU-28 (ola 4): la asistencia se agrupa por el CD DECLARADO, y el desvío
# contra el origen real deja de perderse. ───────────────────────────────────

def test_la_asistencia_agrupa_por_el_cd_declarado_y_no_por_donde_cargo():
    """El caso que antes era invisible: alguien de Peñón que hoy cargó en
    Quilicura cuenta como asistencia de PEÑÓN, no de Quilicura. Agruparlo por
    dónde cargó infla el CD ajeno y vacía el propio."""
    rows = [
        _row(asset_id="a1", home_cd="CD El Peñón", origin_cd="CD Quilicura", con_carga=True),
        _row(asset_id="a2", home_cd="CD El Peñón", origin_cd="CD El Peñón", con_carga=True),
        _row(asset_id="a3", home_cd="CD El Peñón", origin_cd=None, con_carga=False),
    ]

    resumen = _section6_resumen_general(rows)

    assert {"cd": "CD El Peñón", "enrolled": 3, "assigned": 2} in resumen["por_cd"]
    assert all(b["cd"] != "CD Quilicura" for b in resumen["por_cd"])


def test_quien_no_trabajo_cuenta_en_su_cd_aunque_no_tenga_viaje():
    """La mitad que la adivinanza tapaba: sin viaje no hay origen, y aun así
    hay que poder decir de qué CD es su ausencia."""
    rows = [_row(asset_id="a1", home_cd="CD Lo Aguirre", origin_cd=None, con_carga=False)]

    resumen = _section6_resumen_general(rows)

    assert {"cd": "CD Lo Aguirre", "enrolled": 1, "assigned": 0} in resumen["por_cd"]


def test_el_desvio_se_reporta_solo_cuando_hay_con_que_comparar():
    rows = [
        # Desvío real: declarado Peñón, cargó en Quilicura.
        _row(asset_id="a1", tractor_plate="AAAA11", home_cd="CD El Peñón",
             origin_cd="CD Quilicura", con_carga=True),
        # Calza: no es desvío.
        _row(asset_id="a2", tractor_plate="BBBB22", home_cd="CD El Peñón",
             origin_cd="CD El Peñón", con_carga=True),
        # Sin Origen habitual: no hay contra qué comparar, no es un desvío.
        _row(asset_id="a3", tractor_plate="CCCC33", home_cd=None,
             origin_cd="CD Quilicura", con_carga=True),
        # Sin carga: no hay origen, tampoco es un desvío.
        _row(asset_id="a4", tractor_plate="DDDD44", home_cd="CD El Peñón",
             origin_cd=None, con_carga=False),
    ]

    desvios = _section_desvios_de_cd(rows)

    assert [d["tractor_plate"] for d in desvios] == ["AAAA11"]
    assert desvios[0]["home_cd"] == "CD El Peñón"
    assert desvios[0]["origin_cd"] == "CD Quilicura"


def test_sin_cd_base_ya_no_significa_no_pudimos_adivinar():
    """Cambió de significado: ahora es un pendiente accionable del directorio,
    y por eso se agrupa aparte en vez de repartirse entre los demás CD."""
    rows = [
        _row(asset_id="a1", home_cd=None, origin_cd="CD El Peñón", con_carga=True),
        _row(asset_id="a2", home_cd="CD El Peñón", origin_cd="CD El Peñón", con_carga=True),
    ]

    resumen = _section6_resumen_general(rows)

    assert {"cd": "Sin origen", "enrolled": 1, "assigned": 1} in resumen["por_cd"]
    assert {"cd": "CD El Peñón", "enrolled": 1, "assigned": 1} in resumen["por_cd"]
