from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user, require_admin
from app.db import get_pool
from app.routers.status_taxonomies import router

USER = {"sub": "11111111-1111-1111-1111-111111111111", "email": "a@b.c", "role": "admin"}


def make_client(pool):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_admin] = lambda: USER
    return TestClient(app)


def test_list_requires_domain_query_param():
    pool = AsyncMock()
    client = make_client(pool)
    res = client.get("/api/v1/config/taxonomies")
    assert res.status_code == 422


def test_list_rejects_invalid_domain():
    pool = AsyncMock()
    client = make_client(pool)
    res = client.get("/api/v1/config/taxonomies?domain=NOT_A_DOMAIN")
    assert res.status_code == 422


def test_list_filters_by_domain():
    pool = AsyncMock()
    pool.fetch.return_value = [{
        "id": "t1", "domain": "EQUIPMENT_STATE", "label": "Disponible",
        "bg_color": "#fff", "text_color": "#000", "group": None, "sort_order": 1, "active": True,
    }]
    client = make_client(pool)
    res = client.get("/api/v1/config/taxonomies?domain=EQUIPMENT_STATE")
    assert res.status_code == 200
    assert res.json()[0]["label"] == "Disponible"
    query = pool.fetch.call_args.args[0]
    assert "domain = $1" in query
    assert pool.fetch.call_args.args[1] == "EQUIPMENT_STATE"


def test_create_rejects_invalid_domain():
    pool = AsyncMock()
    client = make_client(pool)
    res = client.post("/api/v1/config/taxonomies", json={"domain": "NOT_A_DOMAIN", "label": "X"})
    assert res.status_code == 422


def test_create_taxonomy():
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "id": "t1", "domain": "EQUIPMENT_STATE", "label": "En Pana",
        "bg_color": "#fef2f2", "text_color": "#b91c1c", "group": None, "sort_order": 3, "active": True,
    }
    client = make_client(pool)
    res = client.post("/api/v1/config/taxonomies", json={
        "domain": "EQUIPMENT_STATE", "label": "En Pana", "bg_color": "#fef2f2", "text_color": "#b91c1c", "sort_order": 3,
    })
    assert res.status_code == 200
    assert res.json()["label"] == "En Pana"


def test_patch_taxonomy_404_when_missing():
    pool = AsyncMock()
    pool.fetchrow.return_value = None
    client = make_client(pool)
    res = client.patch("/api/v1/config/taxonomies/t1", json={"label": "Nuevo"})
    assert res.status_code == 404


def test_patch_taxonomy_no_fields_422():
    pool = AsyncMock()
    pool.fetchrow.return_value = {"id": "t1"}
    client = make_client(pool)
    res = client.patch("/api/v1/config/taxonomies/t1", json={})
    assert res.status_code == 422


def test_deactivate_taxonomy():
    pool = AsyncMock()
    pool.execute.return_value = "UPDATE 1"
    client = make_client(pool)
    res = client.delete("/api/v1/config/taxonomies/t1")
    assert res.status_code == 200


def test_deactivate_taxonomy_404_when_missing():
    pool = AsyncMock()
    pool.execute.return_value = "UPDATE 0"
    client = make_client(pool)
    res = client.delete("/api/v1/config/taxonomies/t1")
    assert res.status_code == 404
