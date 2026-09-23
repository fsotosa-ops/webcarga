"""Un 500 imprevisto responde JSON con `detail` y una referencia.

El frontend (lib/api/client.ts) muestra `detail`; sin él sólo podía decir
"Error 500" — el reporte del 23/09 llegó así, sin ninguna pista."""
import re

from fastapi.testclient import TestClient

from app.main import app


@app.get("/__test__/revienta")
async def _revienta():
    raise RuntimeError("falla imprevista")


def test_un_error_imprevisto_llega_con_detalle_y_referencia(caplog):
    client = TestClient(app, raise_server_exceptions=False)

    res = client.get("/__test__/revienta")

    assert res.status_code == 500
    detalle = res.json()["detail"]
    ref = re.search(r"ref\. ([0-9a-f]{8})", detalle).group(1)
    assert "falla imprevista" not in detalle  # el mensaje interno no se filtra
    assert any(ref in r.getMessage() for r in caplog.records)
