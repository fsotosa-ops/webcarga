from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.db import get_pool
from app.routers.shippers import router
from tests.conftest import USER


def make_client(pool):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: USER
    return TestClient(app)


def test_list_shippers_orders_by_name():
    pool = AsyncMock()
    pool.fetch.return_value = [
        {"id": "s1", "name": "Colun", "status": "ACTIVE"},
        {"id": "s2", "name": "Walmart", "status": "ACTIVE"},
    ]
    client = make_client(pool)

    res = client.get("/api/v1/shippers")

    assert res.status_code == 200
    body = res.json()
    assert [s["name"] for s in body] == ["Colun", "Walmart"]
    query = pool.fetch.call_args.args[0]
    assert "FROM public.shippers" in query
    assert "ORDER BY sh.name" in query


def test_create_shipper_success():
    pool = AsyncMock()
    pool.fetchrow.return_value = {"id": "s2", "name": "Nuevo Cliente Spot", "status": "ACTIVE"}
    client = make_client(pool)
    res = client.post("/api/v1/shippers", json={"name": "Nuevo Cliente Spot"})
    assert res.status_code == 201
    assert res.json()["name"] == "Nuevo Cliente Spot"


def test_create_shipper_duplicate_name_is_409():
    pool = AsyncMock()
    pool.fetchrow.side_effect = Exception('duplicate key value violates unique constraint "shippers_name_key"')
    client = make_client(pool)
    res = client.post("/api/v1/shippers", json={"name": "Walmart"})
    assert res.status_code == 409


# ── Directorio › Clientes (Configuración, Parte 3) ───────────────────────────
from tests.conftest import usuario, wire_transactional_conn  # noqa: E402

SHIPPER_ID = "00000000-0000-0000-0000-0000000000a1"


def _con(pool, quien):
    client = make_client(pool)
    client.app.dependency_overrides[get_current_user] = lambda: quien
    return client


def test_el_detalle_de_un_cliente_que_no_existe_es_404():
    pool = AsyncMock()
    pool.fetchrow.return_value = None
    assert make_client(pool).get(f"/api/v1/shippers/{SHIPPER_ID}").status_code == 404


def test_un_id_que_no_es_uuid_es_422():
    pool = AsyncMock()
    assert make_client(pool).get("/api/v1/shippers/colun").status_code == 422
    assert make_client(pool).patch("/api/v1/shippers/colun", json={"name": "X"}).status_code == 422


def test_editar_un_cliente_exige_commercial_edit():
    pool = AsyncMock()
    res = _con(pool, usuario("operations_supervisor")).patch(f"/api/v1/shippers/{SHIPPER_ID}", json={"name": "X"})
    assert res.status_code == 403


def test_editar_rechaza_campos_de_mas_y_estados_inventados():
    pool = AsyncMock()
    client = make_client(pool)
    assert client.patch(f"/api/v1/shippers/{SHIPPER_ID}", json={"name": "X", "color": "red"}).status_code == 422
    assert client.patch(f"/api/v1/shippers/{SHIPPER_ID}", json={"status": "BORRADO"}).status_code == 422
    assert client.patch(f"/api/v1/shippers/{SHIPPER_ID}", json={"name": "   "}).status_code == 422


def test_renombrar_a_un_nombre_que_ya_existe_es_409():
    pool = AsyncMock()
    conn = AsyncMock()
    conn.fetchrow.return_value = {"name": "Colun", "status": "ACTIVE"}
    conn.execute.side_effect = Exception('duplicate key value violates unique constraint "shippers_name_ci_key"')
    wire_transactional_conn(pool, conn)
    res = make_client(pool).patch(f"/api/v1/shippers/{SHIPPER_ID}", json={"name": "walmart"})
    assert res.status_code == 409
