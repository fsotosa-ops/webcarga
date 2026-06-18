import hashlib

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response as StarletteResponse

from ..cache import cache_get, cache_set

# Rutas con TTL largo (datos de configuración, cambian raramente)
_STATIC_ROUTES: dict[str, int] = {
    "/api/v1/roles": 300,
    "/api/v1/trips/meta": 300,
}

# Prefijos con TTL corto (datos operativos, cambian cada ~15 min)
_DYNAMIC_PREFIXES: list[tuple[str, int]] = [
    ("/api/v1/trips", 30),
    ("/api/v1/transporters", 30),
]


def _get_ttl(path: str) -> int | None:
    if path in _STATIC_ROUTES:
        return _STATIC_ROUTES[path]
    for prefix, ttl in _DYNAMIC_PREFIXES:
        if path.startswith(prefix):
            return ttl
    return None


class CacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method != "GET":
            return await call_next(request)

        path = request.url.path
        ttl = _get_ttl(path)
        if ttl is None:
            return await call_next(request)

        query = str(request.url.query)
        key = f"api:{path}:{hashlib.md5(query.encode()).hexdigest()[:8]}"

        cached = await cache_get(key)
        if cached:
            return StarletteResponse(
                content=cached,
                media_type="application/json",
                headers={"X-Cache": "HIT"},
            )

        response = await call_next(request)

        if response.status_code == 200:
            body = b""
            async for chunk in response.body_iterator:
                body += chunk
            await cache_set(key, body.decode(), ex=ttl)
            content_type = response.headers.get("content-type", "application/json")
            return StarletteResponse(
                content=body,
                media_type=content_type,
                headers={"X-Cache": "MISS"},
            )

        return response
