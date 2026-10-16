"""El alcance del Cierre (Tractoreo / Equipo Completo) en Viajes, Pendientes y el
Reporte (Cierre con un solo patrón, Task 2, spec D6 y D8).

El tipo de operación de un viaje sale de su tracto resuelto; sin tracto, `None`
(se ve en los dos alcances). El código del catálogo se lee en un solo lugar."""
from __future__ import annotations

import re
import uuid
from pathlib import Path

import pytest

from app.routers.status_report import _asignados, _segundas_vueltas
from app.services.closure_scope import OPERATION_TYPE_CODE, scope_of_code
from tests.conftest import PoolDeUnaConexion
from tests.test_cierre_viajes import FECHA_NEGOCIO, _crear_viaje

APP = Path(__file__).resolve().parents[1] / "app"


def test_el_codigo_del_tipo_de_operacion_se_escribe_en_un_solo_lugar():
    """`schemas/common.py` es otro concepto (el tipo de GESTIÓN de una empresa)."""
    literal = re.compile(r"""['"](TRACTOREO|EQUIPO_COMPLETO)['"]""")
    con_literal = sorted(
        str(p.relative_to(APP)) for p in APP.rglob("*.py")
        if literal.search(p.read_text(encoding="utf-8")) and p.name != "common.py"
    )
    assert con_literal == ["services/closure_scope.py"]


def test_del_codigo_al_alcance():
    assert OPERATION_TYPE_CODE == {"tractoreo": "TRACTOREO", "equipo_completo": "EQUIPO_COMPLETO"}
    assert scope_of_code("TRACTOREO") == "tractoreo"
    assert scope_of_code("EQUIPO_COMPLETO") == "equipo_completo"
    assert scope_of_code(None) is None
    assert scope_of_code("OTRO") is None


def test_asignados_y_segundas_vueltas_traen_sus_viajes():
    viajes = [{"id": "t1", "code": "2076179"}, {"id": "t2", "code": "2076180"}]
    fila = {"con_carga": True, "client_name": "Walmart", "origin_cd": "CD Quilicura", "carrier_name": "Hasa",
            "destination_zone": "RM", "tractor_plate": "BBPV80", "driver_name": "Rodríguez", "vueltas": 2,
            "trips": viajes}
    assert _asignados([fila])[0]["vehicles"][0]["trips"] == viajes
    assert _segundas_vueltas([fila])[0]["trips"] == viajes


async def _tracto_de_tipo(conn, code: str | None) -> str:
    """Un tracto existente con su tipo de operación puesto por el test (revertido)."""
    asset = await conn.fetchval(
        "SELECT id FROM public.assets WHERE license_plate IS NOT NULL AND public.is_power_unit(asset_type) "
        "ORDER BY id OFFSET $1 LIMIT 1", {"TRACTOREO": 0, "EQUIPO_COMPLETO": 1, None: 2}[code])
    tipo = await conn.fetchval(
        "SELECT id FROM app.status_taxonomies WHERE code = $1 LIMIT 1", code) if code else None
    await conn.execute("UPDATE public.assets SET webcarga_operation_type_id = $2 WHERE id = $1", asset, tipo)
    return asset


@pytest.mark.integracion
async def test_cada_viaje_del_cierre_dice_su_alcance(conexion_revertida):
    from app.routers.trips import cierre_viajes

    conn = conexion_revertida
    esperado = {}
    for code, alcance in (("TRACTOREO", "tractoreo"), ("EQUIPO_COMPLETO", "equipo_completo")):
        trip = await _crear_viaje(conn, planning_date=FECHA_NEGOCIO, is_active=True, is_assigned=False)
        await conn.execute(
            "INSERT INTO app.trip_fleet_links (trip_id, tractor_asset_id, link_source) VALUES ($1, $2, 'manual')",
            trip, await _tracto_de_tipo(conn, code))
        esperado[str(trip)] = alcance
    sin_tracto = await _crear_viaje(conn, planning_date=FECHA_NEGOCIO, is_active=True, is_assigned=False)
    esperado[str(sin_tracto)] = None

    resp = await cierre_viajes(fecha=FECHA_NEGOCIO.isoformat(), pool=PoolDeUnaConexion(conn), _=None)

    todos = {v["trip_id"]: v for grupo in resp["grupos"].values() for v in grupo}
    assert {t: todos[t]["scope"] for t in esperado} == esperado
    assert all("scope" in v for v in todos.values())


@pytest.mark.integracion
async def test_cada_aviso_de_pendientes_dice_su_alcance(conexion_revertida):
    from app.services.pre_cierre import avisos_del_dia

    conn = conexion_revertida
    trip = await _crear_viaje(conn, planning_date=FECHA_NEGOCIO, is_active=True, is_assigned=False)
    patente = f"ZZ{uuid.uuid4().hex[:4].upper()}"
    await conn.execute(
        "UPDATE app.trips SET fleet = jsonb_build_object('tractor_plate', $2::text) WHERE id = $1", trip, patente)

    avisos = await avisos_del_dia(conn, FECHA_NEGOCIO)

    no_registrada = next(a for a in avisos["escalations"]["PATENTE_NO_REGISTRADA"] if a["tractor_plate"] == patente)
    # Una patente que el directorio no conoce no tiene tipo: se ve en los dos alcances.
    assert no_registrada["scope"] is None
    assert all("scope" in a for lista in avisos["escalations"].values() for a in lista)
