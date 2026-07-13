"""Test de integración E2E de `routers/centralizer_uploads.py` (Task 4,
`.superpowers/sdd/task-4-brief.md`) contra Supabase real — no mockeado.

Objetivo (los 2 pasos que pide el brief, hechos en una sola pasada
compartiendo el mismo estado para no re-subir de más):

1. **Idempotencia**: subir `tests/fixtures/centralizer_sample.xlsx` →
   aprobar → aplicar → confirmar conteos. Subir el MISMO archivo de nuevo
   (upload nuevo, fila nueva en `centralizer_uploads`) → aprobar → aplicar →
   confirmar `change_type='unchanged'` para las entidades ya existentes, sin
   duplicados y sin tocar `manually_edited_fields`/`manual_override`.
2. **Conflicto real**: editar a mano (vía `PATCH /transporters/{tid}`, que
   marca `manually_edited_fields`) el `business_name` de uno de los
   transporters creados en el paso 1, a un valor distinto del que trae el
   fixture. Subir el fixture (sin modificar) una tercera vez → el diff debe
   marcar ese transporter `conflict` (`conflict_reason='manually_edited_field'`)
   y `apply` NO debe pisar el valor editado a mano.

Nota de diseño sobre el paso 2: el brief sugiere construir un segundo xlsx
sintético con un valor de campo distinto (`openpyxl`) o tocar un campo que el
fixture no toca. Ninguno de los dos hizo falta: el único campo nativo que
`compute_diff` compara para transporters es `business_name`
(`_TRANSPORTER_NATIVE_FIELDS` en `centralizer_diff.py`), así que basta con
editar ese campo a mano a un valor distinto del que ya trae el fixture y
re-subir el fixture ORIGINAL sin tocar — el propio valor de `business_name`
del Excel pasa a diferir del valor editado a mano, que es exactamente lo que
dispara `conflict`. Evita generar (y volver a verificar la inocuidad de) un
segundo archivo con RUTs propios.

## Convención de gating (leída antes de escribir este archivo)

No existe en este proyecto un patrón previo de tests que abran una conexión
real a Supabase dentro de `pytest tests/` — grep de
`pytest.mark.integration`/env-var gates/`conftest.py` específico para esto
no encontró nada, y no hay marcadores custom registrados en
`pyproject.toml` (sólo `asyncio_mode = "auto"`). La práctica establecida
hasta ahora (Task 3, ver `task-3-report.md` §"Verificación contra Supabase
real") fue correr la verificación a mano, una vez, documentada en el reporte
del task — no un test que se ejecuta en cada corrida de CI.

Esta prueba queda en un punto intermedio deliberado: se escribe como test
automatizado real (no un script suelto) porque el brief pide commitear un
archivo de test para este flujo — pero gateada detrás de
`RUN_LIVE_SUPABASE_TESTS=1`. Sin esa variable de entorno, se SKIPPEA (no
corre en `pytest tests/ -v` por defecto, cero riesgo de pegarle a Supabase
sin querer). Requiere el mismo `.env` que usa la app
(`DATABASE_URL`/`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`).

Para correrla explícitamente:

    RUN_LIVE_SUPABASE_TESTS=1 pytest tests/test_centralizer_uploads_e2e.py -v -s

Usa `tests/fixtures/centralizer_sample.xlsx` (RUTs `99999xxx` ficticios,
patentes `PRUE11`/`PRUE12`/`PRUE21`, confirmados sin colisión con datos
reales en Task 1). Revierte todo lo que crea (transporters/drivers/vehicles/
documentos vía cascada + filas de `centralizer_uploads` + el archivo subido
a Storage) en un bloque `finally`, y re-verifica 0 filas al final. Si el
pre-check inicial encuentra filas ya existentes para estos RUTs/patentes,
la prueba aborta con `pytest.fail` SIN escribir ni borrar nada (estado
inesperado — no asume que sea seguro limpiar algo que no creó ella misma).

Llama a las funciones de los endpoints directamente (`await
upload_and_preview(...)`, etc.) en vez de pasar por `TestClient` +
HTTP: `TestClient` corre la app dentro de su propio portal/loop de
`anyio` en un thread aparte, y un `asyncpg.Pool` creado en el loop de este
test (vía `app.db.init_pool`, dentro de una función `async def` de
pytest-asyncio) quedaría atado a un loop distinto al que usaría `TestClient`
para ejecutar los handlers — asyncpg falla duro con futures atados a otro
loop en ese escenario. Llamar las funciones `async def` de los routers
directamente (mismo patrón ya usado en la verificación manual de Task 3)
evita el problema por completo: todo corre en el único loop del test.
"""
from __future__ import annotations

