import hashlib
import json

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase import Client, create_client

from .cache import cache_get, cache_set
from .config import Settings, get_settings
from .db import get_pool

bearer = HTTPBearer()

EDITOR_ROLES = {"editor", "admin", "owner"}
ADMIN_ROLES = {"admin", "owner"}


def get_supabase(settings: Settings = Depends(get_settings)) -> Client:
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


async def get_current_user(
    cred: HTTPAuthorizationCredentials = Depends(bearer),
    supabase: Client = Depends(get_supabase),
    pool=Depends(get_pool),
) -> dict:
    token = cred.credentials
    token_key = f"jwt:{hashlib.sha256(token.encode()).hexdigest()[:16]}"

    cached = await cache_get(token_key)
    if cached:
        return json.loads(cached)

    try:
        response = supabase.auth.get_user(token)
        user = response.user
    except Exception:
        raise HTTPException(status_code=401, detail="Token inválido o expirado")

    if user is None:
        raise HTTPException(status_code=401, detail="No autenticado")

    row = await pool.fetchrow(
        "SELECT role FROM public.profiles WHERE id = $1", str(user.id)
    )
    role = row["role"] if row else "viewer"
    result = {"sub": str(user.id), "email": user.email, "role": role}

    await cache_set(token_key, json.dumps(result), ex=60)
    return result


async def require_editor(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] not in EDITOR_ROLES:
        raise HTTPException(status_code=403, detail="Se requiere rol editor o superior")
    return user


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Se requiere rol admin o superior")
    return user
