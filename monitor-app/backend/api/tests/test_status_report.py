"""Fase 5 (HU-04) — Reporte de estatus del día. Los tests se centran en las
funciones puras que construyen cada sección a partir de una lista de filas
por equipo ya armada (no en mockear las ~6 queries secuenciales de
_build_asset_rows) — ahí es donde vive la lógica real de negocio."""
from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.db import get_pool
from app.routers.status_report import (
    _asignados,
    _build_driver_rows,
    _cargaron_en_otro_origen,
    _clientes_de_la_fila,
    _clientes_del_dia,
    _empresas,
    _filter_by_client,
    _motivos_que_ocurrieron,
    _no_trabajaron_por_conductor,
    _no_trabajaron_por_equipo,
    _resumen_del_tipo,
    _segundas_vueltas,
    _trabajaron_sin_asignacion,
    _zone_bucket,
    router,
)
from tests.conftest import USER, wire_transactional_conn


@pytest.fixture(autouse=True)
def frescura(monkeypatch):
    """La frescura del día se prueba contra la base
    (test_get_del_cierre_no_escribe_integracion.py); acá, stub."""
    import app.routers.status_report as modulo
    monkeypatch.setattr(modulo, "frescura_del_dia",
                        AsyncMock(return_value={"calculado_a": None, "pendiente_desde": None}))


def _row(**overrides):
    base = {
        "asset_id": "a1", "tractor_plate": "ABCD12", "carrier_id": "c1", "carrier_name": "Transportes Sur",
        "categories": ["TRACTOREO"], "con_carga": True,
        # Dos dimensiones distintas desde HU-28: `home_cd` es el CD DECLARADO
        # (agrupa la asistencia) y `origin_cd` el origen REAL del viaje de hoy
        # (agrupa el volumen). Antes eran el mismo campo, con la adivinanza
        # tapando el hueco de quien no salio.
        "home_cd": "CD Lo Aguirre", "origin_cd": "CD Lo Aguirre", "client_name": "Walmart", "shipper_id": "s1",
        "destination_zone": "RM", "driver_name": "Juan Pérez", "dias_en_curso": 0, "vueltas": 1, "unassigned_reason_label": None,
        "trips": [],
        "category": "ASIGNADO",
    }
    base.update(overrides)
    return base


