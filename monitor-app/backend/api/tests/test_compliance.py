from datetime import date
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user, get_supabase, require_editor
from app.db import get_pool
from app.routers.compliance import pendiente_predicate, router
from tests.conftest import USER, PoolDeUnaConexion, wire_transactional_conn


def make_client(pool, supabase=None):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_editor] = lambda: USER
    app.dependency_overrides[get_supabase] = lambda: supabase or MagicMock()
    return TestClient(app)


def test_get_record_404_when_missing():
    pool = AsyncMock()
    pool.fetchrow.return_value = None
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/r1")

    assert res.status_code == 404


def test_patch_record_no_fields_422():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"entity_id": "c1", "entity_type": "CARRIER", "status": "MISSING", "expiration_date": None}
    client = make_client(pool)

    res = client.patch("/api/v1/compliance-records/r1", json={})

    assert res.status_code == 422


def test_patch_record_approves_manually_and_sets_override():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"entity_id": "c1", "entity_type": "CARRIER", "status": "MISSING", "expiration_date": None}
    pool.fetchrow.return_value = {
        "id": "r1", "entity_id": "c1", "entity_type": "CARRIER", "requirement_id": "req1",
        "requirement_id": "req-1", "requirement_code": "F30_MULTAS", "name": "F30", "requirement_level": "LEGAL_MANDATORY",
        "requires_file": True, "status": "APPROVED_MANUAL", "expiration_date": None, "file_url": None,
        "metadata": {}, "is_manual_override": True, "created_at": None, "updated_at": None,
    }
    client = make_client(pool)

    res = client.patch("/api/v1/compliance-records/r1", json={"status": "APPROVED_MANUAL"})

    assert res.status_code == 200
    assert res.json()["status"] == "APPROVED_MANUAL"
    override_sql = conn.execute.call_args_list[0].args[0]
    assert "UPDATE public.compliance_records" in override_sql
    override_flag_sql = conn.execute.call_args_list[1].args[0]
    assert "is_manual_override = true" in override_flag_sql


def test_upload_file_404_when_record_missing():
    pool = AsyncMock()
    pool.fetchrow.return_value = None
    client = make_client(pool)

    res = client.post(
        "/api/v1/compliance-records/r1/file",
        files={"file": ("licencia.pdf", b"contenido", "application/pdf")},
    )

    assert res.status_code == 404


def test_upload_file_rejects_missing_date_when_policy_requires_it():
    """Hoy /file acepta sin fecha SIEMPRE, incluso para una licencia.

    El guardia vive en el servidor: el renglon pregunta antes para que nunca
    llegue incompleto, pero quien decide es la API. Y valida ANTES de tocar
    storage — si validara despues, el rechazo dejaria el blob huerfano, que es
    exactamente el defecto que este trabajo viene a eliminar del otro camino.
    """
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "entity_id": "d1", "entity_type": "DRIVER", "status": "MISSING",
        "expiration_date": None, "metadata": {}, "expiration_policy": "REQUIRED",
    }
    supabase = MagicMock()
    client = make_client(pool, supabase=supabase)

    res = client.post(
        "/api/v1/compliance-records/r1/file",
        files={"file": ("licencia.pdf", b"contenido", "application/pdf")},
    )

    assert res.status_code == 422
    assert "vencimiento" in res.json()["detail"]
    # Lo critico: no se subio nada a storage.
    supabase.storage.from_.return_value.upload.assert_not_called()


def test_upload_file_accepts_missing_date_when_policy_is_optional():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    pool.fetchrow.return_value = {
        "entity_id": "d1", "entity_type": "DRIVER", "status": "MISSING",
        "expiration_date": None, "metadata": {}, "expiration_policy": "OPTIONAL",
    }
    supabase = MagicMock()
    supabase.storage.from_.return_value.upload.return_value = None
    client = make_client(pool, supabase=supabase)

    res = client.post(
        "/api/v1/compliance-records/r1/file",
        files={"file": ("anexo.pdf", b"contenido", "application/pdf")},
    )

    assert res.status_code == 201


def test_upload_file_accepts_date_when_policy_requires_it():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    pool.fetchrow.return_value = {
        "entity_id": "d1", "entity_type": "DRIVER", "status": "MISSING",
        "expiration_date": None, "metadata": {}, "expiration_policy": "REQUIRED",
    }
    supabase = MagicMock()
    supabase.storage.from_.return_value.upload.return_value = None
    client = make_client(pool, supabase=supabase)

    res = client.post(
        "/api/v1/compliance-records/r1/file",
        files={"file": ("licencia.pdf", b"contenido", "application/pdf")},
        data={"expiration_date": "2027-01-31"},
    )

    assert res.status_code == 201


def test_upload_file_reads_the_policy_from_the_catalog():
    """La politica es del REQUISITO, no del registro: la consulta tiene que
    unir con compliance_requirements o estaria leyendo una columna que no
    existe en compliance_records."""
    pool = AsyncMock()
    pool.fetchrow.return_value = None
    client = make_client(pool)

    client.post(
        "/api/v1/compliance-records/r1/file",
        files={"file": ("x.pdf", b"c", "application/pdf")},
    )

    sql = pool.fetchrow.call_args.args[0]
    assert "expiration_policy" in sql
    assert "compliance_requirements" in sql


def test_upload_file_rejects_disallowed_mime():
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "entity_id": "c1", "entity_type": "CARRIER", "status": "MISSING",
        "expiration_date": None, "metadata": {}, "expiration_policy": "NONE",
    }
    client = make_client(pool)

    res = client.post(
        "/api/v1/compliance-records/r1/file",
        files={"file": ("virus.exe", b"MZ", "application/x-msdownload")},
    )

    assert res.status_code == 422


def test_upload_file_forces_approved_manual_and_persists_metadata():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    pool.fetchrow.return_value = {
        "entity_id": "c1", "entity_type": "CARRIER", "status": "MISSING",
        "expiration_date": None, "metadata": {}, "expiration_policy": "NONE",
    }
    supabase = MagicMock()
    supabase.storage.from_.return_value.upload.return_value = None
    client = make_client(pool, supabase=supabase)

    res = client.post(
        "/api/v1/compliance-records/r1/file",
        files={"file": ("licencia.pdf", b"contenido", "application/pdf")},
    )

    assert res.status_code == 201
    body = res.json()
    assert body["status"] == "APPROVED_MANUAL"
    assert body["file_name"] == "licencia.pdf"

    update_sql = conn.execute.call_args_list[0].args[0]
    assert "status = 'APPROVED_MANUAL'" in update_sql
    assert "metadata = $3::jsonb" in update_sql

    override_sql = conn.execute.call_args_list[1].args[0]
    assert "is_manual_override = true" in override_sql

    # sin storage_path previo -> no debe intentar loguear un reemplazo
    audit_sqls = [c.args[0] for c in conn.execute.call_args_list]
    assert not any("document_replace" in s for s in audit_sqls)


def test_upload_file_logs_replacement_when_previous_file_existed():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    pool.fetchrow.return_value = {
        "entity_id": "c1", "entity_type": "CARRIER", "status": "APPROVED_MANUAL",
        "expiration_date": None, "metadata": {"storage_path": "carrier/c1/r1/old_x.pdf"}, "expiration_policy": "NONE",
    }
    supabase = MagicMock()
    supabase.storage.from_.return_value.upload.return_value = None
    client = make_client(pool, supabase=supabase)

    res = client.post(
        "/api/v1/compliance-records/r1/file",
        files={"file": ("licencia.pdf", b"contenido", "application/pdf")},
    )

    assert res.status_code == 201
    # dos INSERT a audit_log: uno de record_manual_edit (document_upload) y
    # uno de log_document_replacement (document_replace, por el archivo previo)
    audit_calls = [c for c in conn.execute.call_args_list if "public.audit_log" in c.args[0]]
    assert len(audit_calls) == 2
    assert any("document_replace" in c.args[0] for c in audit_calls)


def test_delete_file_404_when_record_missing():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = None
    client = make_client(pool)

    res = client.delete("/api/v1/compliance-records/r1/file")

    assert res.status_code == 404


