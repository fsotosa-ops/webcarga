"""Cliente de Graph API para traer el Excel EETT directo desde SharePoint —
reemplaza la descarga manual (subir un archivo local) por un fetch
automático del archivo canónico. Mismo app registration/flujo que usaba el
pipeline Mage congelado (ver monitor-app/docs/sharepoint_eett.py) — client
credentials (no requiere sesión de usuario), permisos Graph API ya
otorgados sobre el sitio.

Construido genérico (site_path/file_path como parámetros) para que
Checkpoint F (Seguros) lo pueda reusar sin reescribirlo.
"""
from __future__ import annotations

import httpx
from fastapi import HTTPException

from ..config import get_settings

GRAPH_BASE = "https://graph.microsoft.com/v1.0"


async def fetch_sharepoint_file(site_path: str, file_path: str) -> bytes:
    """`site_path`: ej. 'webcarga0.sharepoint.com:/sites/webcarga.com'.
    `file_path`: ruta del archivo dentro del drive del sitio, ej.
    'General/Documentos Reclutamiento EETT/01 -Status General de EETT/Estatus_Cumplimiento_Gobernanza_Dropdowns.xlsx'."""
    settings = get_settings()
    if not (settings.sharepoint_client_id and settings.sharepoint_client_secret and settings.sharepoint_tenant_id):
        raise HTTPException(502, "Credenciales de SharePoint no configuradas (SHAREPOINT_CLIENT_ID/SECRET/TENANT_ID)")

    async with httpx.AsyncClient(timeout=30) as client:
        token_res = await client.post(
            f"https://login.microsoftonline.com/{settings.sharepoint_tenant_id}/oauth2/v2.0/token",
            data={
                "client_id": settings.sharepoint_client_id,
                "client_secret": settings.sharepoint_client_secret,
                "scope": "https://graph.microsoft.com/.default",
                "grant_type": "client_credentials",
            },
        )
        token = token_res.json().get("access_token")
        if not token:
            raise HTTPException(502, f"Error autenticando contra Graph API: {token_res.text}")
        headers = {"Authorization": f"Bearer {token}"}

        site_res = await client.get(f"{GRAPH_BASE}/sites/{site_path}", headers=headers)
        site_id = site_res.json().get("id")
        if not site_id:
            raise HTTPException(502, f"No se pudo resolver el sitio de SharePoint '{site_path}': {site_res.text}")

        download_res = await client.get(
            f"{GRAPH_BASE}/sites/{site_id}/drive/root:/{file_path}:/content", headers=headers,
        )
        if download_res.status_code != 200:
            raise HTTPException(
                502, f"Error descargando '{file_path}' desde SharePoint: {download_res.status_code}",
            )
        return download_res.content
