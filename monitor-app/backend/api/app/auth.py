import asyncio
import json
from functools import lru_cache
from pathlib import Path

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase import Client, create_client

from .cache import cache_get, cache_set
from .config import Settings, get_settings
from .db import get_pool

bearer = HTTPBearer()

# El proyecto firma los JWT con una llave asimétrica (ES256). Su parte
# PÚBLICA va versionada en `supabase_jwks.json` —no es un secreto— y se usa
# primero: así verificar no depende de Supabase Auth ni en una instancia
# recién levantada. Auth sirve el JWKS desde su misma base, y el 22/09 (y de
# nuevo el 23/09) ese endpoint tampoco respondía mientras la base estaba
# saturada; con min-instances=0, cada arranque en frío durante la caída
# habría quedado sin poder verificar a nadie.
#
# Rotar la llave en Supabase no rompe nada: un `kid` que no está en el
# archivo se busca en el JWKS en vivo. REVOCAR una llave, en cambio, exige
# sacarla de este archivo (y de frontend/lib/supabase/jwks.json): mientras
# esté acá, sus tokens siguen siendo válidos.
ALGORITMOS = ["ES256"]
AUDIENCIA = "authenticated"
_LLAVES_CONOCIDAS = {
    k["kid"]: jwt.PyJWK(k)
    for k in json.loads((Path(__file__).parent / "supabase_jwks.json").read_text())["keys"]
}


def get_supabase(settings: Settings = Depends(get_settings)) -> Client:
    """Cliente con service role para Storage. NO se usa para autenticar."""
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


@lru_cache
def _jwks(supabase_url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(f"{supabase_url}/auth/v1/.well-known/jwks.json", cache_keys=True, lifespan=3600)


async def verificar_token(token: str, supabase_url: str) -> dict:
    """Los claims del JWT, verificados LOCALMENTE con la llave pública.

    Antes cada request preguntaba a Supabase Auth por HTTP
    (`supabase.auth.get_user`), con un cliente síncrono que además bloqueaba
    el event loop. El 22/09 la base de Supabase se saturó, Auth cayó con ella,
    y la API contestó 401 a todo después de 44 s: nadie pudo trabajar, ni
    siquiera con una sesión válida. Verificar la firma localmente es el
    patrón que recomienda Supabase para llaves asimétricas, y deja a Auth
    fuera del camino de cada request: sólo se lo necesita para iniciar sesión
    y refrescar el token.

    Sólo si la llave no está entre las conocidas se baja el JWKS; esa
    descarga es bloqueante, por eso va en un hilo."""
    try:
        llave = _LLAVES_CONOCIDAS.get(jwt.get_unverified_header(token).get("kid"))
        if llave is None:
            llave = await asyncio.to_thread(_jwks(supabase_url).get_signing_key_from_jwt, token)
    except jwt.PyJWKClientConnectionError:
        raise HTTPException(503, "El servicio de autenticación no responde. Reintenta en unos minutos.")
    except (jwt.PyJWKClientError, jwt.InvalidTokenError):
        raise HTTPException(401, "Token inválido o expirado")
    try:
        return jwt.decode(
            token, llave.key, algorithms=ALGORITMOS, audience=AUDIENCIA,
            issuer=f"{supabase_url}/auth/v1",
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Tu sesión expiró. Vuelve a iniciar sesión.")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Token inválido o expirado")


async def get_current_user(
    cred: HTTPAuthorizationCredentials = Depends(bearer),
    settings: Settings = Depends(get_settings),
    pool=Depends(get_pool),
) -> dict:
    claims = await verificar_token(cred.credentials, settings.supabase_url)
    sub = claims.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="No autenticado")

    # Los permisos viven en la base (RBAC, spec 2026-10-09): la unión de los
    # permisos de los roles de la persona (app/authz/effective.py), cacheada
    # 60 s e invalidada al cambiar sus roles. Import local: app.authz importa
    # de este módulo (require usa get_current_user).
    from .authz.effective import load_access

    acceso = await load_access(pool, sub)
    if acceso is None or not acceso["roles"]:
        raise HTTPException(status_code=403, detail="Tu cuenta no tiene acceso. Pide a un administrador que te invite.")
    # Una cuenta desactivada no espera a que venza su token (hasta 1 h).
    if acceso["active"] is False:
        raise HTTPException(status_code=403, detail="Tu cuenta está desactivada")
    # `aal` (authenticator assurance level): aal2 = la sesión pasó la
    # verificación en dos pasos; la exigen los permisos privilegiados
    # (app/authz/deps.py).
    return {"sub": sub, "email": claims.get("email"), "aal": claims.get("aal"),
            "roles": acceso["roles"], "permissions": frozenset(acceso["permissions"])}


# Mensaje fijo: el frontend lo reconoce para llevar a inscribir el factor.
MFA_REQUERIDO = "Activa la verificación en dos pasos para administrar WebCarga."