def test_delete_file_422_when_no_file_loaded():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {
        "entity_id": "c1", "entity_type": "CARRIER", "status": "MISSING", "metadata": {},
    }
    client = make_client(pool)

    res = client.delete("/api/v1/compliance-records/r1/file")

    assert res.status_code == 422


def test_delete_file_tambien_limpia_la_fecha_de_vencimiento():
    """"Mismo estado que un documento nunca subido" tiene que ser verdad.

    Encontrado en el click-through del 19/08: borrar el archivo dejaba
    `expiration_date` con la fecha del documento borrado. El registro quedaba
    MISSING —sin documento— y con vencimiento futuro, o sea un dato que
    sobrevive a la cosa que describia.

    No es cosmetico. La `urgencia` de /pending se calcula con esa fecha: al
    acercarse, un documento QUE NO EXISTE aparece como 'POR_VENCER' —"hay que
    renovarlo"— en vez de 'FALTA'. Y el cajon escribe "vencido - <fecha>" para
    algo que nunca se subio.

    La otra ruta que devuelve un registro a MISSING —`reassign` con `to_tray`—
    SI la limpia. Eran dos caminos al mismo estado haciendo cosas distintas.

    Ojo: por `PATCH` no se puede arreglar a mano. Usa COALESCE, asi que null
    significa "no lo mandaron" y la fecha es inalcanzable desde la API."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {
        "entity_id": "d1", "entity_type": "DRIVER", "status": "APPROVED_MANUAL",
        "metadata": {"storage_path": "d1/cert.pdf"},
    }
    # `_fetch_record` corre al final del endpoint y necesita su propia fila:
    # mismo armado que test_delete_file_resets_to_missing_and_removes_from_storage.
    pool.fetchrow.return_value = {
        "id": "r1", "entity_id": "d1", "entity_type": "DRIVER",
        "requirement_id": "req-1", "requirement_code": "CERT_ANTECEDENTES",
        "name": "Certificado de Antecedentes", "requirement_level": "LEGAL_MANDATORY",
        "requires_file": True, "status": "MISSING", "expiration_date": None,
        "file_url": None, "metadata": {}, "is_manual_override": False,
        "created_at": None, "updated_at": None,
    }
    client = make_client(pool, supabase=MagicMock())

    res = client.delete("/api/v1/compliance-records/r1/file")

    assert res.status_code == 200
    update = next(c.args[0] for c in conn.execute.call_args_list
                  if "status = 'MISSING'" in c.args[0])
    assert "expiration_date = NULL" in update, (
        "el registro queda MISSING con la fecha del documento borrado: "
        "un vencimiento sin documento que lo respalde"
    )


def test_delete_file_resets_to_missing_and_removes_from_storage():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {
        "entity_id": "c1", "entity_type": "CARRIER", "status": "APPROVED_MANUAL",
        "metadata": {"storage_path": "carrier/c1/r1/x.pdf"},
    }
    pool.fetchrow.return_value = {
        "id": "r1", "entity_id": "c1", "entity_type": "CARRIER", "requirement_id": "req1",
        "requirement_id": "req-1", "requirement_code": "F30_MULTAS", "name": "F30", "requirement_level": "LEGAL_MANDATORY",
        "requires_file": True, "status": "MISSING", "expiration_date": None, "file_url": None,
        "metadata": {}, "is_manual_override": True, "created_at": None, "updated_at": None,
    }
    supabase = MagicMock()
    client = make_client(pool, supabase=supabase)

    res = client.delete("/api/v1/compliance-records/r1/file")

    assert res.status_code == 200
    assert res.json()["status"] == "MISSING"
    supabase.storage.from_.return_value.remove.assert_called_once_with(["carrier/c1/r1/x.pdf"])

    update_sql = conn.execute.call_args_list[0].args[0]
    assert "status = 'MISSING'" in update_sql
    assert "file_url = NULL" in update_sql

    override_sql = conn.execute.call_args_list[1].args[0]
    assert "is_manual_override = true" in override_sql


def _carrier_status_row(**over):
    row = {
        "entity_id": "c1", "entity_name": "Transportes Sur Spa",
        "carrier_id": "c1", "carrier_name": "Transportes Sur Spa",
        "operational_status": "ACTIVE", "total_count": 12, "satisfied_count": 9,
        "pending_count": 3, "pending_mandatory": 1, "unclassified_count": 0,
    }
    row.update(over)
    return row


def test_carrier_status_reports_progress_and_unclassified():
    """La vista 'Por empresa' necesita las dos mitades en la misma fila: cuanto
    lleva cubierto y cuanto llego sin clasificar."""
    pool = AsyncMock()
    pool.fetch.return_value = [
        _carrier_status_row(unclassified_count=3),
        _carrier_status_row(carrier_id="c2", carrier_name="Rios Ltda",
                            total_count=12, satisfied_count=12, pending_count=0,
                            pending_mandatory=0, unclassified_count=0),
    ]
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/status")

    assert res.status_code == 200
    body = res.json()
    assert body["total_pending"] == 3
    assert body["total_unclassified"] == 3
    assert body["rows"][0]["satisfied_count"] == 9
    assert body["rows"][1]["pending_count"] == 0


def test_carrier_status_includes_inactive_carriers_that_have_documents():
    """Si una empresa inactiva tiene documentos esperando, tiene que aparecer:
    si no, la cola muestra archivos de una empresa que la lista niega."""
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    client.get("/api/v1/compliance-records/status")

    query = pool.fetch.call_args.args[0]
    assert "unclassified" in query
    assert "OR" in query and "operational_status" in query


def test_carrier_status_empty():
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/status")

    assert res.status_code == 200
    assert res.json() == {"total_pending": 0, "total_unclassified": 0, "rows": []}


def test_carrier_status_route_does_not_collide_with_record_id_path():
    """La ruta fija debe declararse antes de /{record_id} — si no, FastAPI la
    matchearia como record_id='carrier-status'."""
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/status")

    assert res.status_code == 200


def _pending_row(**overrides):
    base = {
        "id": "r1", "entity_type": "DRIVER", "entity_id": "d1", "subject_name": "Juan Perez",
        "requirement_id": "req-1", "requirement_code": "LICENCIA_CONDUCIR", "document_name": "Licencia conducir",
        "requirement_level": "LEGAL_MANDATORY", "status": "MISSING", "expiration_date": None,
        "carrier_id": "c1", "carrier_name": "Transportes Sur Spa", "carrier_tax_id": "76.111.111-1",
        "carrier_operation_types": ["Tractoreo"], "total_count": 1,
        # Los produce el SELECT (Ronda 129): por que esta pendiente, y que
        # exige su requisito. El renglon de carga necesita la politica para
        # saber si pedir la fecha ANTES de subir.
        "urgencia": "FALTA", "expiration_policy": "REQUIRED",
        # Si la fila tiene un archivo cargado. Sale de `file_url`, no de una
        # lectura de `status` — ver el test de mas abajo.
        "tiene_archivo": False,
    }
    base.update(overrides)
    return base


def test_pending_rows_route_does_not_collide_with_record_id_path():
    """Mismo cuidado que /pending-summary: /pending debe declararse antes de
    /{record_id}."""
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/pending")

    assert res.status_code == 200
    assert "rows" in res.json()
    pool.fetchrow.assert_not_called()


def test_pending_rows_empty_when_nothing_pending():
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/pending")

    assert res.status_code == 200
    assert res.json() == {"total": 0, "rows": []}


def test_pending_rows_maps_categories_and_certification_type():
    pool = AsyncMock()
    pool.fetch.return_value = [
        _pending_row(id="r1", entity_type="CARRIER", subject_name=None, requirement_level="LEGAL_MANDATORY"),
        _pending_row(id="r2", entity_type="DRIVER", subject_name="Juan Perez", requirement_level="SHIPPER_REQUIRED"),
        _pending_row(id="r3", entity_type="ASSET", subject_name="ABCD12", requirement_level="CONDITIONAL_OPTIONAL"),
    ]
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/pending")

    rows = res.json()["rows"]
    assert rows[0]["category"] == "EMPRESA" and rows[0]["certification_type"] == "BASICA"
    assert rows[1]["category"] == "CHOFER" and rows[1]["certification_type"] == "ADICIONAL"
    assert rows[2]["category"] == "EQUIPO" and rows[2]["certification_type"] == "ADICIONAL"


def test_pending_rows_expone_urgencia_y_politica():
    """Los dos campos que el renglon de carga necesita.

    Sin `expiration_policy` el renglon no sabe si pedir la fecha y termina
    preguntandola siempre o nunca; nunca es un 422 despues de haber subido.
    """
    pool = AsyncMock()
    pool.fetch.return_value = [
        _pending_row(urgencia="POR_VENCER", expiration_policy="OPTIONAL"),
    ]
    client = make_client(pool)

    fila = client.get("/api/v1/compliance-records/pending").json()["rows"][0]

    assert fila["urgencia"] == "POR_VENCER"
    assert fila["expiration_policy"] == "OPTIONAL"


def test_pending_rows_expone_al_dia_sin_romper_el_contrato_de_respuesta():
    """Ronda de arreglo 1 (Task 4): `urgencia` gano un cuarto valor, 'AL_DIA',
    para la fila cubierta que `estado='todos'` empezo a traer. El SQL puede
    calcularlo bien y la respuesta romper igual si el `Literal` de
    `PendingComplianceRow` (app/schemas/compliance.py) se queda en tres
    valores: `response_model` la rechaza con 500 antes de llegar al cliente.

    Un `AsyncMock` sin pasar por `TestClient` no ve esto — el mock devuelve
    lo que el test le dicta sin pasar por la validacion de Pydantic. Por eso
    esto pega contra la ruta real, no llama al handler a mano."""
    pool = AsyncMock()
    pool.fetch.return_value = [
        _pending_row(urgencia="AL_DIA", status="APPROVED_MANUAL", expiration_policy="NONE"),
    ]
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/pending")

    assert res.status_code == 200, res.text
    assert res.json()["rows"][0]["urgencia"] == "AL_DIA"


def test_pending_dice_si_la_fila_tiene_archivo_en_vez_de_deducirlo_del_status():
    """`status` no sirve para saber si hay un archivo cargado, y se estaba
    usando para eso: un 'EXPIRED' SI lo tiene —vencio justamente porque
    alguien lo subio— y un 'REJECTED' puede no tenerlo. La ficha de empresa
    decide con este dato si ofrece "Ver", asi que sale de `file_url`, que es
    el hecho, y no de una lectura del estado."""
    from app.routers.compliance import _PENDING_ROWS_SQL

    assert "cr.file_url IS NOT NULL AS tiene_archivo" in _PENDING_ROWS_SQL

    pool = AsyncMock()
    pool.fetch.return_value = [
        _pending_row(status="EXPIRED", urgencia="VENCIDO", tiene_archivo=True),
    ]
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/pending")

    assert res.status_code == 200, res.text
    assert res.json()["rows"][0]["tiene_archivo"] is True


def test_pendiente_incluye_lo_que_esta_por_vencer_sin_comerse_lo_vencido():
    """Antes de la Ronda 129 renovar no tenia superficie: el predicado exigia
    la fecha YA pasada, asi que un documento que vence en diez dias no
    aparecia en ninguna pantalla.

    Las dos mitades del `>=` importan: sin ella "por vencer" se tragaria a
    "vencido" y la urgencia de la fila mentiria."""
    sql = pendiente_predicate("cr")

    assert "cr.expiration_date < CURRENT_DATE" in sql
    assert "cr.expiration_date >= CURRENT_DATE" in sql
    assert "INTERVAL '30 days'" in sql


def test_la_urgencia_cuenta_lo_marcado_vencido_igual_que_el_embudo():
    """Dos lecturas del mismo dato que discrepan es el defecto que este modulo
    ya tuvo: el embudo mandaba 8 empresas a "Hay que renovar" mientras el cajon
    de cada una decia "No le falta ningun documento".

    Un registro marcado EXPIRED a mano y sin fecha tiene que salir VENCIDO en
    las dos. Hoy hay 0 filas asi en produccion; el test existe para que la
    primera no reabra el desfase."""
    from app.routers.compliance import _PENDING_ROWS_SQL

    rama = _PENDING_ROWS_SQL.split("AS urgencia")[0].split("CASE")[-1]
    assert "r.status = 'EXPIRED'" in rama, (
        "la urgencia dejo de contar lo marcado vencido a mano; el embudo si lo cuenta"
    )


def test_pending_rows_includes_carrier_operation_types():
    pool = AsyncMock()
    pool.fetch.return_value = [_pending_row(carrier_operation_types=["Tractoreo", "Equipo Completo"])]
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/pending")

    assert res.json()["rows"][0]["carrier_operation_types"] == ["Tractoreo", "Equipo Completo"]


def test_pending_rows_passes_filters_to_query():
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    client.get(
        "/api/v1/compliance-records/pending"
        "?carrier_id=c1&category=DRIVER&requirement_code=LICENCIA_CONDUCIR"
        "&q=juan&operation_type=Tractoreo&limit=10&offset=5"
    )

    args = pool.fetch.call_args.args
    assert args[1] == "c1"
    assert args[2] == "DRIVER"
    assert args[3] == "LICENCIA_CONDUCIR"
    assert args[4] == "juan"
    assert args[5] == "Tractoreo"
    assert args[6] == 10
    assert args[7] == 5
    # Acotada a UNA empresa: sin filtro de estado. La ficha tiene que poder
    # leer el expediente de una empresa dada de baja -es material de
    # auditoria-, y el cero que devolvia el filtro la pantalla lo leia como
    # "nunca se le asignaron requisitos".
    assert args[8] is None


def test_la_sabana_global_si_pide_solo_empresas_activas():
    """La otra mitad, y la que se rompe sola si alguien unifica las dos ramas.

    Sin `carrier_id` la consulta es la sabana global -"que hay que hacer hoy"-
    y ahi el filtro por ACTIVE existe por un bug medido (5.4): antes traia
    LEGACY_INACTIVE/INACTIVE/ONBOARDING y eran mas de la mitad del volumen.

    Este test mira el ARGUMENTO, no el resultado; que el filtro efectivamente
    excluya lo verifica el test de integracion contra Postgres real, porque un
    AsyncMock nunca ejecuta el WHERE."""
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    client.get("/api/v1/compliance-records/pending?limit=10")

    assert pool.fetch.call_args.args[8] == "ACTIVE"


def test_pending_acepta_limit_500_para_la_ficha_de_empresa():
    """Ronda de arreglo 1 (Task 4): la ficha pide `estado='todos'` UNA sola
    vez con `limit=500` y deriva sus cuatro cifras contando `urgencia` sobre
    las filas que llegaron. El tope viejo (200) le devolveria 422 a esa unica
    consulta antes de llegar al handler."""
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/pending?limit=500")

    assert res.status_code == 200, res.text


def test_pending_rechaza_un_limit_mayor_a_500():
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/pending?limit=501")

    assert res.status_code == 422


def test_pending_rows_filters_by_subject():
    """El cajon de un conductor o un vehiculo pide lo que le falta A EL.

    Antes habia que pedir el pendiente de la empresa entera y filtrar del lado
    del cliente. Esa pagina corta en 200 —hay empresas con 381 pendientes—, asi
    que el filtro del cliente operaba sobre una muestra truncada sin decirlo."""
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    client.get(
        "/api/v1/compliance-records/pending?category=DRIVER"
        "&entity_id=11111111-1111-1111-1111-111111111111"
    )

    args = pool.fetch.call_args.args
    assert args[2] == "DRIVER"
    assert args[9] == "11111111-1111-1111-1111-111111111111"


def test_pending_rows_binds_exactly_the_parameters_it_references():
    """Misma defensa que /status: un placeholder de mas o de menos hace que
    Postgres rechace la sentencia, y el AsyncMock acepta cualquier cantidad."""
    import re

    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    client.get("/api/v1/compliance-records/pending")

    sql, *args = pool.fetch.call_args.args
    referenciados = {int(n) for n in re.findall(r"\$(\d+)", sql)}
    assert referenciados == set(range(1, len(args) + 1)), (
        f"el SQL referencia {sorted(referenciados)} pero se pasan {len(args)} parametros"
    )


def test_pending_rows_excludes_inactive_carriers_from_query():
    """Bug 5.4: antes de este fix, /pending traía documentación pendiente de
    empresas LEGACY_INACTIVE/INACTIVE/ONBOARDING también — confirmado contra
    datos reales que eran más de la mitad del volumen mostrado."""
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    client.get("/api/v1/compliance-records/pending")

    query = pool.fetch.call_args.args[0]
    args = pool.fetch.call_args.args
    assert "c.operational_status = $8" in query
    assert args[8] == "ACTIVE"


def test_pending_sin_estado_se_comporta_igual_que_antes():
    """El default es `falta` para que ningun llamador actual cambie de
    comportamiento. El cajon, el embudo y la exportacion piden /pending sin
    parametro y tienen que seguir viendo lo mismo."""
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    client.get("/api/v1/compliance-records/pending")

    sql = pool.fetch.call_args.args[0]
    assert "$10" in sql, "el estado tiene que viajar como parametro, no interpolado"
    assert pool.fetch.call_args.args[10] == "falta"


def test_pending_estado_falta_arma_el_mismo_predicado_que_pendiente():
    """El AsyncMock nunca ejecuta el SQL: un ELSE true en el CASE del estado
    pasa `test_pending_sin_estado_se_comporta_igual_que_antes` igual, porque
    ese test solo mira el argumento que viaja, no lo que la base haria con el.
    Este chequea el texto del CASE, que es lo unico que un mock puede
    verificar sin tocar Postgres."""
    from app.routers.compliance import _PENDING_ROWS_SQL, pendiente_predicate

    rama = _PENDING_ROWS_SQL.split("CASE $10::text")[1].split("END")[0]
    assert f"ELSE {pendiente_predicate('cr')}" in rama, (
        "el default de 'estado' dejo de armar el mismo predicado que 'pendiente'; "
        "es el desfase que ya tuvo este modulo entre el embudo y el cajon"
    )


def test_pending_con_estado_todos_no_filtra():
    """Es lo que hace posible la ficha: ver lo que la empresa TIENE, no solo lo
    que le falta. Hoy los 23 documentos cargados de la unica empresa con
    documentacion no aparecen en ninguna pantalla del modulo."""
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    client.get("/api/v1/compliance-records/pending?estado=todos")

    assert pool.fetch.call_args.args[10] == "todos"


def test_pending_rechaza_un_estado_inventado():
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/pending?estado=cualquiera")

    assert res.status_code == 422


def test_el_sql_de_pending_bindea_exactamente_lo_que_referencia():
    """El SQL pasa de 9 a 10 placeholders. Un $n de mas o de menos no falla al
    desplegar: asyncpg tira un error de binding en la primera consulta real."""
    import re
    from app.routers.compliance import _PENDING_ROWS_SQL

    referenciados = {int(n) for n in re.findall(r"\$(\d+)", _PENDING_ROWS_SQL)}
    assert referenciados == set(range(1, 11)), (
        f"el SQL referencia {sorted(referenciados)}; se esperaban 1..10"
    )


def test_carrier_status_filters_by_active_but_not_only():
    """Antes /pending-summary excluia a secas las no ACTIVE. Ahora el filtro es
    'activa O con documentos esperando': una empresa inactiva con archivos en la
    cola tiene que aparecer, porque si no la lista contradice a la bandeja."""
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    client.get("/api/v1/compliance-records/status")

    query = pool.fetch.call_args.args[0]
    args = pool.fetch.call_args.args
    # El estado dejo de ser un valor suelto y paso a ser un conjunto: ONBOARDING
    # tambien esta "en juego" (una empresa recien creada sin RUT queda ahi).
    assert "e.operational_status = ANY($1)" in query
    assert "COALESCE(d.unclassified, 0) > 0" in query
    assert args[1] == ["ACTIVE", "ONBOARDING"]


def test_bulk_upload_422_when_files_and_record_ids_length_mismatch():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.post(
        "/api/v1/compliance-records/bulk-file",
        data={"carrier_id": "c1", "record_ids": ["r1", "r2"]},
        files=[("files", ("a.pdf", b"x", "application/pdf"))],
    )

    assert res.status_code == 422


def test_bulk_upload_422_when_empty():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.post(
        "/api/v1/compliance-records/bulk-file",
        data={"carrier_id": "c1"},
    )

    assert res.status_code == 422


def test_bulk_upload_422_when_over_max_files():
    pool = AsyncMock()
    client = make_client(pool)
    n = 31
    res = client.post(
        "/api/v1/compliance-records/bulk-file",
        data={"carrier_id": "c1", "record_ids": [f"r{i}" for i in range(n)]},
        files=[("files", (f"a{i}.pdf", b"x", "application/pdf")) for i in range(n)],
    )

    assert res.status_code == 422


def test_bulk_upload_422_when_duplicate_record_ids():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.post(
        "/api/v1/compliance-records/bulk-file",
        data={"carrier_id": "c1", "record_ids": ["r1", "r1"]},
        files=[
            ("files", ("a.pdf", b"x", "application/pdf")),
            ("files", ("b.pdf", b"y", "application/pdf")),
        ],
    )

    assert res.status_code == 422


def test_bulk_upload_422_when_record_belongs_to_different_carrier():
    pool = AsyncMock()
    pool.fetch.return_value = [{"record_id": "r1", "resolved_carrier_id": "c2"}]
    client = make_client(pool)

    res = client.post(
        "/api/v1/compliance-records/bulk-file",
        data={"carrier_id": "c1", "record_ids": ["r1"]},
        files=[("files", ("a.pdf", b"x", "application/pdf"))],
    )

    assert res.status_code == 422
    assert "r1" in res.json()["detail"]


def test_bulk_upload_partial_failure_rejects_only_bad_file():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    pool.fetch.return_value = [
        {"record_id": "r1", "resolved_carrier_id": "c1"},
        {"record_id": "r2", "resolved_carrier_id": "c1"},
    ]
    pool.fetchrow.return_value = {
        "entity_id": "d1", "entity_type": "DRIVER", "status": "MISSING",
        "expiration_date": None, "metadata": {}, "expiration_policy": "NONE",
    }
    supabase = MagicMock()
    supabase.storage.from_.return_value.upload.return_value = None
    client = make_client(pool, supabase=supabase)

    res = client.post(
        "/api/v1/compliance-records/bulk-file",
        data={"carrier_id": "c1", "record_ids": ["r1", "r2"]},
        files=[
            ("files", ("licencia.pdf", b"contenido", "application/pdf")),
            ("files", ("virus.exe", b"MZ", "application/x-msdownload")),
        ],
    )

    assert res.status_code == 200
    body = res.json()
    assert len(body["uploaded"]) == 1
    assert body["uploaded"][0]["record_id"] == "r1"
    assert len(body["errors"]) == 1
    assert body["errors"][0]["record_id"] == "r2"


def test_list_compliance_files_404_when_record_missing():
    pool = AsyncMock()
    pool.fetchrow.return_value = None
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/r1/files")

    assert res.status_code == 404


def test_list_compliance_files_uses_synthetic_doc_name():
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "entity_id": "c1", "entity_type": "CARRIER", "status": "MISSING",
        "expiration_date": None, "file_url": None, "updated_at": None, "overridden_by": None,
    }
    pool.fetch.return_value = []
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/r1/files")

    assert res.status_code == 200
    assert res.json() == []
    fetch_call = pool.fetch.call_args
    assert fetch_call.args[3] == "compliance_record:r1"


def test_list_compliance_files_includes_current_version_never_replaced():
    """Bug real corregido 2026-07-21 (detectado en vivo por Fabián el 20/07):
    un documento subido una sola vez, nunca reemplazado, no aparecía en su
    propio historial pese a tener un archivo real cargado."""
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "entity_id": "c1", "entity_type": "CARRIER", "status": "APPROVED_MANUAL",
        "expiration_date": None, "file_url": "carrier/c1/r1/x.pdf",
        "updated_at": None, "overridden_by": "user-1",
    }
    pool.fetch.return_value = []  # sin reemplazos en audit_log
    supabase = MagicMock()
    supabase.storage.from_.return_value.create_signed_url.return_value = {"signedURL": "https://signed.example/current"}
    client = make_client(pool, supabase=supabase)

    res = client.get("/api/v1/compliance-records/r1/files")

    assert res.status_code == 200
    body = res.json()
    assert len(body) == 1
    assert body[0]["storage_path"] == "carrier/c1/r1/x.pdf"
    assert body[0]["is_current"] is True
    assert body[0]["url"] == "https://signed.example/current"


# ── expiration_date en el upload (HU-02) ───────────────────────────────────
# Antes de esto el upload solo escribia status/file_url/metadata: un documento
# cargado quedaba con expiration_date NULL y, como /pending filtra por status,
# desaparecia de pendientes para siempre aunque el papel real venciera.

def test_upload_persists_expiration_date_when_provided():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    pool.fetchrow.return_value = {
        "entity_id": "c1", "entity_type": "CARRIER", "status": "MISSING",
        "expiration_date": None, "metadata": {}, "expiration_policy": "NONE",
    }
    supabase = MagicMock()
    supabase.storage.from_.return_value.upload.return_value = None
    client = make_client(pool, supabase=supabase)

    res = client.post(
        "/api/v1/compliance-records/r1/file",
        files={"file": ("poliza.pdf", b"contenido", "application/pdf")},
        data={"expiration_date": "2027-03-31"},
    )

    assert res.status_code == 201
    update_call = conn.execute.call_args_list[0]
    assert "expiration_date" in update_call.args[0]
    assert date(2027, 3, 31) in update_call.args


def test_upload_without_expiration_date_leaves_it_untouched():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    pool.fetchrow.return_value = {
        "entity_id": "c1", "entity_type": "CARRIER", "status": "MISSING",
        "expiration_date": None, "metadata": {}, "expiration_policy": "NONE",
    }
    supabase = MagicMock()
    supabase.storage.from_.return_value.upload.return_value = None
    client = make_client(pool, supabase=supabase)

    res = client.post(
        "/api/v1/compliance-records/r1/file",
        files={"file": ("contrato.pdf", b"contenido", "application/pdf")},
    )

    assert res.status_code == 201
    # COALESCE preserva la fecha ya declarada cuando el upload no trae una.
    assert "COALESCE" in conn.execute.call_args_list[0].args[0].upper()


# Nota: el catálogo de requisitos (GET /compliance-requirements) y sus
# condiciones configurables viven en app/routers/requirements.py — ver
# tests/test_requirements.py.

# La misma lista, agrupada por el objeto que uno quiere mirar. Un conductor o un
# vehiculo sin la empresa a la que pertenece no dice nada: la fila la trae.
def test_status_groups_by_driver_and_carries_its_carrier():
    pool = AsyncMock()
    pool.fetch.return_value = [_carrier_status_row(
        entity_id="d1", entity_name="Juan Pérez",
        carrier_id="c1", carrier_name="Transportes Sur Spa",
        total_count=5, satisfied_count=2, pending_count=3,
    )]
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/status?group=driver")

    assert res.status_code == 200
    fila = res.json()["rows"][0]
    assert fila["entity_name"] == "Juan Pérez"
    assert fila["carrier_name"] == "Transportes Sur Spa"
    query = pool.fetch.call_args.args[0]
    assert "public.drivers" in query


def test_status_groups_by_asset():
    pool = AsyncMock()
    pool.fetch.return_value = [_carrier_status_row(
        entity_id="a1", entity_name="HKXW55", carrier_name="Rios Ltda",
    )]
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/status?group=asset")

    assert res.status_code == 200
    assert res.json()["rows"][0]["entity_name"] == "HKXW55"
    assert "public.assets" in pool.fetch.call_args.args[0]


def test_status_rejects_unknown_grouping():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/status?group=galaxias")

    assert res.status_code == 422


def test_status_counts_unclassified_with_the_same_predicate_as_the_tray():
    """Una sola definición de "sin clasificar" para las dos consultas.

    Convivían dos: la cola de la bandeja miraba NOT IN ('COMMITTED','DISCARDED')
    y este conteo seguía en = 'UNMATCHED'. Coincidían por accidente, porque
    nadie escribe AUTO/SUGGESTED todavía. En cuanto se conecte
    `document_matcher.py`, esta pestaña diría "0 sin clasificar" para una
    empresa cuya bandeja muestra 12.
    """
    from app.schemas.document_ingest import unclassified_predicate

    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    client.get("/api/v1/compliance-records/status")

    query = pool.fetch.call_args.args[0]
    assert unclassified_predicate("i") in query
    assert "match_status = 'UNMATCHED'" not in query


def test_status_only_counts_unclassified_when_grouping_by_carrier():
    """Los documentos sin clasificar pertenecen a una empresa, no a un
    conductor: en las otras agrupaciones la columna no aplica."""
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    client.get("/api/v1/compliance-records/status?group=driver")

    assert "document_ingest_items" not in pool.fetch.call_args.args[0]


def test_status_never_orders_by_a_literal():
    """BUG REAL (2026-08-15, encontrado corriendo el SQL contra la base): al
    agrupar por conductor/vehiculo la columna de sin clasificar es el literal 0,
    y 'ORDER BY 0' Postgres lo interpreta como POSICION ordinal — la consulta
    reventaba con 42P10. Los AsyncMock no lo ven porque nunca ejecutan el SQL."""
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    for grupo in ("driver", "asset"):
        client.get(f"/api/v1/compliance-records/status?group={grupo}")
        orden = pool.fetch.call_args.args[0].split("ORDER BY")[1]
        assert not orden.strip().startswith("0")


def test_status_binds_exactly_the_parameters_it_references():
    """BUG REAL (2026-08-15): agrupando por conductor el SQL no referenciaba $1
    pero se seguian pasando 3 parametros, y Postgres rechaza la sentencia. Los
    AsyncMock nunca lo ven — aceptan cualquier cantidad de argumentos — asi que
    la unica defensa barata es contar los placeholders contra los argumentos."""
    import re

    for grupo in ("carrier", "driver", "asset"):
        pool = AsyncMock()
        pool.fetch.return_value = []
        client = make_client(pool)

        client.get(f"/api/v1/compliance-records/status?group={grupo}")

        sql, *args = pool.fetch.call_args.args
        referenciados = {int(n) for n in re.findall(r"\$(\d+)", sql)}
        assert referenciados == set(range(1, len(args) + 1)), (
            f"group={grupo}: el SQL referencia {sorted(referenciados)} "
            f"pero se pasan {len(args)} parametros"
        )


# ── Tramo 2, Tarea 3: lo que el embudo de certificacion necesita ───────────

def test_status_returns_the_funnel_fields_per_carrier():
    """El embudo (§4 del spec) agrupa por etapa, no por "cuanto le falta": las
    39 activas tienen el mismo denominador y entre 1 y 3 documentos cubiertos,
    asi que ordenar por completitud no discrimina nada."""
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    client.get("/api/v1/compliance-records/status")

    sql = pool.fetch.call_args.args[0]
    for campo in ("expired_count", "management_types", "trips_30d", "funnel_group"):
        assert campo in sql, f"falta {campo} en el SQL del embudo"


def test_status_funnel_group_is_decided_in_sql():
    """Los grupos salen de UNA definicion. Calcularlos en el frontend obligaria
    a repetir el criterio en el conteo del encabezado y en el orden, que es
    exactamente como divergen dos superficies del mismo dato."""
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    client.get("/api/v1/compliance-records/status")

    sql = pool.fetch.call_args.args[0]
    assert "CASE" in sql and "funnel_group" in sql


def test_status_expired_counts_by_date_not_only_by_status():
    """Un registro vencido puede estar en EXPIRED o tener expiration_date
    pasada sin que nadie haya corrido el recalculo. Las dos cuentan."""
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    client.get("/api/v1/compliance-records/status")

    sql = pool.fetch.call_args.args[0]
    assert "expiration_date" in sql and "CURRENT_DATE" in sql


def test_status_management_types_prefers_the_fleet_over_the_declared():
    """La flota manda cuando existe (36 de 39 empresas); lo declarado en el
    alta cubre a las 3 que todavia no tienen vehiculos.

    Esa preferencia ya NO se escribe aca: vive en
    public.carrier_management_types() (migracion 20260816050000), la unica
    definicion del concepto, y la llaman tambien las cuatro ramas CARRIER de
    siembra y la vista previa del recalcular. Tenerla escrita dos veces era
    el defecto C1: la pantalla mostraba la gestion derivada de la flota
    mientras la condicion nueva evaluaba solo la columna declarada, que esta
    vacia."""
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    client.get("/api/v1/compliance-records/status")

    sql = pool.fetch.call_args.args[0]
    assert "public.carrier_management_types(c.id)" in sql
    assert "COALESCE(g.operation_types, e.management_types)" not in sql


def test_status_trips_join_uses_fleet_link_id():
    """app.trips se une por fleet_link_id -> trip_fleet_links.id. NO existe
    trips.trip_id: escribirlo asi hace que Postgres rechace la sentencia."""
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    client.get("/api/v1/compliance-records/status")

    sql = pool.fetch.call_args.args[0]
    assert "fleet_link_id" in sql
    assert "t.trip_id" not in sql


def test_status_catalog_scope_is_the_complement_of_the_active_one():
    """'Resto del catalogo' son 209 empresas y no caben junto a las activas en
    el limite de 200, asi que se piden aparte. Los dos alcances tienen que ser
    disjuntos y exhaustivos: si no, una empresa queda invisible o contada dos
    veces."""
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    def where_de(sql):
        # El CASE del embudo tambien contiene "NOT (", asi que mirar el SQL
        # entero no probaria nada: hay que aislar el WHERE.
        cuerpo = sql.split("FROM public.carriers e", 1)[1]
        return cuerpo.split("WHERE", 1)[1].split("GROUP BY", 1)[0]

    client.get("/api/v1/compliance-records/status?scope=catalog")
    where_catalogo = where_de(pool.fetch.call_args.args[0])

    client.get("/api/v1/compliance-records/status")
    where_activo = where_de(pool.fetch.call_args.args[0])

    assert where_catalogo.strip().startswith("NOT ")
    # Complemento exacto: el mismo predicado negado, no un criterio reescrito
    # a mano que pueda divergir.
    assert where_activo.strip() in where_catalogo


def test_status_funnel_fields_absent_when_grouping_by_driver():
    """El embudo es de empresas. Un conductor no tiene etapa de certificacion
    propia, y devolver el campo en null invitaria a dibujarlo igual."""
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    client.get("/api/v1/compliance-records/status?group=driver")

    sql = pool.fetch.call_args.args[0]
    assert "trips_30d" not in sql
    assert "funnel_group" not in sql


def test_status_binds_every_placeholder_in_every_scope():
    """Mismo guardarrail que test_status_binds_exactly_the_parameters_it_
    references, extendido al alcance nuevo: agregar un filtro y olvidar el
    parametro es como se rompio esto la vez anterior."""
    import re

    for url in (
        "/api/v1/compliance-records/status?scope=catalog",
        "/api/v1/compliance-records/status?scope=catalog&q=sur",
        "/api/v1/compliance-records/status?scope=active&carrier_id=c1",
    ):
        pool = AsyncMock()
        pool.fetch.return_value = []
        client = make_client(pool)

        client.get(url)

        sql, *args = pool.fetch.call_args.args
        referenciados = {int(n) for n in re.findall(r"\$(\d+)", sql)}
        assert referenciados == set(range(1, len(args) + 1)), (
            f"{url}: el SQL referencia {sorted(referenciados)} "
            f"pero se pasan {len(args)} parametros"
        )


# ── Tramo 2, Tarea 4: cuarta agrupacion, por requisito ─────────────────────

def test_status_groups_by_requirement():
    """D2: por requisito es la agrupacion secundaria — responde "que tipo de
    documento falta mas", que por empresa no se ve."""
    pool = AsyncMock()
    pool.fetch.return_value = [{
        "entity_id": "req-1", "entity_name": "Licencia de Conducir",
        "carrier_id": None, "carrier_name": None, "operational_status": None,
        "total_count": 80, "satisfied_count": 3, "pending_count": 77,
        "pending_mandatory": 77, "unclassified_count": 0,
    }]
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/status?group=requirement")

    assert res.status_code == 200
    assert res.json()["rows"][0]["entity_name"] == "Licencia de Conducir"
    sql = pool.fetch.call_args.args[0]
    assert "compliance_requirements e" in sql
    assert "a.requirement_id = e.id" in sql


