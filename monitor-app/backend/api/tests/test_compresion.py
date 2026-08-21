"""El backend comprime lo que manda, y el orden de los middlewares importa.

Las respuestas de este servicio son JSON con las mismas claves repetidas en
cada fila —`/compliance-records/pending` mide ~662 bytes por fila y la ficha de
una empresa pide hasta 500—, y el salto Next -> API viajaba crudo.

El test del orden no es ceremonia: `CacheMiddleware` guarda `body.decode()`, asi
que si GZip quedara por DENTRO, el cache recibiria bytes comprimidos y reventaria
con UnicodeDecodeError en cada MISS. Eso no lo ve ningun test de endpoint.
"""
from unittest.mock import AsyncMock

from fastapi.middleware.gzip import GZipMiddleware
from starlette.middleware.cors import CORSMiddleware

from app.main import app
from app.middleware.cache import CacheMiddleware
from contextlib import contextmanager

from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.db import get_pool
from tests.conftest import USER
from tests.test_carriers import _carrier_facets_row


def _clases_de_middleware() -> list:
    """De la mas externa a la mas interna, que es el orden en que Starlette las
    guarda: `add_middleware` inserta al principio de la lista."""
    return [m.cls for m in app.user_middleware]


def test_gzip_envuelve_al_cache_y_no_al_reves():
    clases = _clases_de_middleware()
    assert GZipMiddleware in clases, "falta GZipMiddleware"
    assert CacheMiddleware in clases
    assert clases.index(GZipMiddleware) < clases.index(CacheMiddleware), (
        "GZip tiene que ser MAS EXTERNO que CacheMiddleware: el cache guarda "
        "body.decode() y con bytes comprimidos revienta con UnicodeDecodeError"
    )


def test_cors_sigue_estando():
    """La guarda de la guarda: si alguien reordena la pila y CORS desaparece,
    el frontend deja de poder hablarle a la API y ningun test de endpoint lo ve.
    """
    assert CORSMiddleware in _clases_de_middleware()


def _pool_con(filas: int) -> AsyncMock:
    """El mismo molde de datos que usa `test_list_carriers_aggregates_...`."""
    pool = AsyncMock()
    pool.fetch.return_value = [
        {"id": f"c{i}", "tax_id": "1-9", "country_code": "CL",
         "business_name": "Transportes De Prueba Sociedad Anonima",
         "operational_status": "ACTIVE", "total_requirements": 12,
         "last_document_update": None, "pending_mandatory": 2,
         "compliance_health": "PENDING"}
        for i in range(filas)
    ]
    pool.fetchval.return_value = filas
    pool.fetchrow.return_value = _carrier_facets_row(pending=filas, total=filas)
    return pool


@contextmanager
def cliente_de_la_app_real(filas: int):
    """Un cliente sobre la aplicacion REAL, con su pila de middlewares.

    `make_client` de `test_carriers.py` NO sirve para esto: arma un `FastAPI()`
    nuevo y pelado con un solo router, sin CORS, sin cache y sin GZip. Es lo
    correcto para probar un endpoint aislado y lo inservible para probar la
    pila — un test escrito sobre el habria dado verde con el middleware
    ausente, que es justamente lo que este archivo tiene que detectar.

    Las dependencias se restauran al salir: `app` es un objeto de modulo y
    dejarlo pisado se lo lleva puesto al resto de la suite.
    """
    previas = dict(app.dependency_overrides)
    app.dependency_overrides[get_pool] = lambda: _pool_con(filas)
    app.dependency_overrides[get_current_user] = lambda: USER
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides = previas


def test_una_respuesta_grande_viaja_comprimida():
    # 400 filas con las mismas claves repetidas: la forma real de lo que este
    # servicio devuelve, y la que mejor comprime.
    with cliente_de_la_app_real(400) as client:
        res = client.get("/api/v1/carriers", headers={"Accept-Encoding": "gzip"})

    assert res.status_code == 200
    assert res.headers.get("content-encoding") == "gzip", (
        "una respuesta de 400 filas tiene que viajar comprimida"
    )
    assert len(res.content) > 50_000, "el cuerpo tiene que ser grande de verdad"
    # NO se afirma la razon de compresion: el `Content-Length` no llega —la rama
    # de streaming lo borra, se lee en la fuente de starlette— y ademas medir
    # cuanto comprime zlib seria probar zlib, no este servicio. El ahorro se
    # midio una vez, a mano y sobre esta misma forma de payload: 26.691 bytes
    # -> 1.125, un 96%. Lo que este test fija es lo unico que decide este
    # codigo: que la pila comprime lo grande.


def test_el_minimum_size_hoy_no_se_aplica_y_esto_lo_deja_dicho():
    """`minimum_size=1000` esta declarado y NO rige. No es un bug: es una
    interaccion entre dos middlewares, y este test existe para que nadie la
    vuelva a investigar de cero.

    `CacheMiddleware` es un `BaseHTTPMiddleware`, y ese emite toda respuesta
    como streaming. En el camino de streaming, GZip comprime sin mirar el
    tamano —se lee en la fuente de starlette: la rama `else` del
    `send_with_compression` no consulta `minimum_size`—. Medido: 81 bytes
    salen comprimidos con el cache puesto, y sin comprimir sin el.

    Si algun dia `CacheMiddleware` pasa a ser ASGI puro, este test se pone rojo
    y hay que actualizar el comentario de `main.py`: seria una mejora, no una
    regresion.
    """
    with cliente_de_la_app_real(0) as client:
        res = client.get("/api/v1/carriers", headers={"Accept-Encoding": "gzip"})

    assert res.status_code == 200
    assert len(res.content) < 1000, "la respuesta vacia tiene que ser chica"
    assert res.headers.get("content-encoding") == "gzip", (
        "si esto dejo de comprimir, `minimum_size` volvio a regir: revisa si "
        "CacheMiddleware dejo de ser BaseHTTPMiddleware y actualiza main.py"
    )
