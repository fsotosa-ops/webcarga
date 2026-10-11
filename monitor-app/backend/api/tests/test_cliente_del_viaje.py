"""Una sola definición del cliente del viaje (spec 2026-10-11)."""
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.services.cliente_del_viaje import join_cliente, nombre_del_cliente, resolver_cliente


def test_el_cruce_es_por_id_y_nunca_por_texto():
    assert join_cliente("t", "sh") == "LEFT JOIN public.shippers sh ON sh.id = t.shipper_id"
    assert "lower(" not in join_cliente("t2", "s2")


def test_un_viaje_sin_vincular_se_muestra_con_el_texto_del_tms_y_la_marca():
    assert nombre_del_cliente("t", "sh") == "COALESCE(sh.name, t.client_name || ' · sin vincular')"


async def test_resolver_por_id_devuelve_el_nombre_del_directorio():
    conn = AsyncMock()
    conn.fetchrow.return_value = {"id": "s1", "name": "Walmart"}
    assert await resolver_cliente(conn, shipper_id="s1", client_name=None) == ("s1", "Walmart")


async def test_resolver_por_nombre_no_distingue_mayusculas_ni_espacios():
    conn = AsyncMock()
    conn.fetchrow.return_value = {"id": "s1", "name": "Walmart"}
    assert await resolver_cliente(conn, shipper_id=None, client_name="  WALMART ") == ("s1", "Walmart")
    assert "lower(btrim(name)) = lower(btrim($1))" in conn.fetchrow.call_args.args[0]


async def test_un_cliente_que_no_esta_en_el_directorio_se_rechaza():
    conn = AsyncMock()
    conn.fetchrow.return_value = None
    with pytest.raises(HTTPException) as e:
        await resolver_cliente(conn, shipper_id=None, client_name="Prueba")
    assert e.value.status_code == 422
    assert e.value.detail == "El cliente «Prueba» no está en el directorio"


async def test_sin_cliente_se_rechaza():
    with pytest.raises(HTTPException) as e:
        await resolver_cliente(AsyncMock(), shipper_id=None, client_name="  ")
    assert e.value.detail == "Elige el cliente del viaje"


import inspect

import app.routers.trips as trips


def test_la_lista_cruza_y_muestra_el_cliente_por_id():
    assert "sh.id = t.shipper_id" in trips._TRIP_FROM
    assert "COALESCE(sh.name, t.client_name || ' · sin vincular') AS client_name" in trips._TRIP_SELECT
    assert "t.client_name AS source_client_name" in trips._TRIP_SELECT


def test_el_filtro_de_cliente_es_por_id_y_acepta_los_sin_vincular():
    fuente = inspect.getsource(trips.list_trips)
    assert "shipper_id" in inspect.signature(trips.list_trips).parameters
    assert "client" not in inspect.signature(trips.list_trips).parameters
    assert "t.shipper_id IS NULL" in fuente and "t.shipper_id = ANY(" in fuente


def test_los_tipos_de_operacion_se_indexan_por_id():
    fuente = inspect.getsource(trips._load_operation_type_buckets)
    assert "s.id = ANY($1::uuid[])" in fuente and "lower(" not in fuente


import pathlib
import re

APP = pathlib.Path(__file__).resolve().parents[1] / "app"
CRUCE_POR_TEXTO = re.compile(r"lower\((b?trim\()?(sh2?|s|hs)\.name|lower\((b?trim\()?t\.client_name|upper\(trim\(name\)\)")


def test_ningun_cruce_de_cliente_por_texto_queda_en_el_backend():
    """El criterio de aceptación del spec §5."""
    hallazgos = [f"{p.relative_to(APP)}:{i}" for p in APP.rglob("*.py")
                 for i, linea in enumerate(p.read_text().splitlines(), 1) if CRUCE_POR_TEXTO.search(linea)]
    assert hallazgos == []