import os
import uuid
from io import BytesIO

import pytest
from fastapi import UploadFile
from starlette.datastructures import Headers

from app.config import get_settings
from app.db import close_pool, init_pool
from app.routers.centralizer_uploads import apply_upload, approve_upload, upload_and_preview
from app.routers.transporters import patch_transporter
from app.schemas.transporter_relational import TransporterPatchBody
from app.utils.document_storage import COMPLIANCE_BUCKET
from supabase import create_client

pytestmark = pytest.mark.skipif(
    not os.getenv("RUN_LIVE_SUPABASE_TESTS"),
    reason=(
        "Test de integración contra Supabase real — opt-in con "
        "RUN_LIVE_SUPABASE_TESTS=1 (ver docstring del módulo)"
    ),
)

FIXTURE_PATH = "tests/fixtures/centralizer_sample.xlsx"
TRANSPORTER_RUTS = ["99999001", "99999002"]
DRIVER_RUTS = ["99999101", "99999102", "99999103"]
VEHICLE_PLATES = ["PRUE11", "PRUE12", "PRUE21"]

FAKE_ADMIN = {"sub": str(uuid.uuid4()), "email": "task4-live-test@webcarga.cl", "role": "admin"}


def _fixture_bytes() -> bytes:
    with open(FIXTURE_PATH, "rb") as f:
        return f.read()


