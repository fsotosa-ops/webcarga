"""Bandeja de documentos sin clasificar (HU-01).

El archivo entra sin declarar a qué requisito pertenece y espera en staging
hasta que una persona lo clasifica. La invariante que estos tests protegen:
NADA toca public.compliance_records hasta la clasificación explícita.
"""
import json
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


# ── El cableado del clasificador ───────────────────────────────────────────

def _pool_de_ingesta():
    """Mismo armado que el resto del archivo: transaccion cableada, un
    batch_id fijo y un fetchrow que ya trae las columnas de destino."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.return_value = "batch-1"
    conn.fetchrow.return_value = {
        "id": "item-1", "file_name": "x.pdf", "mime_type": "application/pdf",
        "size_bytes": 9, "storage_path": "staging/batch-1/x.pdf",
        "match_status": "UNMATCHED",
    }
    return pool, conn


def test_un_archivo_entra_con_su_destino_propuesto(monkeypatch):
    """El cable que faltaba. Antes, `document_ingest.py:70` escribia el literal
    'UNMATCHED' en cada archivo, asi que las seis columnas de destino —que
    EXISTEN desde que se creo la tabla— quedaban en cero para siempre."""
    from app.services.document_matcher import MatchCandidate

    monkeypatch.setattr("app.routers.document_ingest.match_document",
                        lambda **kw: [MatchCandidate(
                            entity_type="DRIVER", entity_id="d1", requirement_id="req-1",
                            confidence=0.95,
                            evidence={"entity": {"via": "RUT", "score": 0.95, "raw": "1-9"}},
                        )])
    pool, conn = _pool_de_ingesta()
    client = make_client(pool)

    client.post("/api/v1/document-ingest/files",
                files={"files": ("12345678-9_licencia.pdf", b"%PDF-1.4", "application/pdf")})

    insert = next(c for c in conn.fetchrow.call_args_list
                  if "document_ingest_items" in c.args[0])
    sql, args = insert.args[0], insert.args[1:]
    assert "entity_id" in sql and "confidence" in sql and "match_evidence" in sql
    assert "'UNMATCHED'" not in sql, (
        "el literal sigue ahi: la fila nace sin clasificar aunque el motor haya respondido"
    )
    assert "AUTO" in args


def test_ingest_insert_binds_exactly_the_parameters_it_references():
    """Mismo guardia que `test_queue_binds_exactly_the_parameters_it_references`,
    sobre el otro SQL de este router que tocó esta ronda: el INSERT de
    `document_ingest_items` pasó de 12 a 13 columnas al sumar `content_sha256`.
    Un `$n` desalineado no falla al desplegar — escribe un valor en la columna
    equivocada, en silencio."""
    import re

    pool, conn = _pool_de_ingesta()
    client = make_client(pool)

    client.post("/api/v1/document-ingest/files",
                files={"files": ("x.pdf", b"%PDF-1.4", "application/pdf")})

    insert = next(c for c in conn.fetchrow.call_args_list
                  if "document_ingest_items" in c.args[0])
    sql, args = insert.args[0], insert.args[1:]
    referenciados = {int(n) for n in re.findall(r"\$(\d+)", sql)}
    assert referenciados == set(range(1, len(args) + 1)), (
        f"el INSERT referencia {sorted(referenciados)} pero recibe {len(args)} argumentos"
    )


def test_si_el_motor_falla_el_archivo_igual_entra(monkeypatch):
    """EL ARCHIVO YA ESTA EN STORAGE cuando se clasifica. Si el motor
    explotara y dejaramos propagar, el blob quedaria huerfano y el operador
    veria un error sobre un archivo que si se subio.

    Degradar a UNMATCHED es exactamente el comportamiento de antes del cambio:
    en el peor caso, esta ronda no cambia nada.

    El motivo del fallo no se pierde: no hay logging en toda `app/` (a
    proposito, no se agrega acá), asi que el rastro va a la columna `error`
    que la tabla ya tenia y nadie escribia — sin el nombre del archivo, que
    es PII."""
    def explota(**kw):
        raise ValueError("catalogo corrupto")

    monkeypatch.setattr("app.routers.document_ingest.match_document", explota)
    pool, conn = _pool_de_ingesta()
    client = make_client(pool)

    res = client.post("/api/v1/document-ingest/files",
                      files={"files": ("x.pdf", b"%PDF-1.4", "application/pdf")})

    assert res.status_code == 201
    insert = next(c for c in conn.fetchrow.call_args_list
                  if "document_ingest_items" in c.args[0])
    args = insert.args[1:]
    assert "UNMATCHED" in args
    # `error` es el penúltimo argumento: el último es `content_sha256`, que se
    # calcula igual haya fallado el motor o no —el archivo ya está en storage.
    assert args[-2] == "ValueError: catalogo corrupto", (
        "el motivo del fallo (tipo + mensaje, sin nombre de archivo) tiene "
        "que quedar en la columna `error`"
    )


def test_el_catalogo_se_lee_una_vez_por_lote_no_una_por_archivo(monkeypatch):
    """Una carga de 50 documentos hace 2 consultas de catalogo y universo, no
    100. El motor es puro justamente para poder reusar lo cargado."""
    llamadas = {"catalogo": 0, "universo": 0}

    async def catalogo_espia(conn):
        llamadas["catalogo"] += 1
        from app.services.document_matcher import Catalog
        return Catalog(aliases=[])

    async def universo_espia(conn, carrier_id=None):
        llamadas["universo"] += 1
        from app.services.document_matcher import EntityUniverse
        return EntityUniverse()

    monkeypatch.setattr("app.routers.document_ingest.cargar_catalogo", catalogo_espia)
    monkeypatch.setattr("app.routers.document_ingest.cargar_universo", universo_espia)
    pool, conn = _pool_de_ingesta()
    client = make_client(pool)

    client.post("/api/v1/document-ingest/files", files=[
        ("files", ("a.pdf", b"%PDF-1.4", "application/pdf")),
        ("files", ("b.pdf", b"%PDF-1.4", "application/pdf")),
        ("files", ("c.pdf", b"%PDF-1.4", "application/pdf")),
    ])

    assert llamadas == {"catalogo": 1, "universo": 1}


def test_duplicados_del_mismo_rut_no_degradan_a_ambiguous(monkeypatch):
    """'F30_<rut>_ANEXO_<rut>.pdf' es un archivo real: el RUT aparece dos
    veces en el nombre y `extract_ruts` no deduplica, asi que el motor
    devuelve dos candidatos que son la MISMA empresa. Sin deduplicar antes de
    clasificar, `classify_match` los ve empatados y AUTO se degrada a
    AMBIGUOUS aunque no haya ninguna ambiguedad real."""
    from app.services.document_matcher import MatchCandidate

    mismo_candidato_dos_veces = [
        MatchCandidate(entity_type="CARRIER", entity_id="c1", requirement_id="req-1",
                        confidence=0.95, evidence={"entity": {"via": "RUT", "raw": "1-9"}}),
        MatchCandidate(entity_type="CARRIER", entity_id="c1", requirement_id="req-1",
                        confidence=0.95, evidence={"entity": {"via": "RUT", "raw": "1-9"}}),
    ]
    monkeypatch.setattr("app.routers.document_ingest.match_document",
                        lambda **kw: mismo_candidato_dos_veces)
    pool, conn = _pool_de_ingesta()
    client = make_client(pool)

    client.post("/api/v1/document-ingest/files",
                files={"files": ("F30.pdf", b"%PDF-1.4", "application/pdf")})

    insert = next(c for c in conn.fetchrow.call_args_list
                  if "document_ingest_items" in c.args[0])
    args = insert.args[1:]
    assert args[5] == "AUTO", (
        "dos candidatos iguales no son una ambiguedad real: deduplicar antes "
        "de clasificar tiene que devolver AUTO, no AMBIGUOUS"
    )
    assert args[7] == "c1"


def test_ambiguous_no_escribe_un_ganador_arbitrario(monkeypatch):
    """Con un empate real (dos empresas homonimas, por ejemplo), elegir
    `candidatos[0]` seria un desempate arbitrario que define el orden de
    recorrido del motor, no una decision. La eleccion tiene que salir de
    `candidates` — nunca de estas cuatro columnas."""
    from app.services.document_matcher import MatchCandidate

    empatados = [
        MatchCandidate(entity_type="DRIVER", entity_id="d1", requirement_id="req-1",
                        confidence=0.70, evidence={"entity": {"via": "NOMBRE_FUZZY"}}),
        MatchCandidate(entity_type="DRIVER", entity_id="d2", requirement_id="req-1",
                        confidence=0.69, evidence={"entity": {"via": "NOMBRE_FUZZY"}}),
    ]
    monkeypatch.setattr("app.routers.document_ingest.match_document",
                        lambda **kw: empatados)
    pool, conn = _pool_de_ingesta()
    client = make_client(pool)

    client.post("/api/v1/document-ingest/files",
                files={"files": ("ANEXO 3 Felipe.jpeg", b"x", "image/jpeg")})

    insert = next(c for c in conn.fetchrow.call_args_list
                  if "document_ingest_items" in c.args[0])
    args = insert.args[1:]
    assert args[5] == "AMBIGUOUS"
    assert args[6] is None, "entity_type no puede quedar con el ganador arbitrario"
    assert args[7] is None, "entity_id no puede quedar con el ganador arbitrario"
    assert args[8] is None, "requirement_id no puede quedar con el ganador arbitrario"
    assert args[9] is None, "confidence no puede quedar con el ganador arbitrario"
    # `candidates` SI conserva las dos opciones: de ahi sale la eleccion.
    candidatos_guardados = json.loads(args[11])
    assert len(candidatos_guardados) == 2


def test_el_lote_cuenta_auto_y_revision_por_separado(monkeypatch):
    """`document_ingest_batches.matched_auto`/`matched_review` se crearon
    textualmente para medir si hace falta sumar OCR/LLM, y estaban en 0
    porque nadie las escribia."""
    from app.services.document_matcher import MatchCandidate

    resultados = iter([
        [MatchCandidate(entity_type="ASSET", entity_id="a1", requirement_id="r1",
                        confidence=0.95, evidence={})],   # -> AUTO
        [MatchCandidate(entity_type="DRIVER", entity_id="d1", requirement_id=None,
                        confidence=0.70, evidence={})],   # -> SUGGESTED
        [],                                                # -> UNMATCHED
    ])
    monkeypatch.setattr("app.routers.document_ingest.match_document",
                        lambda **kw: next(resultados))
    pool, conn = _pool_de_ingesta()
    conn.fetchrow.side_effect = [
        {"id": "i1", "file_name": "a.pdf", "mime_type": "application/pdf",
         "size_bytes": 9, "storage_path": "staging/batch-1/a.pdf", "match_status": "AUTO"},
        {"id": "i2", "file_name": "b.pdf", "mime_type": "application/pdf",
         "size_bytes": 9, "storage_path": "staging/batch-1/b.pdf", "match_status": "SUGGESTED"},
        {"id": "i3", "file_name": "c.pdf", "mime_type": "application/pdf",
         "size_bytes": 9, "storage_path": "staging/batch-1/c.pdf", "match_status": "UNMATCHED"},
    ]
    client = make_client(pool)

    client.post("/api/v1/document-ingest/files", files=[
        ("files", ("a.pdf", b"%PDF-1.4", "application/pdf")),
        ("files", ("b.pdf", b"%PDF-1.4", "application/pdf")),
        ("files", ("c.pdf", b"%PDF-1.4", "application/pdf")),
    ])

    update = next(c for c in conn.execute.call_args_list
                  if "document_ingest_batches" in c.args[0])
    assert update.args[1:] == ("batch-1", 1, 1, 1), (
        "esperaba (batch_id, unmatched=1, matched_auto=1, matched_review=1)"
    )


# ── Bandeja: la cola global ────────────────────────────────────────────────

def _queue_row(item_id="i1", carrier_name="ACME S.A.", **over):
    row = {
        "id": item_id, "file_name": f"{item_id}.png", "mime_type": "image/png",
        "size_bytes": 10, "storage_path": f"staging/b1/{item_id}.png",
        "match_status": "UNMATCHED", "created_at": datetime(2026, 8, 14, tzinfo=timezone.utc),
        "carrier_id": "c1", "carrier_name": carrier_name,
        "confidence": None, "suggested_requirement_name": None, "candidate_count": 0,
        "mismo_casillero": 1, "mismo_contenido": 1,
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


def test_queue_uses_the_shared_unclassified_predicate():
    """El mismo predicado que cuenta el "sin clasificar" por empresa en
    /compliance-records/status. Escrito dos veces, ya había divergido."""
    from app.schemas.document_ingest import unclassified_predicate

    pool = AsyncMock()
    pool.fetchval.return_value = 0
    pool.fetch.return_value = []
    client = make_client(pool)

    client.get("/api/v1/document-ingest/items")

    assert unclassified_predicate("i") in pool.fetch.await_args.args[0]


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


def test_la_cola_avisa_cuando_dos_archivos_reclaman_el_mismo_casillero():
    """`classify-batch` ya se protege de N archivos a un casillero en UNA
    operación —su docstring cuenta que "marcar 31 licencias y asignarlas al
    mismo conductor destruía 30"— pero el clasificador propone el mismo
    (entity_id, requirement_id) a archivos DISTINTOS, y el operador los
    confirma de a uno: exactamente lo que ese guardia permite."""
    pool = AsyncMock()
    pool.fetchval.return_value = 2
    pool.fetch.return_value = [
        _queue_row(item_id="a", mismo_casillero=2, mismo_contenido=1),
        _queue_row(item_id="b", mismo_casillero=2, mismo_contenido=1),
    ]
    client = make_client(pool)

    filas = client.get("/api/v1/document-ingest/items").json()["rows"]

    assert [f["mismo_casillero"] for f in filas] == [2, 2]


def test_el_sql_de_la_cola_no_agrupa_los_sin_destino():
    """LA GUARDA DE NULL. Sin ella, los ~60 items UNMATCHED con entity_id nulo
    caen en la MISMA partición y la pantalla diría que todos reclaman el mismo
    casillero. Es el peor falso positivo posible: aparece justo cuando la cola
    está llena de trabajo real."""
    from app.routers.document_ingest import _SQL_COLA

    assert "i.entity_id IS NOT NULL" in _SQL_COLA
    assert "i.requirement_id IS NOT NULL" in _SQL_COLA
    assert "i.content_sha256 IS NOT NULL" in _SQL_COLA


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

def _record_row(record_id="rec-1"):
    return {
        "id": record_id, "entity_id": "a1", "entity_type": "ASSET",
        "status": "MISSING", "expiration_date": None,
    }


def _tray_item(item_id="i1", **over):
    row = {
        "id": item_id, "storage_path": f"s/{item_id}.png", "file_name": f"{item_id}.png",
        "mime_type": "image/png", "size_bytes": 9, "match_status": "UNMATCHED",
    }
    row.update(over)
    return row


def test_classify_batch_applies_the_selected_item():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetch.return_value = [_tray_item()]
    conn.fetchrow.side_effect = [
        _record_row(),
        {"metadata": {}, "expiration_date": None},
    ]
    conn.fetchval.return_value = False
    client = make_client(pool)

    res = client.post(
        "/api/v1/document-ingest/items/classify-batch",
        json={"item_ids": ["i1"], "entity_type": "ASSET",
              "entity_id": "a1", "requirement_id": "req-1"},
    )

    assert res.status_code == 200
    assert res.json()["applied"] == ["i1"]


def test_classify_batch_refuses_two_files_for_the_same_slot():
    """La regla del lote (diseño §7): nunca se comparten las dos coordenadas.

    Sin este límite los N archivos entraban en un loop sobre el MISMO
    compliance_record y cada uno pisaba al anterior: sobrevivía el último y los
    N-1 quedaban COMMITTED —fuera de la cola, invisibles en toda superficie— y
    además irreversibles, porque desde el segundo `_apply_stored_document`
    escribe `replaced_storage_path` y el deshacer los rechaza. Marcar 31
    licencias y asignarlas al mismo conductor destruía 30.
    """
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetch.return_value = [_tray_item("i1"), _tray_item("i2")]
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

    assert res.status_code == 422
    assert "requisito distinto" in res.json()["detail"]
    # Y no llega a tocar compliance_records: el rechazo es previo, no un
    # rollback después de haber pisado el registro.
    sql = " ".join(str(c.args[0]) for c in conn.execute.await_args_list)
    assert "compliance_records" not in sql


def test_classify_batch_still_serves_the_single_file_door():
    """`uploadAndClassify` (la carga desde la ficha, en producción) manda
    exactamente un item. La regla del lote no puede romper ese camino."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetch.return_value = [_tray_item()]
    conn.fetchrow.side_effect = [
        _record_row(),
        {"metadata": {}, "expiration_date": None},
    ]
    conn.fetchval.return_value = False
    client = make_client(pool)

    res = client.post(
        "/api/v1/document-ingest/items/classify-batch",
        json={"item_ids": ["i1"], "entity_type": "ASSET", "entity_id": "a1",
              "requirement_id": "req-1", "expiration_date": "2027-01-01"},
    )

    assert res.status_code == 200
    assert res.json()["applied"] == ["i1"]