def test_status_by_requirement_looks_at_the_same_universe_as_by_carrier():
    """El conmutador de agrupacion NO crea vistas nuevas (spec §4): las cuatro
    miran los mismos pendientes agrupados distinto. Verificado contra la base:
    424 CARRIER + 939 DRIVER + 997 ASSET = 2.360, el mismo total que devuelve
    la agrupacion por empresa. Si esta no filtrara por empresa activa daria
    4.895 y cambiar de pestaña cambiaria el total sin explicacion."""
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    client.get("/api/v1/compliance-records/status?group=requirement")

    sql = pool.fetch.call_args.args[0]
    assert "operational_status = $1" in sql


def test_status_by_requirement_has_no_carrier_and_no_funnel():
    """Un requisito cruza todas las empresas: no tiene una sola empresa ni una
    etapa de certificacion propia."""
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    client.get("/api/v1/compliance-records/status?group=requirement")

    sql = pool.fetch.call_args.args[0]
    assert "NULL::text AS carrier_id" in sql
    assert "funnel_group" not in sql
    assert "trips_30d" not in sql


def test_status_by_requirement_binds_every_placeholder():
    import re

    for url in (
        "/api/v1/compliance-records/status?group=requirement",
        "/api/v1/compliance-records/status?group=requirement&q=licencia",
        "/api/v1/compliance-records/status?group=requirement&carrier_id=c1",
    ):
        pool = AsyncMock()
        pool.fetch.return_value = []
        client = make_client(pool)

        client.get(url)

        sql, *args = pool.fetch.call_args.args
        referenciados = {int(n) for n in re.findall(r"\$(\d+)", sql)}
        assert referenciados == set(range(1, len(args) + 1)), (
            f"{url}: el SQL referencia {sorted(referenciados)} "
            f"pero se pasan {len(args)} parametros"
        )