async def _upload_approve_apply(pool, supabase, data: bytes, upload_ids: list[str], storage_paths: list[str]) -> dict:
    """POST (preview) + approve + apply de un archivo, llamando los
    endpoints directamente. Retorna upload_id, el diff del preview y la
    respuesta de apply.

    Registra upload_id/storage_path en las listas de cleanup INMEDIATAMENTE
    tras el preview (antes de approve/apply) — si approve o apply lanzan una
    excepción, la fila de centralizer_uploads y el archivo de Storage ya
    creados por el preview igual quedan trackeados para el cleanup del
    `finally`, en vez de perderse por no haber llegado al `return`."""
    upload_file = UploadFile(
        file=BytesIO(data),
        filename="centralizer_sample.xlsx",
        headers=Headers({
            "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
    )
    preview = await upload_and_preview(file=upload_file, pool=pool, supabase=supabase, user=FAKE_ADMIN)
    upload_id = preview["upload_id"]
    upload_ids.append(upload_id)
    storage_paths.append(
        await pool.fetchval(
            "SELECT storage_path FROM app.centralizer_uploads WHERE id = $1", upload_id,
        )
    )

    approved = await approve_upload(upload_id, pool=pool, user=FAKE_ADMIN)
    assert approved["status"] == "approved"

    applied = await apply_upload(upload_id, pool=pool, supabase=supabase, user=FAKE_ADMIN)
    assert applied["status"] == "applied"

    return {"upload_id": upload_id, "preview": preview, "applied": applied}


async def _fetch_counts(pool):
    transporters = await pool.fetch(
        "SELECT id, rut, business_name, manually_edited_fields FROM app.transporters "
        "WHERE rut = ANY($1::text[]) ORDER BY rut",
        TRANSPORTER_RUTS,
    )
    drivers = await pool.fetch(
        "SELECT id, rut FROM app.drivers WHERE rut = ANY($1::text[])", DRIVER_RUTS,
    )
    vehicles = await pool.fetch(
        "SELECT id, plate FROM app.vehicles WHERE plate = ANY($1::text[])", VEHICLE_PLATES,
    )
    return transporters, drivers, vehicles


@pytest.mark.asyncio
async def test_idempotent_reupload_and_real_conflict_against_live_supabase():
    settings = get_settings()
    pool = await init_pool(settings.database_url)
    supabase = create_client(settings.supabase_url, settings.supabase_service_role_key)

    # ── Pre-check obligatorio: abortar sin tocar nada si ya hay datos ──────
    pre_t, pre_d, pre_v = await _fetch_counts(pool)
    if pre_t or pre_d or pre_v:
        await close_pool()
        pytest.fail(
            "Estado sucio antes de empezar: ya existen filas para los RUTs/patentes "
            "sintéticos del fixture. Abortando sin escribir ni borrar nada — "
            "investigar manualmente antes de re-correr este test."
        )

    upload_ids: list[str] = []
    storage_paths: list[str] = []

    try:
        data = _fixture_bytes()

        # ── Paso 1: primer upload — base vacía, todo 'new' ─────────────────
        cycle1 = await _upload_approve_apply(pool, supabase, data, upload_ids, storage_paths)

        diff1 = cycle1["preview"]["diff"]
        assert cycle1["preview"]["parse_errors"] == []
        assert len(diff1["transporters"]) == 2
        assert len(diff1["drivers"]) == 3
        assert len(diff1["vehicles"]) == 3
        assert all(d["change_type"] == "new" for d in diff1["transporters"])
        assert all(d["change_type"] == "new" for d in diff1["drivers"])
        assert all(d["change_type"] == "new" for d in diff1["vehicles"])
        assert cycle1["applied"]["matched_transporters"] == 2

        t_rows, d_rows, v_rows = await _fetch_counts(pool)
        assert len(t_rows) == 2
        assert len(d_rows) == 3
        assert len(v_rows) == 3
        assert all((r["manually_edited_fields"] or []) == [] for r in t_rows)

        transporter_ids = [r["id"] for r in t_rows]
        doc_rows = await pool.fetch(
            "SELECT manual_override FROM app.transporter_documents WHERE transporter_id = ANY($1::uuid[])",
            transporter_ids,
        )
        assert len(doc_rows) > 0
        assert {r["manual_override"] for r in doc_rows} == {False}

        # ── Paso 2 (Step 1 del brief): re-subir EL MISMO archivo ──────────
        cycle2 = await _upload_approve_apply(pool, supabase, data, upload_ids, storage_paths)

        diff2 = cycle2["preview"]["diff"]
        assert all(d["change_type"] == "unchanged" for d in diff2["transporters"]), diff2["transporters"]
        assert all(d["change_type"] == "unchanged" for d in diff2["drivers"]), diff2["drivers"]
        assert all(d["change_type"] == "unchanged" for d in diff2["vehicles"]), diff2["vehicles"]
        assert cycle2["applied"]["matched_transporters"] == 2

        t_rows2, d_rows2, v_rows2 = await _fetch_counts(pool)
        assert len(t_rows2) == 2, "el segundo apply no debe crear transporters duplicados"
        assert len(d_rows2) == 3, "el segundo apply no debe crear drivers duplicados"
        assert len(v_rows2) == 3, "el segundo apply no debe crear vehicles duplicados"
        assert {r["id"] for r in t_rows2} == {r["id"] for r in t_rows}, "mismos ids, no filas nuevas"
        assert all((r["manually_edited_fields"] or []) == [] for r in t_rows2)

        doc_rows2 = await pool.fetch(
            "SELECT manual_override FROM app.transporter_documents WHERE transporter_id = ANY($1::uuid[])",
            [r["id"] for r in t_rows2],
        )
        assert len(doc_rows2) == len(doc_rows), "no se duplicaron filas de documentos"
        assert {r["manual_override"] for r in doc_rows2} == {False}

        # ── Paso 3 (Step 2 del brief): edición manual real + re-upload ────
        target = next(r for r in t_rows2 if r["rut"] == "99999001")
        target_id = str(target["id"])
        fixture_business_name = target["business_name"]

        patched = await patch_transporter(
            target_id,
            TransporterPatchBody(business_name="Transportes Editado A Mano SPA"),
            pool=pool,
            user=FAKE_ADMIN,
        )
        edited_business_name = patched["business_name"]
        assert "business_name" in patched["manually_edited_fields"]
        assert edited_business_name != fixture_business_name

        cycle3 = await _upload_approve_apply(pool, supabase, data, upload_ids, storage_paths)

        diff3 = cycle3["preview"]["diff"]
        target_diff = next(d for d in diff3["transporters"] if d["entity_key"] == "99999001")
        other_diff = next(d for d in diff3["transporters"] if d["entity_key"] == "99999002")

        assert target_diff["change_type"] == "conflict"
        assert target_diff["conflict_reason"] == "manually_edited_field"
        assert any(
            fd["field"] == "business_name" and fd["conflict"] is True
            for fd in target_diff["field_diffs"]
        )
        assert other_diff["change_type"] == "unchanged"

        # matched (visto en el upload) pero SIN pisar el valor editado a mano
        assert cycle3["applied"]["matched_transporters"] == 2

        after = await pool.fetchrow(
            "SELECT business_name, manually_edited_fields FROM app.transporters WHERE id = $1", target_id,
        )
        assert after["business_name"] == edited_business_name, (
            "apply no debe pisar un campo con manually_edited_fields — "
            f"esperado '{edited_business_name}', quedó '{after['business_name']}'"
        )
        assert "business_name" in (after["manually_edited_fields"] or [])

    finally:
        # ── Revertir todo lo creado por esta prueba ─────────────────────
        if storage_paths:
            try:
                supabase.storage.from_(COMPLIANCE_BUCKET).remove([p for p in storage_paths if p])
            except Exception:
                pass  # best-effort — no debe tapar un fallo de aserción previo

        # app.audit_log.entity_id no tiene FK (no cascade automático) — se
        # limpia acotado a los ids concretos que esta prueba pudo haber
        # creado (transporters/drivers/vehicles del fixture), nunca por
        # `source` a secas: eso borraría auditoría legítima de otros
        # uploads reales si algún día existiera alguna con ese source.
        _, cleanup_d_rows, cleanup_v_rows = await _fetch_counts(pool)
        entity_ids_to_purge = (
            [r["id"] for r in cleanup_d_rows] + [r["id"] for r in cleanup_v_rows]
        )
        if entity_ids_to_purge:
            await pool.execute(
                "DELETE FROM app.audit_log WHERE entity_id = ANY($1::uuid[])", entity_ids_to_purge,
            )
        await pool.execute("DELETE FROM app.drivers WHERE rut = ANY($1::text[])", DRIVER_RUTS)
        await pool.execute("DELETE FROM app.vehicles WHERE plate = ANY($1::text[])", VEHICLE_PLATES)
        await pool.execute("DELETE FROM app.transporters WHERE rut = ANY($1::text[])", TRANSPORTER_RUTS)
        if upload_ids:
            await pool.execute(
                "DELETE FROM app.centralizer_uploads WHERE id = ANY($1::uuid[])", upload_ids,
            )

        post_t, post_d, post_v = await _fetch_counts(pool)
        remaining_uploads = await pool.fetch(
            "SELECT id FROM app.centralizer_uploads WHERE id = ANY($1::uuid[])", upload_ids,
        ) if upload_ids else []

        await close_pool()

        assert post_t == [], "cleanup incompleto: quedaron transporters del fixture"
        assert post_d == [], "cleanup incompleto: quedaron drivers del fixture"
        assert post_v == [], "cleanup incompleto: quedaron vehicles del fixture"
        assert remaining_uploads == [], "cleanup incompleto: quedaron filas de centralizer_uploads"