def test_classify_batch_requires_the_expiration_date_when_the_requirement_has_one():
    """Cobertura que se perdió al borrar el endpoint de a uno: sin fecha, un
    requisito con vencimiento entraría como vigente para siempre."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetch.return_value = [_tray_item()]
    conn.fetchrow.return_value = _record_row()
    conn.fetchval.return_value = True  # has_expiration
    client = make_client(pool)

    res = client.post(
        "/api/v1/document-ingest/items/classify-batch",
        json={"item_ids": ["i1"], "entity_type": "ASSET",
              "entity_id": "a1", "requirement_id": "req-1"},
    )

    assert res.status_code == 422
    assert "fecha de vencimiento" in res.json()["detail"]


def test_classify_batch_skips_a_discarded_item_instead_of_applying_it():
    """Un archivo ya descartado no vuelve a entrar por la puerta de atrás: su
    blob de staging está borrado, aplicarlo dejaría un file_url roto."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetch.return_value = [_tray_item(match_status="DISCARDED")]
    conn.fetchrow.return_value = _record_row()
    conn.fetchval.return_value = False
    client = make_client(pool)

    res = client.post(
        "/api/v1/document-ingest/items/classify-batch",
        json={"item_ids": ["i1"], "entity_type": "ASSET",
              "entity_id": "a1", "requirement_id": "req-1"},
    )

    assert res.status_code == 200
    assert res.json()["applied"] == []
    assert res.json()["errors"][0]["error"] == "Fue eliminado de la bandeja"


