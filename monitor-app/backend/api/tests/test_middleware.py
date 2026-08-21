"""Guardas sobre la pila de middlewares de la API real (`app.main.app`), no
sobre un `FastAPI()` pelado montado a mano para un solo router.

`test_cors_sigue_estando` vivia en `tests/test_compresion.py` y se borro
junto con ese archivo al sacar `GZipMiddleware` del backend (ver comentario
en `app/main.py`: la compresion se movio al proxy de Next porque el `fetch`
de Node la descomprimia de forma transparente antes de llegar al navegador).
El sujeto de GZip dejo de existir con ese cambio; el de CORS no, y se fue
igual porque se borro el archivo entero sin mirar que mas habia adentro
(hallazgo de la revision final de `perf/compresion-y-resumen`).

Sin esta guarda, nada en el repo nota si alguien reordena la pila de
middlewares y `CORSMiddleware` desaparece: el frontend dejaria de poder
hablarle a la API y ningun test de endpoint lo veria, porque `make_client()`
(ver `test_carriers.py`/`test_compliance.py`) arma un `FastAPI()` nuevo y
pelado con un solo router para probar el endpoint aislado, no la pila real.
"""
from starlette.middleware.cors import CORSMiddleware

from app.main import app


def test_cors_sigue_estando():
    """La guarda de la guarda: si alguien reordena la pila y CORS
    desaparece, el frontend deja de poder hablarle a la API y ningun test
    de endpoint lo ve."""
    clases = [m.cls for m in app.user_middleware]
    assert CORSMiddleware in clases