# Tarea 6 (plan 2.3, minuta 2026-08-03): fila de _build_driver_rows — la
# Sección 4 pasa a agruparse por CONDUCTOR. con_carga siempre False acá "de
# compatibilidad": son, por definición, conductores sin carga.
def _driver_row(**overrides):
    base = {
        "driver_id": "d1", "full_name": "Juan Pérez", "carrier_name": "Transportes Sur", "carrier_id": "c1",
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


# El cliente es un dato del viaje (decisión del usuario 11/10, "estás mezclando
# cosas"): lo que no tuvo viaje no pertenece a ningún cliente.


def test_un_equipo_con_carga_pertenece_al_cliente_de_su_viaje():
    assert _clientes_de_la_fila(_row(shipper_id="s1")) == ["s1"]


def test_un_viaje_sin_cliente_vinculado_no_pertenece_a_ninguno():
    assert _clientes_de_la_fila(_row(shipper_id=None, client_name="colun · sin vincular")) == []


def test_un_equipo_sin_carga_no_pertenece_a_ningun_cliente():
    """Antes se le atribuían los clientes de su empresa: con "Sodimac" elegido,
    "No trabajaron" mostraba camiones parados que nunca tuvieron un viaje de
    Sodimac ese día. Ahora solo se ven con "Todos los clientes"."""
    fila = _row(carrier_id="c2", con_carga=False, client_name=None, shipper_id="s3", category="NO_TRABAJANDO")
    assert _clientes_de_la_fila(fila) == []


def test_el_faltante_de_dotacion_no_pertenece_a_ningun_cliente():
    """La fila de faltante no tiene viaje: es de la empresa, no de un cliente."""
    assert _clientes_de_la_fila(_faltante("c1", 3, 1) | {"carrier_id": "c1"}) == []


def test_con_un_cliente_elegido_solo_quedan_los_equipos_con_un_viaje_suyo():
    rows = [
        _row(asset_id="a1", carrier_id="c1", shipper_id="s1"),
        _row(asset_id="a2", carrier_id="c2", shipper_id="s3", client_name="Sodimac"),
        _row(asset_id="a3", carrier_id="c1", con_carga=False, client_name=None, shipper_id=None, category="NO_TRABAJANDO"),
    ]
    assert [r["asset_id"] for r in _filter_by_client(rows, "s1")] == ["a1"]
    assert _filter_by_client(rows, None) == rows


def test_el_filtro_compara_ids_y_no_nombres():
    """Dos clientes con el mismo nombre visible no se confunden: manda el id."""
    rows = [_row(asset_id="a1", shipper_id="s1", client_name="Walmart"),
            _row(asset_id="a2", shipper_id="s9", client_name="Walmart")]
    assert [r["asset_id"] for r in _filter_by_client(rows, "s1")] == ["a1"]


def test_los_clientes_del_dia_son_los_que_cargaron_con_su_cantidad():
    rows = [
        _row(asset_id="a1"), _row(asset_id="a2"),
        _row(asset_id="a3", client_name="Iansa", shipper_id="s2", categories=["EQUIPO_COMPLETO"]),
        _row(asset_id="a4", con_carga=False, client_name=None, shipper_id=None, category="NO_TRABAJANDO"),
        # Un equipo sin tipo no está en el reporte: no hace aparecer a su cliente.
        _row(asset_id="a5", client_name="Colun", shipper_id="s4", categories=["SIN_CLASIFICAR"]),
        # Un viaje sin cliente vinculado no es una opción del filtro.
        _row(asset_id="a6", client_name="hbc · sin vincular", shipper_id=None),
    ]
    # El total y el detalle por tipo: la pantalla muestra el del tipo a la vista,
    # para que el número del filtro sea el mismo de las tarjetas.
    assert _clientes_del_dia(rows) == [
        {"shipper_id": "s1", "client_name": "Walmart", "assigned": 2,
         "by_operation_type": {"tractoreo": 2, "equipo_completo": 0}},
        {"shipper_id": "s2", "client_name": "Iansa", "assigned": 1,
         "by_operation_type": {"tractoreo": 0, "equipo_completo": 1}},
    ]


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
    assert row["carrier_id"] == "c1"
    assert row["con_carga"] is False


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


# ── FIX 2026-08-18: la Sección 4 decidía Tractoreo/Equipo Completo
# comparando contra la ETIQUETA visible ('Tractoreo'), así que renombrarla
# desde Configuración vaciaba el roster en silencio. Pasa a leer `code`, el
# identificador estable que no se edita desde la app (columna agregada en la
# migración 20260816090000). ──────────

def test_roster_sql_lee_el_codigo_no_la_etiqueta():
    from app.routers.status_report import _ROSTER_SQL
    assert "wot.code AS webcarga_operation_type_code" in _ROSTER_SQL
    assert "wot.label AS webcarga_operation_type_label" not in _ROSTER_SQL


# ── Minuta 09/10, ítem 13: "Sin conductor" no marcaba nada ──────────────────
# Pablo: "Todos los que te faltan conductor en los sin trabajar, tú deberías
# tener aquí". Es el faltante de la dotación (tractos > conductores de la
# empresa), que ya calcula services/fleet_driver_gap.py para la pestaña 8. La
# columna contaba conductores con ese motivo, y un conductor no es "sin
# conductor".

def _faltante(carrier, n_tractos, n_conductores):
    return {"carrier_id": carrier, "business_name": carrier, "n_tractos": n_tractos,
            "n_conductores": n_conductores, "gap": n_tractos - n_conductores}


# ── Spec 2026-10-11: el reporte por tipo de operación ────────────────────────
# Cada tipo trae las mismas seis claves y se arma con las mismas funciones; el
# endpoint solo decide qué filas le tocan a cada uno.

def test_los_motivos_son_solo_los_que_ocurrieron_en_el_orden_del_catalogo():
    """Antes salían todos los del catálogo: 16 columnas, casi todas en 0."""
    assert _motivos_que_ocurrieron(
        ["Panne", "Vacaciones", "Licencia"], ["Licencia", "Panne", "Panne"],
    ) == ["Panne", "Licencia"]


def test_un_motivo_retirado_que_ocurrio_va_despues_y_sin_motivo_al_final():
    assert _motivos_que_ocurrieron(
        ["Panne"], ["Sin motivo", "En abstención", "Panne"],
    ) == ["Panne", "En abstención", "Sin motivo"]


def test_resumen_del_tipo_separa_asignados_de_los_que_no_trabajaron():
    rows = [
        _row(asset_id="a1"),
        _row(asset_id="a2", con_carga=False, category="TRABAJANDO_SIN_ASIGNACION",
             unassigned_reason_label="Esperando carga"),
        _row(asset_id="a3", con_carga=False, category="NO_TRABAJANDO", unassigned_reason_label="Panne"),
        _row(asset_id="a4", con_carga=False, category="SIN_RESOLVER", unassigned_reason_label=None),
    ]
    resumen = _resumen_del_tipo(rows)
    assert {k: resumen[k] for k in ("total", "assigned", "not_working", "utilization_pct")} == {
        "total": 4, "assigned": 1, "not_working": 2, "utilization_pct": 25.0,
    }
    assert resumen["by_client"] == [{"client_name": "Walmart", "assigned": 1}]


def test_resumen_agrupa_la_asistencia_por_el_origen_habitual_y_no_por_donde_cargo():
    """Alguien de Peñón que hoy cargó en Quilicura es asistencia de PEÑÓN."""
    rows = [
        _row(asset_id="a1", home_cd="CD El Peñón", origin_cd="CD Quilicura"),
        _row(asset_id="a2", home_cd="CD El Peñón", origin_cd=None, con_carga=False, category="NO_TRABAJANDO"),
        _row(asset_id="a3", home_cd=None, origin_cd="CD El Peñón"),
    ]
    assert _resumen_del_tipo(rows)["by_home_origin"] == [
        {"origin": "CD El Peñón", "enrolled": 2, "assigned": 1},
        {"origin": "Sin origen", "enrolled": 1, "assigned": 1},
    ]


def test_resumen_de_un_tipo_sin_equipos_no_divide_por_cero():
    assert _resumen_del_tipo([])["utilization_pct"] == 0.0


def test_asignados_cruza_cliente_origen_real_y_empresa_por_zona():
    rows = [
        _row(asset_id="a1", client_name="Walmart", origin_cd="CD Lo Aguirre", destination_zone="RM"),
        _row(asset_id="a2", client_name="Walmart", origin_cd="CD Lo Aguirre", destination_zone="Región"),
        _row(asset_id="a3", client_name="Walmart", origin_cd="CD Quilicura", destination_zone="Z0"),
        _row(asset_id="a4", client_name=None, origin_cd=None, destination_zone="Sin clasificar"),
        # Sin carga: no entra en asignados.
        _row(asset_id="a5", con_carga=False, category="NO_TRABAJANDO"),
    ]
    sin_vehiculos = [{k: v for k, v in r.items() if k != "vehicles"} for r in _asignados(rows)]
    assert sin_vehiculos == [
        {"client_name": "Sin cliente", "origin": "Sin origen", "carrier_name": "Transportes Sur",
         "rm": 0, "z0": 0, "region": 0, "unclassified": 1, "total": 1},
        {"client_name": "Walmart", "origin": "CD Lo Aguirre", "carrier_name": "Transportes Sur",
         "rm": 1, "z0": 0, "region": 1, "unclassified": 0, "total": 2},
        {"client_name": "Walmart", "origin": "CD Quilicura", "carrier_name": "Transportes Sur",
         "rm": 0, "z0": 1, "region": 0, "unclassified": 0, "total": 1},
    ]


def test_cada_fila_de_asignados_trae_sus_conductores_con_patente_y_zona():
    """La vista por conductor de Asignados (pedido del usuario 11/10): la hoja
    del árbol se abre en los tractos que la forman, cada uno con su conductor."""
    rows = [
        _row(asset_id="a1", tractor_plate="BBBB22", driver_name="Ana Soto", destination_zone="RM"),
        _row(asset_id="a2", tractor_plate="AAAA11", driver_name=None, destination_zone="Región"),
    ]
    assert _asignados(rows)[0]["vehicles"] == [
        {"tractor_plate": "BBBB22", "driver_name": "Ana Soto", "zone": "rm", "trips": []},
        {"tractor_plate": "AAAA11", "driver_name": None, "zone": "region", "trips": []},
    ]


def test_cargaron_en_otro_origen_solo_cuando_hay_con_que_comparar():
    rows = [
        _row(asset_id="a1", tractor_plate="AAAA11", home_cd="CD El Peñón", origin_cd="CD Quilicura"),
        _row(asset_id="a2", tractor_plate="BBBB22", home_cd="CD El Peñón", origin_cd="CD El Peñón"),
        _row(asset_id="a3", tractor_plate="CCCC33", home_cd=None, origin_cd="CD Quilicura"),
        _row(asset_id="a4", tractor_plate="DDDD44", home_cd="CD El Peñón", origin_cd=None, con_carga=False),
    ]
    assert _cargaron_en_otro_origen(rows) == [{
        "tractor_plate": "AAAA11", "carrier_name": "Transportes Sur", "home_origin": "CD El Peñón",
        "origin": "CD Quilicura", "client_name": "Walmart",
    }]


def test_trabajaron_sin_asignacion_por_origen_habitual_y_motivo():
    rows = [
        _row(asset_id="a1"),
        _row(asset_id="a2", home_cd="CD Quilicura", con_carga=False, category="TRABAJANDO_SIN_ASIGNACION",
             unassigned_reason_label="Se retira sin carga"),
        _row(asset_id="a3", con_carga=False, category="NO_TRABAJANDO", unassigned_reason_label="Panne"),
    ]
    seccion = _trabajaron_sin_asignacion(rows, ["Esperando carga", "Se retira sin carga"])
    assert seccion == {
        "reasons": ["Se retira sin carga"],
        "rows": [{"origin": "CD Quilicura", "carrier_name": "Transportes Sur",
                  "counts": {"Se retira sin carga": 1}, "total": 1}],
    }


def test_segundas_vueltas_por_patente_con_su_conductor():
    rows = [
        _row(asset_id="a1", tractor_plate="AAAA11", vueltas=2, driver_name="Ana Soto", destination_zone="Z0"),
        _row(asset_id="a2", tractor_plate="BBBB22", vueltas=1),
        _row(asset_id="a3", tractor_plate="CCCC33", vueltas=0, con_carga=False),
    ]
    assert _segundas_vueltas(rows) == [{
        "tractor_plate": "AAAA11", "carrier_name": "Transportes Sur", "driver_name": "Ana Soto",
        "origin": "CD Lo Aguirre", "destination_zone": "Z0", "legs": 2, "trips": [],
    }]


def test_no_trabajaron_en_tractoreo_va_por_conductor_y_suma_el_faltante_en_sin_conductor():
    driver_rows = [
        _driver_row(driver_id="d1", home_cd="CD El Peñón", unassigned_reason_label="Panne"),
        _driver_row(driver_id="d2", full_name="Eva Ríos", home_cd=None, unassigned_reason_label=None),
    ]
    seccion = _no_trabajaron_por_conductor(
        driver_rows, ["Panne", "Vacaciones", "Sin conductor"],
        faltantes=[_faltante("Transportes Sur", 3, 1), _faltante("Sobra Spa", 1, 2)],
        sin_conductor="Sin conductor",
    )
    assert seccion["reasons"] == ["Panne", "Sin conductor", "Sin motivo"]
    assert seccion["by_reason"] == [
        {"origin": "CD El Peñón", "carrier_name": "Transportes Sur", "counts": {"Panne": 1}, "total": 1},
        {"origin": "Sin origen", "carrier_name": "Transportes Sur",
         "counts": {"Sin motivo": 1, "Sin conductor": 2}, "total": 3},
    ]
    assert seccion["detail"] == [
        {"name": "Eva Ríos", "carrier_name": "Transportes Sur", "home_origin": None,
         "reason": "Sin motivo", "tractor_plate": "ABCD12"},
        {"name": "Juan Pérez", "carrier_name": "Transportes Sur", "home_origin": "CD El Peñón",
         "reason": "Panne", "tractor_plate": "ABCD12"},
    ]


def test_sin_el_motivo_sin_conductor_activo_no_inventa_la_columna():
    seccion = _no_trabajaron_por_conductor(
        [], ["Panne"], faltantes=[_faltante("Transportes Sur", 3, 1)], sin_conductor="Sin conductor")
    assert seccion == {"reasons": [], "by_reason": [], "detail": []}


def test_no_trabajaron_en_equipo_completo_lista_equipos():
    rows = [
        _row(asset_id="a1", tractor_plate="EQUI01", con_carga=False, category="NO_TRABAJANDO",
             unassigned_reason_label="Panne", home_cd="CD Lo Aguirre"),
        # Trabajó sin asignación: no es "no trabajó".
        _row(asset_id="a2", tractor_plate="EQUI02", con_carga=False, category="TRABAJANDO_SIN_ASIGNACION",
             unassigned_reason_label="Esperando carga"),
        _row(asset_id="a3", tractor_plate="EQUI03"),
    ]
    seccion = _no_trabajaron_por_equipo(rows, ["Panne"])
    assert seccion["reasons"] == ["Panne"]
    assert seccion["detail"] == [{"name": "EQUI01", "carrier_name": "Transportes Sur",
                                  "home_origin": "CD Lo Aguirre", "reason": "Panne", "tractor_plate": "EQUI01"}]


def test_empresas_ordena_por_utilizacion():
    rows = [
        _row(asset_id="a1", carrier_name="Norte"), _row(asset_id="a2", carrier_name="Norte", con_carga=False),
        _row(asset_id="a3", carrier_name="Sur"),
    ]
    assert _empresas(rows) == [
        {"carrier_name": "Sur", "enrolled": 1, "assigned": 1, "unassigned": 0, "utilization_pct": 100.0},
        {"carrier_name": "Norte", "enrolled": 2, "assigned": 1, "unassigned": 1, "utilization_pct": 50.0},
    ]


SEIS_CLAVES = {"summary", "assigned", "worked_without_assignment", "second_legs", "not_working", "carriers"}


def _cliente_http(pool):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: USER
    return TestClient(app)


def test_get_status_report_devuelve_los_dos_tipos_con_sus_seis_claves():
    pool = AsyncMock()
    conn = AsyncMock()
    conn.fetch.return_value = []
    wire_transactional_conn(pool, conn)
    pool.fetch.return_value = []

    res = _cliente_http(pool).get("/api/v1/status-report?fecha=2026-08-02")

    assert res.status_code == 200
    body = res.json()
    assert set(body) == {"business_date", "client_filter", "calculado_a", "pendiente_desde", "by_operation_type", "clients",
                         "fleet_driver_gap"}
    assert set(body["by_operation_type"]) == {"tractoreo", "equipo_completo"}
    for tipo in body["by_operation_type"].values():
        assert set(tipo) == SEIS_CLAVES


def test_cada_equipo_cuenta_solo_en_su_tipo_y_los_asignados_cuadran_con_el_resumen():
    from app.services.cierre_lineas import GRUPO_NO_TRABAJANDO

    asset_rows = [
        _row(asset_id="t1", tractor_plate="TRAC01", categories=["TRACTOREO"]),
        _row(asset_id="t2", tractor_plate="TRAC02", categories=["TRACTOREO"], client_name="Sodimac"),
        _row(asset_id="e1", tractor_plate="EQUI01", categories=["EQUIPO_COMPLETO"], con_carga=False,
             category="NO_TRABAJANDO", unassigned_reason_label="Panne"),
        _row(asset_id="s1", tractor_plate="SINC01", categories=["SIN_CLASIFICAR"]),
    ]

    async def catalogo(sql, *args):
        return [{"label": "Panne"}, {"label": "Vacaciones"}] if args and args[0] == GRUPO_NO_TRABAJANDO else []

    pool = AsyncMock()
    pool.fetch.side_effect = catalogo
    pool.fetchval.return_value = None
    with patch("app.routers.status_report._build_asset_rows", AsyncMock(return_value=asset_rows)), \
         patch("app.routers.status_report._build_driver_rows", AsyncMock(return_value=[])), \
         patch("app.routers.status_report.compute_fleet_driver_gap", AsyncMock(return_value=[])):
        body = _cliente_http(pool).get("/api/v1/status-report?fecha=2026-08-02").json()

    tractoreo = body["by_operation_type"]["tractoreo"]
    equipo = body["by_operation_type"]["equipo_completo"]
    assert tractoreo["summary"]["total"] == 2 and equipo["summary"]["total"] == 1
    assert sum(r["total"] for r in tractoreo["assigned"]["rows"]) == tractoreo["summary"]["assigned"] == 2
    assert [d["name"] for d in equipo["not_working"]["detail"]] == ["EQUI01"]
    assert equipo["not_working"]["reasons"] == ["Panne"]
    assert tractoreo["not_working"]["detail"] == []


def test_el_filtro_de_cliente_deja_solo_sus_viajes_y_devuelve_los_clientes_del_dia():
    asset_rows = [
        _row(asset_id="t1", carrier_id="c1", shipper_id="00000000-0000-0000-0000-0000000000a1"),
        _row(asset_id="t2", carrier_id="c2", client_name="Sodimac", shipper_id="00000000-0000-0000-0000-0000000000a3"),
        _row(asset_id="t3", carrier_id="c1", con_carga=False, client_name=None, shipper_id=None, category="NO_TRABAJANDO"),
    ]
    driver_rows = [_driver_row(driver_id="d1", carrier_id="c1")]

    async def fetch(sql, *args):
        # c1 está habilitada para el cliente elegido: aun así, lo que no tuvo
        # viaje no es de ese cliente.
        if "carrier_shippers" in sql:
            return [{"carrier_id": "c1", "clients": ["00000000-0000-0000-0000-0000000000a1"]}]
        return []

    pool = AsyncMock()
    pool.fetch.side_effect = fetch
    pool.fetchval.return_value = None
    gap = [{"carrier_id": "c1", "business_name": "Transportes Sur", "n_tractos": 3, "n_conductores": 1, "gap": 2}]
    import app.routers.status_report as modulo
    with patch.object(modulo, "_build_asset_rows", AsyncMock(return_value=asset_rows)), \
         patch.object(modulo, "_build_driver_rows", AsyncMock(return_value=driver_rows)), \
         patch.object(modulo, "compute_fleet_driver_gap", AsyncMock(return_value=gap)), \
         patch.object(modulo, "_no_trabajaron_por_conductor", wraps=modulo._no_trabajaron_por_conductor) as espia:
        body = _cliente_http(pool).get("/api/v1/status-report?fecha=2026-08-02&shipper_id=00000000-0000-0000-0000-0000000000a1").json()
        todos = _cliente_http(pool).get("/api/v1/status-report?fecha=2026-08-02").json()

    resumen = body["by_operation_type"]["tractoreo"]["summary"]
    assert (resumen["total"], resumen["assigned"]) == (1, 1)
    assert espia.call_args_list[0].args[0] == []
    assert body["fleet_driver_gap"] == []
    # La lista sale del día completo, antes del filtro.
    assert [(c["client_name"], c["assigned"]) for c in body["clients"]] == [("Sodimac", 1), ("Walmart", 1)]
    # Con "Todos los clientes", lo que no trabajó sí está.
    assert todos["by_operation_type"]["tractoreo"]["summary"]["total"] == 3
    assert [f["carrier_id"] for f in todos["fleet_driver_gap"]] == ["c1"]


def test_resumen_cuenta_los_viajes_de_varios_dias_por_dias_atras():
    """Los equipos que siguen en un viaje planificado días antes (se mantienen
    en el reporte, pedido del usuario 11/10)."""
    rows = [
        _row(asset_id="a1", dias_en_curso=0),
        _row(asset_id="a2", dias_en_curso=1),
        _row(asset_id="a3", dias_en_curso=1),
        _row(asset_id="a4", dias_en_curso=3),
        # Sin carga no está en ningún viaje, aunque arrastre un número.
        _row(asset_id="a5", con_carga=False, dias_en_curso=None, category="NO_TRABAJANDO"),
    ]
    assert _resumen_del_tipo(rows)["multi_day"] == {"total": 3, "by_days_back": {"1": 2, "3": 1}}


def test_los_viajes_del_dia_traen_el_cliente_del_directorio_por_id():
    """El TMS manda "walmart"; el reporte cruza por el id del cliente del
    directorio y muestra su nombre (spec 2026-10-11)."""
    from app.routers.status_report import _TODAY_TRIPS_SQL
    assert "t.shipper_id::text AS shipper_id" in _TODAY_TRIPS_SQL
    assert "LEFT JOIN public.shippers sh ON sh.id = t.shipper_id" in _TODAY_TRIPS_SQL
    assert "COALESCE(sh.name, t.client_name || ' · sin vincular') AS client_name" in _TODAY_TRIPS_SQL




def test_el_reporte_con_un_id_de_cliente_mal_formado_es_422():
    """Revisión final, menor 1."""
    pool = AsyncMock()
    assert _cliente_http(pool).get("/api/v1/status-report?fecha=2026-08-02&shipper_id=walmart").status_code == 422