# ── HU-03: corregir un documento cargado en el lugar equivocado ─────────────

def _record_with_file(record_id="rec-1", **over):
    row = {
        "id": record_id, "entity_type": "ASSET", "entity_id": "a1",
        "status": "APPROVED_MANUAL", "expiration_date": None,
        "file_url": "staging/b1/x.png",
        "metadata": {"file_name": "x.png", "mime_type": "image/png", "size_bytes": 9},
    }
    row.update(over)
    return row


def test_reassign_moves_the_file_to_another_requirement():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    # 1) el registro origen, 2) el registro destino, 3) lo que lee _apply_stored_document
    conn.fetchrow.side_effect = [
        _record_with_file(),
        {"id": "rec-2", "entity_id": "a1", "entity_type": "ASSET", "status": "MISSING", "expiration_date": None},
        {"metadata": {}, "expiration_date": None},
    ]
    client = make_client(pool)

    res = client.post("/api/v1/compliance-records/rec-1/reassign", json={
        "target_entity_type": "ASSET", "target_entity_id": "a1",
        "target_requirement_id": "req-2",
    })

    assert res.status_code == 200
    todo_sql = " ".join(str(c.args[0]) for c in conn.execute.call_args_list)
    # El origen queda sin archivo y vuelve a faltar.
    assert "file_url = NULL" in todo_sql
    assert "MISSING" in todo_sql


