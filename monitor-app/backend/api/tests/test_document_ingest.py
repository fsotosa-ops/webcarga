"""Bandeja de documentos sin clasificar (HU-01).

El archivo entra sin declarar a qué requisito pertenece y espera en staging
hasta que una persona lo clasifica. La invariante que estos tests protegen:
NADA toca public.compliance_records hasta la clasificación explícita.
"""
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user, get_supabase, require_editor
from app.db import get_pool
from app.routers.document_ingest import router
from tests.conftest import USER, wire_transactional_conn


def make_client(pool, supabase=None):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_editor] = lambda: USER
    app.dependency_overrides[get_supabase] = lambda: supabase or MagicMock()
    return TestClient(app)


def _storage_ok():
    supabase = MagicMock()
    supabase.storage.from_.return_value.upload.return_value = None
    return supabase


# ── Subida a la bandeja ────────────────────────────────────────────────────

def test_upload_lands_files_in_tray_without_touching_compliance():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.return_value = "batch-1"
    conn.fetchrow.return_value = {
        "id": "item-1", "file_name": "IMG_4905.PNG", "mime_type": "image/png",
        "size_bytes": 9, "storage_path": "staging/batch-1/x_IMG_4905.PNG",
        "match_status": "UNMATCHED",
    }
    client = make_client(pool, supabase=_storage_ok())

    res = client.post(
        "/api/v1/document-ingest/c1/files",
        files=[("files", ("IMG_4905.PNG", b"contenido", "image/png"))],
    )

    assert res.status_code == 201
    body = res.json()
    assert body["batch_id"] == "batch-1"
    assert body["items"][0]["match_status"] == "UNMATCHED"
    # La invariante: el archivo entra sin tocar el motor de cumplimiento.
    all_sql = " ".join(str(c.args[0]) for c in conn.execute.call_args_list)
    assert "compliance_records" not in all_sql


def test_upload_without_carrier_lands_in_the_global_tray():
    """La tanda mezclada que llega por correo no tiene una empresa todavía.

    Obligar a elegir una antes de poder soltar los archivos es justo lo que
    impide cargar los 2.000 pendientes: quien carga no sabe de quién es nada.
    """
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.return_value = "batch-global"
    conn.fetchrow.return_value = {
        "id": "item-1", "file_name": "doc1.pdf", "mime_type": "application/pdf",
        "size_bytes": 12, "storage_path": "staging/batch-global/x_doc1.pdf",
        "match_status": "UNMATCHED",
    }
    client = make_client(pool, supabase=_storage_ok())

    res = client.post(
        "/api/v1/document-ingest/files",
        files=[("files", ("doc1.pdf", b"contenido", "application/pdf"))],
    )

    assert res.status_code == 201
    assert res.json()["batch_id"] == "batch-global"
    assert len(res.json()["items"]) == 1

    # El lote se crea con carrier_id NULL: el archivo entra sin dueño.
    insert = next(c for c in conn.fetchval.await_args_list
                  if "document_ingest_batches" in c.args[0])
    assert insert.args[1] is None


def test_global_upload_respects_the_file_limit():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    client = make_client(pool, supabase=_storage_ok())

    res = client.post(
        "/api/v1/document-ingest/files",
        files=[("files", (f"d{i}.pdf", b"x", "application/pdf")) for i in range(51)],
    )

    assert res.status_code == 422
    assert "50" in res.json()["detail"]


