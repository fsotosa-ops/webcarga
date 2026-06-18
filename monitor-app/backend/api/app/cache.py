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