def test_reassign_never_deletes_the_blob():
    """El archivo es lo unico irrecuperable: reasignar mueve la referencia, no
    toca storage."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.side_effect = [
        _record_with_file(),
        {"id": "rec-2", "entity_id": "d1", "entity_type": "DRIVER", "status": "MISSING", "expiration_date": None},
        {"metadata": {}, "expiration_date": None},
    ]
    supabase = MagicMock()
    client = make_client(pool, supabase=supabase)

    client.post("/api/v1/compliance-records/rec-1/reassign", json={
        "target_entity_type": "DRIVER", "target_entity_id": "d1",
        "target_requirement_id": "req-9",
    })

    supabase.storage.from_.return_value.remove.assert_not_called()


def test_reassign_to_tray_returns_it_unclassified():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.side_effect = [_record_with_file()]
    conn.fetchval.return_value = "batch-9"
    client = make_client(pool)

    res = client.post("/api/v1/compliance-records/rec-1/reassign", json={"to_tray": True})

    assert res.status_code == 200
    todo_sql = " ".join(str(c.args[0]) for c in conn.execute.call_args_list)
    assert "document_ingest_items" in todo_sql
    assert "UNMATCHED" in todo_sql


def test_reassign_to_tray_lleva_el_hash_del_archivo():
    """El item que vuelve a la bandeja tiene que entrar con su `content_sha256`.

    Sin el, `mismo_contenido` no puede ver el caso destructivo: un archivo
    devuelto a la bandeja y su gemelo byte a byte recien subido se listaban los
    dos como "sin colision" y nada iba a poder detectarlo nunca. El hash sale
    del blob que YA esta en storage — es una operacion manual y de a un
    archivo, y leerlo ahi funciona tambien para los items historicos, que no
    tienen el hash guardado en ninguna parte.
    """
    import hashlib

    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.side_effect = [_record_with_file()]
    conn.fetchval.return_value = "batch-9"
    supabase = MagicMock()
    supabase.storage.from_.return_value.download.return_value = b"contenido"
    client = make_client(pool, supabase)

    res = client.post("/api/v1/compliance-records/rec-1/reassign", json={"to_tray": True})

    assert res.status_code == 200, res.text
    insert = next(
        c for c in conn.execute.call_args_list
        if "document_ingest_items" in str(c.args[0])
    )
    assert "content_sha256" in insert.args[0]
    assert hashlib.sha256(b"contenido").hexdigest() in insert.args


def test_reassign_to_tray_sin_poder_leer_el_blob_no_inventa_un_hash():
    """Si el blob no se puede leer, el item entra con el hash en NULL — que es
    "no lo se" y hace que la pantalla se calle— y la reasignacion NO falla:
    mover la referencia de un documento mal asignado importa mas que la
    senal de colision."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.side_effect = [_record_with_file()]
    conn.fetchval.return_value = "batch-9"
    supabase = MagicMock()
    supabase.storage.from_.return_value.download.side_effect = Exception("no existe")
    client = make_client(pool, supabase)

    res = client.post("/api/v1/compliance-records/rec-1/reassign", json={"to_tray": True})

    assert res.status_code == 200, res.text
    insert = next(
        c for c in conn.execute.call_args_list
        if "document_ingest_items" in str(c.args[0])
    )
    assert insert.args[-1] is None


