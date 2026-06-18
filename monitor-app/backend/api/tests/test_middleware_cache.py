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

    @app.get("/api/v1/trips")
    def list_trips():
        call_count["n"] += 1
        return {"trips": [], "call": call_count["n"]}

    @app.get("/api/v1/roles")
    def list_roles():
        call_count["n"] += 1
        return {"roles": []}

    @app.post("/api/v1/trips")
    def create_trip():
        return {"id": "new"}

    return app, call_count


def test_cache_miss_returns_x_cache_miss():
    app, _ = make_app()
    with patch("app.middleware.cache.cache_get", AsyncMock(return_value=None)):
        with patch("app.middleware.cache.cache_set", AsyncMock()):
            client = TestClient(app)
            res = client.get("/api/v1/trips")
            assert res.status_code == 200
            assert res.headers.get("x-cache") == "MISS"


def test_cache_hit_returns_cached_body():
    app, _ = make_app()
    cached = json.dumps({"trips": [{"id": "cached"}], "call": 1})
    with patch("app.middleware.cache.cache_get", AsyncMock(return_value=cached)):
        client = TestClient(app)
        res = client.get("/api/v1/trips")
        assert res.status_code == 200
        assert res.headers.get("x-cache") == "HIT"
        assert res.json()["trips"][0]["id"] == "cached"


def test_post_not_cached():
    app, _ = make_app()
    with patch("app.middleware.cache.cache_get", AsyncMock()) as mock_get:
        client = TestClient(app)
        res = client.post("/api/v1/trips")
        assert res.status_code == 200
        mock_get.assert_not_called()


def test_uncached_route_passes_through():
    app, call_count = make_app()
    with patch("app.middleware.cache.cache_get", AsyncMock(return_value=None)):
        with patch("app.middleware.cache.cache_set", AsyncMock()):
            client = TestClient(app)
            res = client.get("/health")
            assert res.status_code == 404  # /health no está en este test app — pasó sin cache
