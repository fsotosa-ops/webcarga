"""La API verifica el JWT localmente, sin preguntarle a Supabase Auth.

El 22/09 la base de Supabase se saturó y Auth cayó con ella: la API, que
validaba cada request contra Auth por HTTP, contestó 401 a todos después de
44 s, aunque tuvieran una sesión válida. Estos tests fijan que la validación
es local —firma ES256 contra el JWKS del proyecto— y que distingue lo que es
culpa del token (401) de lo que es culpa del servicio (503).
"""
import json
import time
from unittest.mock import AsyncMock, MagicMock, patch

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException

from app import auth

URL = "https://proyecto.supabase.co"
LLAVE = ec.generate_private_key(ec.SECP256R1())
OTRA_LLAVE = ec.generate_private_key(ec.SECP256R1())


def _token(llave=LLAVE, **cambios) -> str:
    claims = {
        "sub": "11111111-1111-1111-1111-111111111111", "email": "op@webcarga.cl",
        "aud": "authenticated", "iss": f"{URL}/auth/v1", "exp": int(time.time()) + 600,
        **cambios,
    }
    return jwt.encode(claims, llave, algorithm="ES256", headers={"kid": "k1"})


@pytest.fixture(autouse=True)
def jwks_local(monkeypatch):
    """El JWKS del proyecto, servido desde memoria: el test no sale a la red."""
    cliente = MagicMock()
    cliente.get_signing_key_from_jwt.return_value = MagicMock(key=LLAVE.public_key())
    monkeypatch.setattr(auth, "_jwks", lambda url: cliente)
    return cliente


def _cred(token):
    return MagicMock(credentials=token)


def _pool(role="editor", active=True):
    pool = MagicMock()
    pool.fetchrow = AsyncMock(return_value={"role": role, "active": active})
    return pool


@pytest.fixture
def sin_cache():
    with patch("app.auth.cache_get", AsyncMock(return_value=None)), \
         patch("app.auth.cache_set", AsyncMock()) as guardar:
        yield guardar


async def test_token_valido_da_el_usuario_con_el_rol_de_profiles(sin_cache):
    user = await auth.get_current_user(_cred(_token()), settings=MagicMock(supabase_url=URL), pool=_pool("admin"))
    assert user == {"sub": "11111111-1111-1111-1111-111111111111", "email": "op@webcarga.cl", "role": "admin"}
    assert sin_cache.call_args.kwargs["ex"] == 60


async def test_no_llama_a_supabase_auth(sin_cache):
    with patch("app.auth.create_client") as crear:
        await auth.get_current_user(_cred(_token()), settings=MagicMock(supabase_url=URL), pool=_pool())
    crear.assert_not_called()


@pytest.mark.parametrize("token", [
    _token(exp=int(time.time()) - 10),
    _token(llave=OTRA_LLAVE),
    _token(aud="anon"),
    _token(iss="https://otro.supabase.co/auth/v1"),
    "no-es-un-jwt",
], ids=["vencido", "firmado-por-otra-llave", "audiencia-ajena", "emisor-ajeno", "basura"])
async def test_token_invalido_es_401(token, sin_cache):
    with pytest.raises(HTTPException) as err:
        await auth.get_current_user(_cred(token), settings=MagicMock(supabase_url=URL), pool=_pool())
    assert err.value.status_code == 401


async def test_la_llave_versionada_verifica_sin_salir_a_la_red(monkeypatch, jwks_local, sin_cache):
    """El 23/09 el JWKS de Auth no respondía: una llave conocida no lo necesita."""
    monkeypatch.setitem(auth._LLAVES_CONOCIDAS, "k1", jwt.PyJWK.from_dict({
        **json.loads(jwt.algorithms.ECAlgorithm.to_jwk(LLAVE.public_key())), "kid": "k1", "alg": "ES256"}))
    jwks_local.get_signing_key_from_jwt.side_effect = jwt.PyJWKClientConnectionError("timeout")

    user = await auth.get_current_user(_cred(_token()), settings=MagicMock(supabase_url=URL), pool=_pool())

    assert user["sub"] == "11111111-1111-1111-1111-111111111111"
    jwks_local.get_signing_key_from_jwt.assert_not_called()


def test_el_archivo_de_llaves_solo_trae_llaves_publicas():
    datos = json.loads((auth.Path(auth.__file__).parent / "supabase_jwks.json").read_text())
    assert datos["keys"] and all("d" not in k for k in datos["keys"])


async def test_si_no_se_puede_bajar_la_llave_es_503_no_401(jwks_local, sin_cache):
    """Un 401 le dice al frontend "tu sesión no sirve" y lo manda a /login;
    que Auth no responda no es culpa de la sesión."""
    jwks_local.get_signing_key_from_jwt.side_effect = jwt.PyJWKClientConnectionError("timeout")
    with pytest.raises(HTTPException) as err:
        await auth.get_current_user(_cred(_token()), settings=MagicMock(supabase_url=URL), pool=_pool())
    assert err.value.status_code == 503


async def test_cuenta_desactivada_es_403_aunque_el_token_siga_vigente(sin_cache):
    with pytest.raises(HTTPException) as err:
        await auth.get_current_user(_cred(_token()), settings=MagicMock(supabase_url=URL), pool=_pool(active=False))
    assert err.value.status_code == 403


async def test_el_rol_cacheado_evita_la_consulta_a_profiles():
    pool = _pool()
    with patch("app.auth.cache_get", AsyncMock(return_value=json.dumps({"role": "owner", "active": True}))):
        user = await auth.get_current_user(_cred(_token()), settings=MagicMock(supabase_url=URL), pool=pool)
    assert user["role"] == "owner"
    pool.fetchrow.assert_not_called()