def test_reassign_requires_a_destination():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.post("/api/v1/compliance-records/rec-1/reassign", json={})

    assert res.status_code == 422


def test_reassign_fails_when_the_record_has_no_file():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.side_effect = [_record_with_file(file_url=None)]
    client = make_client(pool)

    res = client.post("/api/v1/compliance-records/rec-1/reassign", json={"to_tray": True})

    assert res.status_code == 422


def test_status_can_be_scoped_to_one_carrier():
    """El panel de detalle usa la MISMA consulta que la lista, acotada a la
    empresa: asi el "N de M" de un conductor es identico desde los dos lados."""
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    client.get("/api/v1/compliance-records/status?group=driver&carrier_id=c1")

    sql, *args = pool.fetch.call_args.args
    assert "asg.carrier_id" in sql
    assert "c1" in args


def test_status_scoped_to_carrier_still_binds_every_placeholder():
    """Mismo control que el resto: agregar el filtro no puede dejar un \$n
    sin argumento."""
    import re

    for grupo in ("carrier", "driver", "asset"):
        pool = AsyncMock()
        pool.fetch.return_value = []
        client = make_client(pool)

        client.get(f"/api/v1/compliance-records/status?group={grupo}&carrier_id=c1")

        sql, *args = pool.fetch.call_args.args
        referenciados = {int(n) for n in re.findall(r"\$(\d+)", sql)}
        assert referenciados == set(range(1, len(args) + 1)), (
            f"group={grupo}: el SQL referencia {sorted(referenciados)} "
            f"pero se pasan {len(args)} parametros"
        )


