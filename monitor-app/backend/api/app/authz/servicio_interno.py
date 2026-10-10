"""Quién puede llamar a los endpoints internos: Cloud Scheduler, con un token
OIDC de Google emitido para su cuenta de servicio (spec 2026-10-10, §3.3).

Mismo mecanismo que `auth.verificar_token` para Supabase: la firma se verifica
localmente con las llaves públicas del emisor (PyJWT + JWKS), sin dependencias
nuevas."""
from __future__ import annotations

import asyncio
from functools import lru_cache

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from ..config import Settings, get_settings

_GOOGLE_JWKS = "https://www.googleapis.com/oauth2/v3/certs"
_EMISORES = ("https://accounts.google.com", "accounts.google.com")
_bearer = HTTPBearer(auto_error=False)


@lru_cache
def _cliente_jwks() -> jwt.PyJWKClient:
    return jwt.PyJWKClient(_GOOGLE_JWKS, cache_keys=True, lifespan=3600)


def _llave_de_google(token: str):
    return _cliente_jwks().get_signing_key_from_jwt(token).key


async def requiere_scheduler(
    cred: HTTPAuthorizationCredentials | None = Depends(_bearer),
    settings: Settings = Depends(get_settings),
) -> str:
    if not settings.scheduler_service_account or not settings.scheduler_audience:
        raise HTTPException(403, "Endpoint interno sin configurar")
    if cred is None:
        raise HTTPException(401, "Falta el token")
    try:
        llave = await asyncio.to_thread(_llave_de_google, cred.credentials)
        claims = jwt.decode(cred.credentials, llave, algorithms=["RS256"],
                            audience=settings.scheduler_audience, options={"require": ["exp", "iss", "aud"]})
    except (jwt.PyJWKClientError, jwt.InvalidTokenError):
        raise HTTPException(401, "Token inválido")
    if claims.get("iss") not in _EMISORES:
        raise HTTPException(401, "Token inválido")
    if claims.get("email") != settings.scheduler_service_account or not claims.get("email_verified"):
        raise HTTPException(403, "Cuenta no autorizada")
    return claims["email"]
