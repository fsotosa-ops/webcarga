import pytest
import json
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_get_current_user_uses_cache_on_hit():
    """Si Redis tiene el JWT cacheado, no llama a supabase.auth.get_user()."""
    cached_user = {"sub": "user-123", "email": "test@test.com", "role": "editor"}

    mock_cred = MagicMock()
    mock_cred.credentials = "valid-token"

    with patch("app.auth.cache_get", AsyncMock(return_value=json.dumps(cached_user))):
        with patch("app.auth.get_supabase") as mock_get_supabase:
            from app.auth import get_current_user
            result = await get_current_user(mock_cred, supabase=MagicMock(), pool=MagicMock())
            assert result == cached_user
            mock_get_supabase.assert_not_called()


@pytest.mark.asyncio
async def test_get_current_user_caches_on_miss():
    """Si Redis no tiene el token, valida con Supabase y cachea el resultado."""
    mock_user = MagicMock()
    mock_user.id = "user-456"
    mock_user.email = "user@test.com"

    mock_supabase = MagicMock()
    mock_supabase.auth.get_user.return_value = MagicMock(user=mock_user)

    mock_pool = AsyncMock()
    mock_pool.fetchrow = AsyncMock(return_value={"role": "admin"})

    mock_cred = MagicMock()
    mock_cred.credentials = "miss-token"

    with patch("app.auth.cache_get", AsyncMock(return_value=None)):
        with patch("app.auth.cache_set", AsyncMock()) as mock_cache_set:
            from app.auth import get_current_user
            result = await get_current_user(mock_cred, supabase=mock_supabase, pool=mock_pool)
            assert result["role"] == "admin"
            assert result["email"] == "user@test.com"
            mock_cache_set.assert_called_once()
            call_args = mock_cache_set.call_args
            assert call_args.kwargs.get("ex") == 60 or call_args.args[2] == 60