def test_status_active_scope_includes_newly_created_companies():
    """REGRESION (revision de rama, 2026-08-15): una empresa creada SIN RUT
    queda en ONBOARDING —lo hace el propio validador de CarrierCreateBody— y
    ONBOARDING no es ACTIVE, asi que caia en "Resto del catalogo": plegado, al
    fondo, detras de 209 empresas. Es exactamente el flujo para el que se
    construyo el embudo, y la empresa nueva terminaba donde nadie la ve.

    NewCarrierPanel ofrece crear sin RUT de forma explicita ("Se creara en
    estado Onboarding, pendiente de RUT")."""
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    client.get("/api/v1/compliance-records/status")

    sql, *args = pool.fetch.call_args.args
    assert "ONBOARDING" in sql or "ANY($1" in sql, (
        "el alcance activo tiene que incluir a las empresas recien creadas"
    )


# ── GET /compliance-records/summary (Task 2, perf/compresion-y-resumen) ────
#
# La ficha de empresa mostraba nueve cabeceras plegadas y descargaba 457 filas
# de detalle para dibujarlas (medido en dev: 57.183 bytes). Este endpoint
# agrupa lo mismo que `/pending?estado=todos` ya calcula, para que la ficha
# pida un resumen al llegar y el detalle de cada sujeto recien al desplegarlo.
#
# NO define una segunda vez que es "pendiente" o "al dia": reusa
# `_PENDING_ROWS_SQL` como CTE y agrupa sobre `urgencia`, que ya trae sus
# cuatro ramas resueltas por el SQL (ver `pendiente_predicate` mas arriba).


def test_summary_binds_exactly_the_parameters_it_references():
    """Misma defensa que /pending: un placeholder de mas o de menos lo acepta
    un AsyncMock y lo rechaza Postgres."""
    import re

    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    client.get("/api/v1/compliance-records/summary?carrier_id=c1")

    sql, *args = pool.fetch.call_args.args
    referenciados = {int(n) for n in re.findall(r"\$(\d+)", sql)}
    assert referenciados == set(range(1, len(args) + 1)), (
        f"el SQL referencia {sorted(referenciados)} pero se pasan {len(args)} parametros"
    )


def test_summary_no_reescribe_pendiente_predicate():
    """El agrupado tiene que salir de `urgencia`/`pendiente_predicate`, no de
    una lista de status escrita a mano dentro de `_SUMMARY_SQL` — es la misma
    clase de bug que este modulo ya tuvo con el embudo y el cajon
    contradiciendose."""
    from app.routers.compliance import _PENDING_ROWS_SQL, _SUMMARY_SQL

    assert _PENDING_ROWS_SQL in _SUMMARY_SQL
    assert "MISSING" not in _SUMMARY_SQL.replace(_PENDING_ROWS_SQL, "")
    assert "EXPIRED" not in _SUMMARY_SQL.replace(_PENDING_ROWS_SQL, "")


def test_summary_requiere_carrier_id():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/summary")

    assert res.status_code == 422


def test_summary_route_does_not_collide_with_record_id_path():
    """Mismo cuidado que /pending: /summary tiene que declararse antes de
    /{record_id}, o FastAPI lo interpreta como un record_id literal."""
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/summary?carrier_id=c1")

    assert res.status_code == 200
    assert "totales" in res.json()
    pool.fetchrow.assert_not_called()