def test_upload_rejects_invalid_mime_without_dropping_the_rest():
    """Exito parcial: un archivo invalido no tumba el resto del lote."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.return_value = "batch-1"
    conn.fetchrow.return_value = {
        "id": "item-1", "file_name": "ok.pdf", "mime_type": "application/pdf",
        "size_bytes": 9, "storage_path": "staging/batch-1/x_ok.pdf",
        "match_status": "UNMATCHED",
    }
    client = make_client(pool, supabase=_storage_ok())

    res = client.post(
        "/api/v1/document-ingest/c1/files",
        files=[
            ("files", ("virus.exe", b"MZ", "application/x-msdownload")),
            ("files", ("ok.pdf", b"contenido", "application/pdf")),
        ],
    )

    assert res.status_code == 201
    body = res.json()
    assert len(body["items"]) == 1
    assert len(body["errors"]) == 1
    assert body["errors"][0]["file_name"] == "virus.exe"


def test_upload_requires_at_least_one_file():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.post("/api/v1/document-ingest/c1/files", files=[])

    assert res.status_code == 422


# ── Bandeja: la cola global ────────────────────────────────────────────────

def _queue_row(item_id="i1", carrier_name="ACME S.A.", **over):
    row = {
        "id": item_id, "file_name": f"{item_id}.png", "mime_type": "image/png",
        "size_bytes": 10, "storage_path": f"staging/b1/{item_id}.png",
        "match_status": "UNMATCHED", "created_at": datetime(2026, 8, 14, tzinfo=timezone.utc),
        "carrier_id": "c1", "carrier_name": carrier_name,
        "confidence": None, "suggested_requirement_name": None, "candidate_count": 0,
    }
    row.update(over)
    return row


def test_list_queue_returns_total_and_carrier():
    """La cola global agrupa por empresa, asi que cada fila trae la suya."""
    pool = AsyncMock()
    pool.fetchval.return_value = 2
    pool.fetch.return_value = [_queue_row()]
    client = make_client(pool)

    res = client.get("/api/v1/document-ingest/items")

    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 2
    assert body["rows"][0]["carrier_name"] == "ACME S.A."


def test_list_queue_does_not_sign_urls():
    """Firmar en el listado es una llamada HTTP por archivo: con 2.000 no termina."""
    pool = AsyncMock()
    pool.fetchval.return_value = 1
    pool.fetch.return_value = [_queue_row()]
    supabase = MagicMock()
    client = make_client(pool, supabase=supabase)

    res = client.get("/api/v1/document-ingest/items")

    assert res.status_code == 200
    supabase.storage.from_.assert_not_called()


def test_list_queue_filters_by_carrier():
    pool = AsyncMock()
    pool.fetchval.return_value = 0
    pool.fetch.return_value = []
    client = make_client(pool)

    client.get("/api/v1/document-ingest/items?carrier_id=c1")

    assert "c1" in pool.fetch.call_args.args


def test_list_queue_without_carrier_passes_none():
    """Sin empresa el filtro viaja como NULL, no como cadena vacia."""
    pool = AsyncMock()
    pool.fetchval.return_value = 0
    pool.fetch.return_value = []
    client = make_client(pool)

    client.get("/api/v1/document-ingest/items")

    assert pool.fetch.call_args.args[1] is None


def test_queue_shows_files_that_already_have_a_suggestion():
    """AUTO, SUGGESTED y AMBIGUOUS son trabajo pendiente, no trabajo hecho.

    Filtrar solo UNMATCHED los dejaba sin ninguna superficie que los muestre:
    el clasificador los resuelve, la bandeja los esconde y nadie los confirma.
    """
    pool = AsyncMock()
    pool.fetchval.return_value = 4
    pool.fetch.return_value = []
    client = make_client(pool)

    res = client.get("/api/v1/document-ingest/items")

    assert res.status_code == 200
    sql = pool.fetch.await_args.args[0]
    assert "COMMITTED" in sql and "DISCARDED" in sql
    assert "match_status = 'UNMATCHED'" not in sql


def test_queue_binds_exactly_the_parameters_it_references():
    """Guarda contra el bug recurrente: sustituir $n a mano no prueba el binding.

    Si el SQL referencia $3 pero se pasan 2 argumentos, Postgres tira
    IndeterminateDatatypeError en vivo y ningun AsyncMock lo detecta.
    """
    import re
    pool = AsyncMock()
    pool.fetchval.return_value = 0
    pool.fetch.return_value = []
    client = make_client(pool)

    client.get("/api/v1/document-ingest/items?carrier_id=c1&limit=10&offset=5")

    for call in (pool.fetch.await_args, pool.fetchval.await_args):
        sql, args = call.args[0], call.args[1:]
        referenciados = {int(n) for n in re.findall(r"\$(\d+)", sql)}
        assert referenciados == set(range(1, len(args) + 1)), (
            f"SQL referencia {sorted(referenciados)} pero recibe {len(args)} argumentos"
        )


def test_preview_url_is_signed_one_at_a_time():
    pool = AsyncMock()
    pool.fetchval.return_value = "staging/b1/foto.png"
    supabase = MagicMock()
    supabase.storage.from_.return_value.create_signed_url.return_value = {"signedURL": "https://x/y"}
    client = make_client(pool, supabase=supabase)

    res = client.get("/api/v1/document-ingest/items/i1/preview-url")

    assert res.status_code == 200
    assert res.json()["preview_url"] == "https://x/y"


def test_preview_url_404_when_missing():
    pool = AsyncMock()
    pool.fetchval.return_value = None
    client = make_client(pool)

    res = client.get("/api/v1/document-ingest/items/nope/preview-url")

    assert res.status_code == 404


# ── Bandeja: clasificar ────────────────────────────────────────────────────

def _item_row(match_status="UNMATCHED"):
    return {
        "storage_path": "staging/b1/x.png", "file_name": "IMG_4905.PNG",
        "mime_type": "image/png", "size_bytes": 9, "match_status": match_status,
    }


def _record_row(record_id="rec-1"):
    return {
        "id": record_id, "entity_id": "a1", "entity_type": "ASSET",
        "status": "MISSING", "expiration_date": None,
    }


def test_classify_applies_the_file_to_the_requirement():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    # 3er fetchrow: lo que lee _apply_stored_document para detectar si el
    # requisito ya tenia archivo (sin archivo previo en este caso).
    conn.fetchrow.side_effect = [_item_row(), _record_row(), {"metadata": {}, "expiration_date": None}]
    client = make_client(pool)

    res = client.post(
        "/api/v1/document-ingest/items/item-1/classify",
        json={"entity_type": "ASSET", "entity_id": "a1",
              "requirement_id": "req-1", "expiration_date": "2027-03-31"},
    )

    assert res.status_code == 200
    assert res.json()["compliance_record_id"] == "rec-1"
    all_sql = " ".join(str(c.args[0]) for c in conn.execute.call_args_list)
    assert "compliance_records" in all_sql
    assert "COMMITTED" in all_sql


def test_same_file_can_cover_several_requirements():
    """Caso real del PDF unificado: padron + permiso + revision en un archivo.

    Pablo lo mostro en pantalla: 'puedo pedir que lo desunifiquen, o cargar
    tres veces el mismo archivo'. Se resuelve sin duplicar el blob.
    """
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    # El item YA fue clasificado antes (COMMITTED), no UNMATCHED
    conn.fetchrow.side_effect = [
        _item_row("COMMITTED"), _record_row("rec-2"), {"metadata": {}, "expiration_date": None},
    ]
    conn.fetchval.return_value = False   # el requisito no exige vencimiento
    client = make_client(pool)

    res = client.post(
        "/api/v1/document-ingest/items/item-1/classify",
        json={"entity_type": "ASSET", "entity_id": "a1", "requirement_id": "req-2"},
    )

    assert res.status_code == 200
    assert res.json()["compliance_record_id"] == "rec-2"


def test_classify_409_when_item_was_discarded():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = _item_row("DISCARDED")
    client = make_client(pool)

    res = client.post(
        "/api/v1/document-ingest/items/item-1/classify",
        json={"entity_type": "ASSET", "entity_id": "a1", "requirement_id": "req-1"},
    )

    assert res.status_code == 409


def test_classify_404_when_item_missing():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = None
    client = make_client(pool)

    res = client.post(
        "/api/v1/document-ingest/items/nope/classify",
        json={"entity_type": "ASSET", "entity_id": "a1", "requirement_id": "req-1"},
    )

    assert res.status_code == 404


def test_classify_404_when_entity_lacks_that_requirement():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.side_effect = [_item_row(), None]
    client = make_client(pool)

    res = client.post(
        "/api/v1/document-ingest/items/item-1/classify",
        json={"entity_type": "ASSET", "entity_id": "a1", "requirement_id": "req-inexistente"},
    )

    assert res.status_code == 404


def test_classify_422_when_requirement_needs_expiration_and_none_given():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.side_effect = [_item_row(), _record_row()]
    conn.fetchval.return_value = True   # has_expiration
    client = make_client(pool)

    res = client.post(
        "/api/v1/document-ingest/items/item-1/classify",
        json={"entity_type": "ASSET", "entity_id": "a1", "requirement_id": "req-1"},
    )

    assert res.status_code == 422


# ── Bandeja: eliminar ──────────────────────────────────────────────────────

def test_delete_item_marks_discarded_and_removes_the_blob():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"storage_path": "staging/b1/x.png"}
    supabase = MagicMock()
    client = make_client(pool, supabase=supabase)

    res = client.delete("/api/v1/document-ingest/items/item-1")

    assert res.status_code == 204
    assert "DISCARDED" in conn.execute.call_args.args[0]
    supabase.storage.from_.return_value.remove.assert_called_once_with(["staging/b1/x.png"])


def test_delete_item_404_when_missing():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = None
    client = make_client(pool)

    res = client.delete("/api/v1/document-ingest/items/nope")

    assert res.status_code == 404


# ── Operaciones en lote ────────────────────────────────────────────────────
# Son las que hacen viable clasificar 2.000 documentos: el mismo requisito
# aplicado a N archivos, y N archivos movidos de empresa en un solo statement.

def test_classify_batch_applies_to_every_selected_item():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetch.return_value = [
        {"id": "i1", "storage_path": "s/1.png", "file_name": "1.png",
         "mime_type": "image/png", "size_bytes": 9, "match_status": "UNMATCHED"},
        {"id": "i2", "storage_path": "s/2.png", "file_name": "2.png",
         "mime_type": "image/png", "size_bytes": 9, "match_status": "UNMATCHED"},
    ]
    conn.fetchrow.side_effect = [
        _record_row(),
        {"metadata": {}, "expiration_date": None},
        {"metadata": {}, "expiration_date": None},
    ]
    conn.fetchval.return_value = False
    client = make_client(pool)

    res = client.post(
        "/api/v1/document-ingest/items/classify-batch",
        json={"item_ids": ["i1", "i2"], "entity_type": "ASSET",
              "entity_id": "a1", "requirement_id": "req-1"},
    )

    assert res.status_code == 200
    assert res.json()["applied"] == ["i1", "i2"]


def test_classify_batch_rejects_an_empty_selection():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.post(
        "/api/v1/document-ingest/items/classify-batch",
        json={"item_ids": [], "entity_type": "ASSET",
              "entity_id": "a1", "requirement_id": "req-1"},
    )

    assert res.status_code == 422


def test_classify_batch_404_when_the_entity_lacks_that_requirement():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetch.return_value = [
        {"id": "i1", "storage_path": "s/1.png", "file_name": "1.png",
         "mime_type": "image/png", "size_bytes": 9, "match_status": "UNMATCHED"},
    ]
    conn.fetchrow.return_value = None
    client = make_client(pool)

    res = client.post(
        "/api/v1/document-ingest/items/classify-batch",
        json={"item_ids": ["i1"], "entity_type": "ASSET",
              "entity_id": "a1", "requirement_id": "no-existe"},
    )

    assert res.status_code == 404


def test_move_items_reassigns_the_carrier_in_one_statement():
    """Un solo UPDATE: mover 40 archivos en bucle serian 40 statements."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.execute.return_value = "UPDATE 3"
    client = make_client(pool)

    res = client.post(
        "/api/v1/document-ingest/items/move",
        json={"item_ids": ["i1", "i2", "i3"], "carrier_id": "c2"},
    )

    assert res.status_code == 200
    assert res.json()["moved"] == 3
    assert conn.execute.call_count == 1
    assert "carrier_id" in conn.execute.call_args.args[0]


