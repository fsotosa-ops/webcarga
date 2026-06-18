"""Integration test end-to-end del adapter Sodimac.

Requisitos:
- Chrome instalado en /Applications/Google Chrome.app (para `channel="chrome"`).
- Credenciales SODIMAC_USER/PASS en .env del servicio.
- Conexión a tms.falabella.supply.

Correr con:
    cd extraction_service
    INTEGRATION=1 ./venv/bin/python -m pytest -v tests/test_sodimac_adapter.py
"""
import asyncio
import csv
import os
from pathlib import Path

import pytest

from app.tms.sodimac.scraper import SodimacExtractor


REQUIRES_INTEGRATION = pytest.mark.skipif(
    not os.getenv("INTEGRATION"),
    reason="Integration test; correr con INTEGRATION=1.",
)


def _read_csv(path: Path):
    with open(path, encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter=";")
        rows = list(reader)
        headers = list(reader.fieldnames or [])
    return headers, rows


def _run_extract(client_name: str):
    # El adapter sodimac ignora date_from/date_to — scrapea el set completo
    # visible (actualmente ~228 solicitudes). Los pasamos como None para
    # reflejar el contrato.
    return asyncio.run(
        SodimacExtractor().extract(
            client_name=client_name,
            date_from=None,
            date_to=None,
            timeout_ms=180_000,
        )
    )


@pytest.mark.integration
@REQUIRES_INTEGRATION
def test_end_to_end_extraction():
    """Invariantes post-extracción: CSV creado, schema, no rows vacías, IDs únicos."""
    artifact = _run_extract("test_integration")

    csv_path = Path(artifact.local_path)
    assert csv_path.exists(), f"CSV no se creó en {csv_path}"

    headers, rows = _read_csv(csv_path)

    # 1. Schema: columna de ID del viaje presente.
    assert "Nº ID" in headers, f"Headers sin 'Nº ID': {headers}"

    # 2. Al menos una fila.
    assert rows, "CSV sin filas"

    # 3. Ninguna fila completamente vacía (sería scraping de esqueleto).
    for i, row in enumerate(rows):
        non_empty = [v for v in row.values() if v and v.strip()]
        assert non_empty, f"Fila {i} completamente vacía"

    # 4. Ningún Nº ID duplicado (detecta race condition entre páginas).
    ids = [row["Nº ID"] for row in rows if row.get("Nº ID")]
    assert len(ids) == len(set(ids)), (
        f"Nº ID duplicados: {[x for x in ids if ids.count(x) > 1]}"
    )


@pytest.mark.integration
@REQUIRES_INTEGRATION
def test_reproducibility():
    """Dos corridas consecutivas deben devolver los mismos Nº ID —
    detecta pagination bugs o race conditions."""
    a1 = _run_extract("test_repro_1")
    a2 = _run_extract("test_repro_2")

    _, rows1 = _read_csv(Path(a1.local_path))
    _, rows2 = _read_csv(Path(a2.local_path))

    ids1 = sorted(r["Nº ID"] for r in rows1 if r.get("Nº ID"))
    ids2 = sorted(r["Nº ID"] for r in rows2 if r.get("Nº ID"))

    assert ids1 == ids2, (
        f"Diferencia entre corridas: "
        f"solo en #1={set(ids1) - set(ids2)}, solo en #2={set(ids2) - set(ids1)}"
    )