def test_summary_agrupa_por_sujeto_desde_urgencia():
    """La particion que la ficha necesita: `al_dia`, `por_vencer` y `falta`
    salen de la MISMA `urgencia` de cada fila — no una cuenta nueva por
    `status`. `falta` agrupa VENCIDO y FALTA (las dos ramas que la ficha ya
    muestra como "lo que falta"), para que la particion cierre exacto contra
    `todos`."""
    pool = AsyncMock()
    pool.fetch.return_value = [
        {"entity_type": "CARRIER", "entity_id": "c1", "subject_name": None,
         "todos": 3, "al_dia": 1, "por_vencer": 1, "falta": 1,
         "carrier_operation_types": ["Tractoreo"],
         "asset_type": None, "fleet_service_type_label": None,
         "fleet_service_type_bg_color": None, "fleet_service_type_text_color": None},
    ]
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/summary?carrier_id=c1")

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["sujetos"] == [{
        "entity_type": "CARRIER", "entity_id": "c1", "subject_name": None,
        "todos": 3, "al_dia": 1, "por_vencer": 1, "falta": 1,
        # Nulos porque es la EMPRESA: el tipo de vehiculo no le aplica. Se
        # enumeran en vez de omitirse para que el test siga afirmando la
        # forma completa de la respuesta, que es lo que consume el frontend.
        "asset_type": None, "fleet_service_type_label": None,
        "fleet_service_type_bg_color": None, "fleet_service_type_text_color": None,
    }]
    assert body["totales"] == {"todos": 3, "al_dia": 1, "por_vencer": 1, "falta": 1}
    assert body["carrier_operation_types"] == ["Tractoreo"]
    assert body["completo"] is True


# Hallazgo 3 de la revision final: SUMMARY_LIMIT entra como LIMIT de la CTE,
# ANTES del GROUP BY. Si una empresa superara ese numero de registros, la
# CTE se corta a la mitad de una fila cualquiera y el agrupado -las cuatro
# cifras, sujeto por sujeto- queda mal, en silencio: no hay ninguna senal en
# la respuesta. La guarda `completa` que existia para esto se borro apoyada
# en la afirmacion de que "el resumen nunca viene truncado", que es falsa
# (hoy la empresa mas grande tiene 457 filas contra un tope de 5000: latente,
# no activo). `completo` la repone: sale de comparar el conteo real contra
# el tope, no de una consulta aparte.
def test_summary_completo_false_cuando_el_conteo_toca_el_tope():
    from app.routers.compliance import SUMMARY_LIMIT

    pool = AsyncMock()
    # Tantas filas como el tope: es exactamente lo que la CTE devuelve cuando
    # el LIMIT la corto, no cuando la empresa de verdad tiene ese numero
    # redondo de requisitos.
    pool.fetch.return_value = [
        {"entity_type": "CARRIER", "entity_id": "c1", "subject_name": None,
         "todos": SUMMARY_LIMIT, "al_dia": SUMMARY_LIMIT, "por_vencer": 0, "falta": 0,
         "carrier_operation_types": [],
         "asset_type": None, "fleet_service_type_label": None,
         "fleet_service_type_bg_color": None, "fleet_service_type_text_color": None},
    ]
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/summary?carrier_id=c1")

    assert res.status_code == 200, res.text
    assert res.json()["completo"] is False


def test_summary_completo_true_cuando_el_conteo_no_toca_el_tope():
    pool = AsyncMock()
    pool.fetch.return_value = [
        {"entity_type": "CARRIER", "entity_id": "c1", "subject_name": None,
         "todos": 3, "al_dia": 1, "por_vencer": 1, "falta": 1,
         "carrier_operation_types": [],
         "asset_type": None, "fleet_service_type_label": None,
         "fleet_service_type_bg_color": None, "fleet_service_type_text_color": None},
    ]
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/summary?carrier_id=c1")

    assert res.status_code == 200, res.text
    assert res.json()["completo"] is True


async def _pedir_resumen(conn, carrier_id):
    """El resumen, llamando al handler real sobre la conexion transaccional
    del fixture — mismo patron que `list_pending_compliance_records` en
    `test_integracion_certificacion.py`, no uno inventado para esta prueba."""
    from app.routers.compliance import get_compliance_summary

    return await get_compliance_summary(
        carrier_id=str(carrier_id), pool=PoolDeUnaConexion(conn), _=USER,
    )


async def _pedir_pending(conn, carrier_id, estado="todos", limit=500):
    from app.routers.compliance import list_pending_compliance_records

    respuesta = await list_pending_compliance_records(
        carrier_id=str(carrier_id), category=None, requirement_code=None, q="",
        operation_type=None, entity_id=None, limit=limit, offset=0, estado=estado,
        pool=PoolDeUnaConexion(conn), _=USER,
    )
    return respuesta["rows"]


@pytest.mark.integracion
async def test_el_resumen_cuadra_con_las_filas_que_devuelve_pending(conexion_revertida):
    """El resumen tiene que contar EXACTAMENTE lo mismo que la lista, o la
    pantalla dice un numero y muestra otro — que es el defecto que esta ficha
    ya tuvo cuando el filtro y la fila se contradecian.

    Que la particion cierre (al_dia + por_vencer + falta == todos) NO
    ALCANZA: un intercambio de columnas en `_SUMMARY_SQL` (al_dia por falta,
    por ejemplo) deja esa suma cerrada igual —mismo total, columnas
    cambiadas de lugar— y pasaria en verde con un documento vencido
    mostrandose "al dia". Por eso cada balde se compara contra Postgres real
    para ESE estado, no solo contra el total.

    `falta` es la excepcion: `/pending?estado=falta` usa
    `pendiente_predicate`, que es "no esta al dia" e INCLUYE lo por vencer
    -es lo que el filtro de la ficha necesita, para no esconder un sujeto
    cuyo unico pendiente es un "por vencer" (ver `tieneAlgoDelEstado` en el
    frontend)-, mientras que `resumen.totales.falta` es el balde EXCLUSIVO
    (FALTA + VENCIDO, sin por_vencer) que hace que la particion cierre. Se
    verifica entonces contra la particion de `filas` (estado='todos'), no
    contra `/pending?estado=falta` -son dos conjuntos distintos a proposito.
    """
    carrier_id = await conexion_revertida.fetchval(
        "SELECT carrier_id FROM public.driver_assignments WHERE status='ACTIVE' LIMIT 1"
    )
    resumen = await _pedir_resumen(conexion_revertida, carrier_id)
    filas = await _pedir_pending(conexion_revertida, carrier_id, estado="todos", limit=1000)

    assert resumen["totales"]["todos"] == len(filas)
    assert sum(s["todos"] for s in resumen["sujetos"]) == len(filas)
    t = resumen["totales"]
    assert t["al_dia"] + t["por_vencer"] + t["falta"] == t["todos"]

    # Cada balde contra Postgres real, no solo la suma.
    filas_al_dia = await _pedir_pending(conexion_revertida, carrier_id, estado="al_dia", limit=1000)
    filas_por_vencer = await _pedir_pending(conexion_revertida, carrier_id, estado="por_vencer", limit=1000)
    filas_falta = [f for f in filas if f["urgencia"] in ("FALTA", "VENCIDO")]
    assert t["al_dia"] == len(filas_al_dia), (
        f"el resumen dice {t['al_dia']} al_dia y /pending?estado=al_dia devuelve {len(filas_al_dia)}"
    )
    assert t["por_vencer"] == len(filas_por_vencer), (
        f"el resumen dice {t['por_vencer']} por_vencer y /pending?estado=por_vencer "
        f"devuelve {len(filas_por_vencer)}"
    )
    assert t["falta"] == len(filas_falta), (
        f"el resumen dice {t['falta']} falta y la particion de 'todos' por urgencia da {len(filas_falta)}"
    )

    # Y lo mismo por sujeto: que cada cabecera cuadre con SUS filas, no sólo
    # el agregado de la empresa entera.
    def _por_sujeto(rows):
        conteo: dict[tuple, int] = {}
        for r in rows:
            clave = (r["entity_type"], r["entity_id"])
            conteo[clave] = conteo.get(clave, 0) + 1
        return conteo

    al_dia_por_sujeto = _por_sujeto(filas_al_dia)
    por_vencer_por_sujeto = _por_sujeto(filas_por_vencer)
    falta_por_sujeto = _por_sujeto(filas_falta)
    for s in resumen["sujetos"]:
        clave = (s["entity_type"], s["entity_id"])
        assert s["al_dia"] == al_dia_por_sujeto.get(clave, 0), f"sujeto {clave}: al_dia no cuadra"
        assert s["por_vencer"] == por_vencer_por_sujeto.get(clave, 0), f"sujeto {clave}: por_vencer no cuadra"
        assert s["falta"] == falta_por_sujeto.get(clave, 0), f"sujeto {clave}: falta no cuadra"
