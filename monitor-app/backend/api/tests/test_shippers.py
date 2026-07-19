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
    assert "ORDER BY name" in query


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
