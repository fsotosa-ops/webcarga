from upstash_redis.asyncio import Redis
from .config import get_settings


def get_redis() -> Redis | None:
    settings = get_settings()
    if not settings.upstash_redis_rest_url:
        return None
    return Redis(
        url=settings.upstash_redis_rest_url,
        token=settings.upstash_redis_rest_token,
    )


async def cache_get(key: str) -> str | None:
    redis = get_redis()
    if redis is None:
        return None
    try:
        return await redis.get(key)
    except Exception:
        return None


async def cache_set(key: str, value: str, ex: int) -> None:
    redis = get_redis()
    if redis is None:
        return
    try:
        await redis.set(key, value, ex=ex)
    except Exception:
        return


async def cache_delete(key: str) -> None:
    redis = get_redis()
    if redis is None:
        return
    try:
        await redis.delete(key)
    except Exception:
        return


async def invalidate_trips_meta_cache() -> None:
    """GET /trips/meta queda cacheado hasta 5 min (CacheMiddleware) — cualquier
    escritura en config.py/status_taxonomies.py que alimente ese endpoint
    (trip_statuses, status_taxonomies, monitor_alert_rules, alert_thresholds,
    temperature_ranges) debe invalidarlo, o el admin no ve su cambio reflejado
    en el Diario hasta que expire el TTL. Mismo formato de key que
    CacheMiddleware (path + md5 de la query, vacía en este endpoint)."""
    import hashlib
    key = f"api:/api/v1/trips/meta:{hashlib.md5(b'').hexdigest()[:8]}"
    await cache_delete(key)