def test_move_items_rejects_an_empty_selection():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.post("/api/v1/document-ingest/items/move",
                      json={"item_ids": [], "carrier_id": "c2"})

    assert res.status_code == 422


# ── Deshacer en lote ───────────────────────────────────────────────────────

def _committed_item(item_id="item-1", record_id="rec-1"):
    return {
        "id": item_id, "compliance_record_id": record_id,
        "match_status": "COMMITTED", "metadata": {},
    }


def test_undo_returns_the_files_to_the_tray_and_empties_the_requirement():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetch.return_value = [_committed_item()]
    client = make_client(pool)

    res = client.post(
        "/api/v1/document-ingest/items/undo-classify",
        json={"item_ids": ["item-1"]},
    )

    assert res.status_code == 200
    assert res.json()["reverted"] == ["item-1"]

    sql_ejecutado = " ".join(str(c.args[0]) for c in conn.execute.await_args_list)
    # El requisito vuelve a estar vacío...
    assert "compliance_records" in sql_ejecutado
    assert "'MISSING'" in sql_ejecutado
    # ...y el archivo vuelve a la bandeja, no se pierde.
    assert "'UNMATCHED'" in sql_ejecutado


def test_undo_refuses_when_the_requirement_had_a_previous_document():
    """Sin historial de versiones no se puede restaurar lo que se piso.

    Devolverlo como error es honesto; revertir a MISSING borraria un documento
    que era valido antes de la operacion.
    """
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetch.return_value = [{
        "id": "item-1", "compliance_record_id": "rec-1", "match_status": "COMMITTED",
        "metadata": {"replaced_storage_path": "docs/rec-1/anterior.pdf"},
    }]
    client = make_client(pool)

    res = client.post(
        "/api/v1/document-ingest/items/undo-classify",
        json={"item_ids": ["item-1"]},
    )

    assert res.status_code == 200
    assert res.json()["reverted"] == []
    assert "documento anterior" in res.json()["errors"][0]["error"]


def test_undo_rejects_an_empty_selection():
    pool = AsyncMock()
    client = make_client(pool)
    res = client.post("/api/v1/document-ingest/items/undo-classify", json={"item_ids": []})
    assert res.status_code == 422
