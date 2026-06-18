import pytest
from unittest.mock import AsyncMock, patch, MagicMock


@pytest.fixture
def mock_settings_with_redis():
    settings = MagicMock()
    settings.upstash_redis_rest_url = "https://included-serval-41602.upstash.io"
    settings.upstash_redis_rest_token = "token123"
    return settings


@pytest.fixture
def mock_settings_without_redis():
    settings = MagicMock()
    settings.upstash_redis_rest_url = ""
    settings.upstash_redis_rest_token = ""
    return settings


def test_get_redis_returns_none_when_no_url(mock_settings_without_redis):
    with patch("app.cache.get_settings", return_value=mock_settings_without_redis):
        from app.cache import get_redis
        assert get_redis() is None


def test_get_redis_returns_client_when_url_set(mock_settings_with_redis):
    with patch("app.cache.get_settings", return_value=mock_settings_with_redis):
        with patch("app.cache.Redis") as mock_redis_cls:
            mock_redis_cls.return_value = MagicMock()
            from app.cache import get_redis
            result = get_redis()
            assert result is not None
            mock_redis_cls.assert_called_once_with(
                url="https://included-serval-41602.upstash.io",
                token="token123",
            )


@pytest.mark.asyncio
async def test_cache_get_returns_none_when_no_redis():
    with patch("app.cache.get_redis", return_value=None):
        from app.cache import cache_get
        result = await cache_get("some-key")
        assert result is None


@pytest.mark.asyncio
async def test_cache_set_is_noop_when_no_redis():
    with patch("app.cache.get_redis", return_value=None):
        from app.cache import cache_set
        await cache_set("key", "value", ex=30)  # no debe lanzar excepción


@pytest.mark.asyncio
async def test_cache_get_returns_value_when_hit():
    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value='"cached_data"')
    with patch("app.cache.get_redis", return_value=mock_redis):
        from app.cache import cache_get
        result = await cache_get("api:/trips:")
        assert result == '"cached_data"'


@pytest.mark.asyncio
async def test_cache_set_calls_redis_set():
    mock_redis = AsyncMock()
    mock_redis.set = AsyncMock(return_value=True)
    with patch("app.cache.get_redis", return_value=mock_redis):
        from app.cache import cache_set
        await cache_set("key", "value", ex=30)
        mock_redis.set.assert_called_once_with("key", "value", ex=30)