def test_classify_batch_404_when_no_document_is_found():
    """Cobertura restaurada: ids que ya no existen en la bandeja."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetch.return_value = []
    client = make_client(pool)

    res = client.post(
        "/api/v1/document-ingest/items/classify-batch",
        json={"item_ids": ["fantasma"], "entity_type": "ASSET",
              "entity_id": "a1", "requirement_id": "req-1"},
    )

    assert res.status_code == 404
    assert "Ningún documento encontrado" in res.json()["detail"]


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

def _committed_item(item_id="item-1", record_id="rec-1", **over):
    row = {
        "id": item_id, "compliance_record_id": record_id,
        "match_status": "COMMITTED", "metadata": {},
        "entity_type": "ASSET", "entity_id": "a1",
        "file_url": "staging/b1/patente.pdf",
    }
    row.update(over)
    return row


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


def test_undo_leaves_an_audit_trail():
    """Deshacer vacía un registro de producción (APPROVED_MANUAL → MISSING, y
    adiós file_url) igual que sus operaciones hermanas, que sí registran:
    aplicar llama record_manual_edit/log_document_replacement y reasignar
    log_change. Sin rastro no hay forma de saber después quién lo hizo ni qué
    archivo estaba puesto."""
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
    auditoria = [
        c for c in conn.execute.await_args_list if "public.audit_log" in str(c.args[0])
    ]
    assert len(auditoria) == 1, "la reversión no dejó rastro en audit_log"
    assert "document_undo_classify" in auditoria[0].args
    # Con el puntero al archivo que se soltó: es lo único que permite volver a
    # encontrar el blob después.
    assert '"staging/b1/patente.pdf"' in auditoria[0].args


def test_undo_does_not_audit_what_it_did_not_revert():
    """Un item que no estaba clasificado no genera un registro de auditoría
    de algo que no pasó."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetch.return_value = [_committed_item(match_status="UNMATCHED")]
    client = make_client(pool)

    res = client.post(
        "/api/v1/document-ingest/items/undo-classify",
        json={"item_ids": ["item-1"]},
    )

    assert res.json()["reverted"] == []
    assert not [c for c in conn.execute.await_args_list if "public.audit_log" in str(c.args[0])]


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
