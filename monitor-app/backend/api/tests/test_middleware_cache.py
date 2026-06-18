import pytest
import json
from unittest.mock import AsyncMock, patch
from fastapi import FastAPI
from fastapi.testclient import TestClient


def make_app():
    from app.middleware.cache import CacheMiddleware
    app = FastAPI()
    app.add_middleware(CacheMiddleware)

    call_count = {"n": 0}

    @app.get("/api/v1/roles")
    def list_roles():
        call_count["n"] += 1
        return {"roles": [], "call": call_count["n"]}

    @app.get("/api/v1/trips")
    def list_trips():
        call_count["n"] += 1
        return {"trips": [], "call": call_count["n"]}

    @app.post("/api/v1/trips")
    def create_trip():
        return {"id": "new"}

    return app, call_count


def test_static_route_cache_miss_returns_x_cache_miss():
    app, _ = make_app()
    with patch("app.middleware.cache.cache_get", AsyncMock(return_value=None)):
        with patch("app.middleware.cache.cache_set", AsyncMock()):
            client = TestClient(app)
            res = client.get("/api/v1/roles")
            assert res.status_code == 200
            assert res.headers.get("x-cache") == "MISS"


def test_static_route_cache_hit_returns_cached_body():
    app, _ = make_app()
    cached = json.dumps({"roles": [{"id": "admin"}], "call": 1})
    with patch("app.middleware.cache.cache_get", AsyncMock(return_value=cached)):
        client = TestClient(app)
        res = client.get("/api/v1/roles")
        assert res.status_code == 200
        assert res.headers.get("x-cache") == "HIT"
        assert res.json()["roles"][0]["id"] == "admin"


def test_dynamic_route_not_cached():
    """Auth-protected routes like /api/v1/trips must pass through without caching."""
    app, _ = make_app()
    with patch("app.middleware.cache.cache_get", AsyncMock()) as mock_get:
        client = TestClient(app)
        client.get("/api/v1/trips")
        mock_get.assert_not_called()


def test_post_not_cached():
    app, _ = make_app()
    with patch("app.middleware.cache.cache_get", AsyncMock()) as mock_get:
        client = TestClient(app)
        res = client.post("/api/v1/trips")
        assert res.status_code == 200
        mock_get.assert_not_called()
