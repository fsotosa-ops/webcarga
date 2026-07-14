"""Tests de app/utils/sharepoint_client.py — httpx.AsyncClient mockeado,
sin llamadas de red reales."""
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import HTTPException

from app.utils.sharepoint_client import fetch_sharepoint_file


def _mock_response(json_data=None, content=None, status_code=200):
    return httpx.Response(
        status_code=status_code,
        json=json_data,
        content=content,
        request=httpx.Request("GET", "https://graph.microsoft.com/"),
    )


@pytest.mark.asyncio
async def test_fetch_sharepoint_file_success():
    token_resp = _mock_response(json_data={"access_token": "fake-token"})
    site_resp = _mock_response(json_data={"id": "site-123"})
    download_resp = _mock_response(content=b"contenido del excel")

    with patch("app.utils.sharepoint_client.get_settings") as mock_settings:
        mock_settings.return_value.sharepoint_client_id = "cid"
        mock_settings.return_value.sharepoint_client_secret = "secret"
        mock_settings.return_value.sharepoint_tenant_id = "tid"

        with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=token_resp)), \
             patch("httpx.AsyncClient.get", new=AsyncMock(side_effect=[site_resp, download_resp])):
            result = await fetch_sharepoint_file("sites/webcarga.com", "General/archivo.xlsx")

    assert result == b"contenido del excel"


@pytest.mark.asyncio
async def test_fetch_sharepoint_file_auth_failure_raises_502():
    token_resp = _mock_response(json_data={"error": "invalid_client"}, status_code=401)

    with patch("app.utils.sharepoint_client.get_settings") as mock_settings:
        mock_settings.return_value.sharepoint_client_id = "cid"
        mock_settings.return_value.sharepoint_client_secret = "secret"
        mock_settings.return_value.sharepoint_tenant_id = "tid"

        with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=token_resp)):
            with pytest.raises(HTTPException) as exc:
                await fetch_sharepoint_file("sites/webcarga.com", "General/archivo.xlsx")

    assert exc.value.status_code == 502


@pytest.mark.asyncio
async def test_fetch_sharepoint_file_missing_credentials_raises_502():
    with patch("app.utils.sharepoint_client.get_settings") as mock_settings:
        mock_settings.return_value.sharepoint_client_id = ""
        mock_settings.return_value.sharepoint_client_secret = ""
        mock_settings.return_value.sharepoint_tenant_id = ""

        with pytest.raises(HTTPException) as exc:
            await fetch_sharepoint_file("sites/webcarga.com", "General/archivo.xlsx")

    assert exc.value.status_code == 502
