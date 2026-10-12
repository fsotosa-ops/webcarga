"""La migración que retira los umbrales por documento (D1-R4, R-E11).

Corre el archivo real dentro de una transacción revertida: borra todo lo que
no sea la fila global, guarda cada fila borrada en audit_log y se puede
correr dos veces sin duplicar la copia."""
import json
from pathlib import Path

import pytest

from app.services.vencimientos import GLOBAL_ALERT_THRESHOLD

MIGRACION = (Path(__file__).resolve().parents[2]
             / "supabase/migrations/20261015090000_retire_per_document_alert_thresholds.sql")


@pytest.mark.integracion
@pytest.mark.asyncio
async def test_la_migracion_deja_solo_la_global_y_guarda_la_copia(conexion_revertida):
    conn = conexion_revertida
    # El sujeto lo crea el test: una fila por documento con valores reconocibles.
    await conn.execute(
        "INSERT INTO app.alert_thresholds (doc_type, label, warning_days, error_days) VALUES ($1, $2, 17, 3)",
        "ZZ-TEST-D1-doc", "ZZ-TEST-D1 documento")
    global_antes = await conn.fetchrow(
        "SELECT warning_days, error_days FROM app.alert_thresholds WHERE doc_type = $1", GLOBAL_ALERT_THRESHOLD)
    assert global_antes is not None

    sql = MIGRACION.read_text()
    await conn.execute(sql)

    quedan = [r["doc_type"] for r in await conn.fetch("SELECT doc_type FROM app.alert_thresholds")]
    assert quedan == [GLOBAL_ALERT_THRESHOLD]
    assert await conn.fetchrow(
        "SELECT warning_days, error_days FROM app.alert_thresholds WHERE doc_type = $1",
        GLOBAL_ALERT_THRESHOLD) == global_antes
    copia = await conn.fetchrow(
        """SELECT entity_id, action, source, old_value FROM public.audit_log
           WHERE entity_type = 'ALERT_THRESHOLD' AND doc_code = $1""", "ZZ-TEST-D1-doc")
    assert copia is not None
    assert copia["action"] == "delete" and copia["source"] == "migration"
    assert copia["entity_id"] == await conn.fetchval(
        "SELECT md5('app.alert_thresholds:' || $1::text)::uuid", "ZZ-TEST-D1-doc")
    viejo = json.loads(copia["old_value"]) if isinstance(copia["old_value"], str) else copia["old_value"]
    assert (viejo["warning_days"], viejo["error_days"], viejo["label"]) == (17, 3, "ZZ-TEST-D1 documento")

    # Re-ejecutable: la segunda corrida no borra nada ni duplica la copia.
    copias = await conn.fetchval("SELECT count(*) FROM public.audit_log WHERE entity_type = 'ALERT_THRESHOLD'")
    await conn.execute(sql)
    assert await conn.fetchval(
        "SELECT count(*) FROM public.audit_log WHERE entity_type = 'ALERT_THRESHOLD'") == copias
    assert [r["doc_type"] for r in await conn.fetch("SELECT doc_type FROM app.alert_thresholds")] \
        == [GLOBAL_ALERT_THRESHOLD]
