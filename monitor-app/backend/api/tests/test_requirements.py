import json
import re
from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user, require_admin
from app.db import get_pool
from app.routers.requirements import requirements_router
from tests.conftest import USER, wire_transactional_conn


def make_client(pool):
    app = FastAPI()
    app.include_router(requirements_router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_admin] = lambda: USER
    return TestClient(app)


def make_client_without_admin_override(pool):
    """Sin overridear require_admin: ejercita la dependencia real, con
    USER (role 'editor') resuelto vía get_current_user. Sirve para probar
    que el rol se exige de verdad, no solo que el mock lo deja pasar."""
    app = FastAPI()
    app.include_router(requirements_router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: USER
    return TestClient(app)


# ── Catalogo de requisitos (GET /compliance-requirements) ──────────────────
# Lo consume el desplegable de clasificacion de la bandeja de sin clasificar.
# La tabla existia desde el inicio pero ningun endpoint la listaba.

def test_list_requirements_returns_catalog():
    pool = AsyncMock()
    pool.fetch.return_value = [{
        "id": "req-1", "target_entity": "DRIVER", "requirement_id": "req-1", "requirement_code": "LICENCIA_CONDUCIR",
        "name": "Licencia de Conducir", "requirement_level": "LEGAL_MANDATORY",
        "has_expiration": True, "is_active": True,
        "applies_to_fleet_service_type_ids": None, "applies_to_management_types": None,
    }]
    client = make_client(pool)

    res = client.get("/api/v1/compliance-requirements")

    assert res.status_code == 200
    body = res.json()
    assert body[0]["requirement_code"] == "LICENCIA_CONDUCIR"
    assert body[0]["has_expiration"] is True


def test_list_requirements_returns_current_conditions():
    """La pantalla de condiciones (Tramo 3, Task 5) necesita saber el estado
    ACTUAL de cada requisito para dibujarlo -- si esta vigente y a que
    subtipos/gestiones esta restringido -- no solo su nombre y nivel. Sin
    esto la pantalla no puede distinguir "sin restriccion" de "restringido
    a estos 2 subtipos", y mostraria todo como vigente y sin restriccion
    aunque la base diga lo contrario (ver MANTENCION_FRIO / SEGURO_EETT)."""
    pool = AsyncMock()
    pool.fetch.return_value = [{
        "id": "req-1", "target_entity": "ASSET", "requirement_id": "req-1", "requirement_code": "MANTENCION_FRIO",
        "name": "Mantención Cámara de Frío", "requirement_level": "CONDITIONAL_OPTIONAL",
        "has_expiration": True, "is_active": True,
        "applies_to_fleet_service_type_ids": ["ft-1", "ft-2"], "applies_to_management_types": None,
    }]
    client = make_client(pool)

    res = client.get("/api/v1/compliance-requirements")

    assert res.status_code == 200
    body = res.json()[0]
    assert body["is_active"] is True
    assert body["applies_to_fleet_service_type_ids"] == ["ft-1", "ft-2"]
    assert body["applies_to_management_types"] is None


def test_list_requirements_filters_by_target_entity():
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    res = client.get("/api/v1/compliance-requirements?target_entity=ASSET")

    assert res.status_code == 200
    assert "target_entity" in pool.fetch.call_args.args[0]
    assert "ASSET" in pool.fetch.call_args.args


def test_list_requirements_rejects_unknown_entity():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.get("/api/v1/compliance-requirements?target_entity=PERSONA")

    assert res.status_code == 422


# ── Condiciones configurables (PATCH /conditions) ───────────────────────────
# Guardar la regla y aplicarla son dos actos distintos: PATCH /conditions solo
# cambia el catalogo, GET /recalc-preview mira sin escribir, POST /recalc
# aplica.

def test_patch_conditions_rechaza_una_gestion_inventada():
    pool = AsyncMock()
    client = make_client(pool)
    res = client.patch("/api/v1/compliance-requirements/r1/conditions",
                       json={"applies_to_management_types": ["SIDER"]})
    assert res.status_code == 422


def test_patch_conditions_rejects_explicit_null_for_is_active():
    """Ronda de arreglo 2, punto 1: regresion del punto 1 de la ronda
    anterior. `is_active` es NOT NULL en la base -- ahi `null` explicito no
    es 'sacar la restriccion' (como en los otros dos campos), no significa
    nada. Sin este rechazo, `SET is_active = $2` con None llega a Postgres y
    explota como not_null_violation -> 500. El test pasa por el endpoint real
    (TestClient), no solo por el validador de Pydantic en aislado -- el
    hallazgo original fue justamente que un test de Pydantic solo no
    detectaba el 500 del endpoint."""
    pool = AsyncMock()
    client = make_client(pool)

    res = client.patch("/api/v1/compliance-requirements/r1/conditions",
                       json={"is_active": None})

    assert res.status_code == 422
    # nunca debe haber llegado a abrir una transaccion de escritura
    pool.acquire.assert_not_called()


def test_patch_conditions_rejects_mixed_types_in_fleet_service_type_ids():
    """Ronda de arreglo 2, punto 2: `normalize_nonempty_list` corria en
    mode="before" y `sorted()` reventaba con `TypeError` (no `ValueError`,
    que Pydantic v2 no convierte en 422) ante una lista de tipos mixtos --
    reproducido antes como 500 sin manejar. Movido a mode="after": Pydantic
    ya valido `list[str]` antes de que el normalizador corra, asi que el
    422 nativo de Pydantic pasa a cubrir este caso. Via TestClient, no solo
    contra el validador en aislado."""
    pool = AsyncMock()
    client = make_client(pool)

    res = client.patch("/api/v1/compliance-requirements/r1/conditions",
                       json={"applies_to_fleet_service_type_ids": [1, "a"]})

    assert res.status_code == 422
    pool.acquire.assert_not_called()


def test_patch_conditions_empty_list_resets_fleet_service_type_ids_to_null_not_500():
    """Ronda de arreglo 2, punto 5: sub-punto 1.e (el mismo reset a NULL,
    aplicado a applies_to_fleet_service_type_ids en vez de management_types)
    habia quedado sin test propio."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.side_effect = [
        {"id": "r1", "is_active": True,
         "applies_to_fleet_service_type_ids": ["f4ee2299-c2a7-4a4b-94c1-6d868ca1216b"],
         "applies_to_management_types": None},  # SELECT current
        {"id": "r1", "requirement_code": "MANTENCION_FRIO", "is_active": True,
         "applies_to_fleet_service_type_ids": None, "applies_to_management_types": None},  # UPDATE RETURNING
    ]
    client = make_client(pool)

    res = client.patch("/api/v1/compliance-requirements/r1/conditions",
                       json={"applies_to_fleet_service_type_ids": []})

    assert res.status_code == 200
    assert res.json()["applies_to_fleet_service_type_ids"] is None

    update_call = conn.fetchrow.call_args_list[1]
    update_sql = update_call.args[0]
    assert "applies_to_fleet_service_type_ids" in update_sql
    assert "COALESCE" not in update_sql
    assert update_call.args[-1] is None


def test_patch_conditions_empty_list_resets_condition_to_null_not_500():
    """Ronda de arreglo 1, punto 1: [] es una forma legitima de decir 'sin
    restriccion' (vuelve NULL), no una omision. Antes escribia '{}' y
    violaba el CHECK -> 500; ahora el UPDATE de ancho variable solo toca la
    columna enviada, con el valor normalizado (None) por placeholder."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.side_effect = [
        {"id": "r1", "is_active": True, "applies_to_fleet_service_type_ids": None,
         "applies_to_management_types": ["TRACTOREO"]},  # SELECT current (para el audit)
        {"id": "r1", "requirement_code": "MANTENCION_FRIO", "is_active": True,
         "applies_to_fleet_service_type_ids": None, "applies_to_management_types": None},  # UPDATE RETURNING
    ]
    client = make_client(pool)

    res = client.patch("/api/v1/compliance-requirements/r1/conditions",
                       json={"applies_to_management_types": []})

    assert res.status_code == 200
    assert res.json()["applies_to_management_types"] is None

    update_call = conn.fetchrow.call_args_list[1]
    update_sql = update_call.args[0]
    assert "applies_to_management_types" in update_sql
    assert "COALESCE" not in update_sql
    # el valor que se ligo por placeholder es el normalizado (None), no `[]`
    assert update_call.args[-1] is None


def test_patch_conditions_ignores_input_order_when_persisting():
    """El orden de entrada no cambia lo que se guarda: la normalizacion
    ordena canonicamente antes de que el valor llegue al placeholder."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.side_effect = [
        {"id": "r1", "is_active": True, "applies_to_fleet_service_type_ids": None,
         "applies_to_management_types": None},
        {"id": "r1", "requirement_code": "X", "is_active": True,
         "applies_to_fleet_service_type_ids": None,
         "applies_to_management_types": ["TRACTOREO", "EQUIPO_COMPLETO"]},
    ]
    client = make_client(pool)

    res = client.patch("/api/v1/compliance-requirements/r1/conditions",
                       json={"applies_to_management_types": ["EQUIPO_COMPLETO", "TRACTOREO", "TRACTOREO"]})

    assert res.status_code == 200
    update_call = conn.fetchrow.call_args_list[1]
    # orden canonico (TRACTOREO antes que EQUIPO_COMPLETO) y sin duplicado,
    # sin importar que el body haya llegado en otro orden y repetido
    assert update_call.args[-1] == ["TRACTOREO", "EQUIPO_COMPLETO"]


def test_patch_conditions_happy_path_returns_updated_row_and_audits_field():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.side_effect = [
        {"id": "r1", "is_active": True, "applies_to_fleet_service_type_ids": None,
         "applies_to_management_types": None},
        {"id": "r1", "requirement_code": "MANTENCION_FRIO", "is_active": False,
         "applies_to_fleet_service_type_ids": None, "applies_to_management_types": None},
    ]
    client = make_client(pool)

    res = client.patch("/api/v1/compliance-requirements/r1/conditions", json={"is_active": False})

    assert res.status_code == 200
    assert res.json() == {
        "id": "r1", "requirement_code": "MANTENCION_FRIO", "is_active": False,
        "applies_to_fleet_service_type_ids": None, "applies_to_management_types": None,
    }
    audit_calls = [c for c in conn.execute.call_args_list if "audit_log" in c.args[0]]
    assert len(audit_calls) == 1
    _, actor, entity_type, entity_id, action, field, old_value, new_value, source = audit_calls[0].args
    assert entity_type == "REQUIREMENT"
    assert entity_id == "r1"
    assert action == "update"
    assert field == "is_active"
    assert json.loads(old_value) is True
    assert json.loads(new_value) is False


def test_patch_conditions_404_when_requirement_missing():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = None
    client = make_client(pool)

    res = client.patch("/api/v1/compliance-requirements/does-not-exist/conditions",
                       json={"is_active": False})

    assert res.status_code == 404


def test_patch_conditions_requires_admin_not_editor():
    """Ronda de arreglo 1, punto 2: el brief pedia require_editor, corregido
    a require_admin -- misma altura de permiso que el resto de la
    configuracion de catalogo del backend."""
    pool = AsyncMock()
    client = make_client_without_admin_override(pool)

    res = client.patch("/api/v1/compliance-requirements/r1/conditions", json={"is_active": False})

    assert res.status_code == 403


# ── Vista previa (GET /recalc-preview) ──────────────────────────────────────

def test_preview_no_escribe_nada():
    """La vista previa es de sólo lectura. Si escribe, el usuario no puede
    mirar antes de decidir — que es todo el punto."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"target_entity": "ASSET"}
    conn.fetch.return_value = []
    client = make_client(pool)

    res = client.get("/api/v1/compliance-requirements/r1/recalc-preview")

    assert res.status_code == 200
    assert res.json() == {"crear": 0, "quitar": 0, "bloqueados": 0}
    # ni un INSERT, UPDATE o DELETE en todo el camino
    for c in list(pool.execute.call_args_list) + list(conn.execute.call_args_list):
        assert not re.search(r"\b(INSERT|UPDATE|DELETE)\b", c.args[0], re.I)
    # M3: solo lectura de verdad -- transaccion readonly, no una de escritura
    conn.transaction.assert_called_once_with(readonly=True)


def test_recalc_preview_404_when_requirement_missing():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = None
    client = make_client(pool)

    res = client.get("/api/v1/compliance-requirements/does-not-exist/recalc-preview")

    assert res.status_code == 404


# ── Aplicar el recalculo (POST /recalc) ─────────────────────────────────────

def _sql_normalizado(sql: str) -> str:
    return " ".join(sql.split())


def test_recalc_apaga_en_vez_de_borrar():
    """El recalculo no borra: marca que el requisito dejo de exigirse.

    compliance_records no tiene tabla de historial, asi que un DELETE fisico
    es irreversible por definicion. El proyecto ya resuelve esto en otro lado
    (reconcile_carrier_shipper_link apaga con is_current = false en vez de
    borrar); el recalculo simplemente no lo usaba. Este test fija que no
    quede NINGUN borrado fisico en el camino, no solo que exista el UPDATE."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"target_entity": "ASSET"}
    conn.fetch.side_effect = [
        [],  # crear
        [{"id": "rec-libre", "entity_id": "a1", "bloqueado": False}],  # sobran
        [{"id": "rec-libre"}],  # UPDATE ... RETURNING id
    ]
    client = make_client(pool)

    res = client.post("/api/v1/compliance-requirements/r1/recalc")

    assert res.status_code == 200
    todo_el_sql = [c.args[0] for c in
                   list(conn.fetch.call_args_list) + list(conn.execute.call_args_list)]
    assert not any(re.search(r"\bDELETE\b", s, re.I) for s in todo_el_sql)


def test_recalc_nunca_apaga_un_registro_con_documento():
    """D13. Apagar un requisito con documento cargado lo sacaria de todas
    las pantallas (todas filtran is_current), que para quien mira es lo
    mismo que haberlo perdido. El UPDATE ademas repite el predicado (no
    confia ciegamente en los IDs que trajo la vista previa)."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"target_entity": "ASSET"}
    # uno sin tocar, uno con archivo
    conn.fetch.side_effect = [
        [],  # crear
        [{"id": "rec-libre", "entity_id": "a1", "bloqueado": False},
         {"id": "rec-con-doc", "entity_id": "a2", "bloqueado": True}],  # sobran
        [{"id": "rec-libre"}],  # UPDATE ... RETURNING id
    ]
    client = make_client(pool)

    res = client.post("/api/v1/compliance-requirements/r1/recalc")

    assert res.status_code == 200
    assert res.json() == {"creados": 0, "quitados": 1, "bloqueados": 1}
    apagado = [c for c in conn.fetch.call_args_list if "UPDATE" in c.args[0].upper()]
    assert len(apagado) == 1
    assert apagado[0].args[1] == ["rec-libre"]
    sql = _sql_normalizado(apagado[0].args[0])
    # Apaga el interruptor y NADA mas: si el UPDATE tocara tambien status o
    # file_url, "dejo de exigirse" pasaria a ser "se vacio el registro".
    set_clause = sql[sql.index("SET"):sql.index("WHERE")].strip()
    assert set_clause == "SET is_current = false"
    # D13 vuelve a comprobarse en el propio UPDATE, no solo en la vista
    # previa. Comparacion exacta (no "in" por termino): un "in" deja pasar
    # un NOT de mas delante de cualquiera de las tres condiciones sin que
    # el assert lo note (ver el mismo hallazgo en
    # test_requirement_conditions.py, Ronda de arreglo 2).
    assert sql[sql.index("WHERE"):] == (
        "WHERE id = ANY($1::uuid[]) AND is_current "
        "AND file_url IS NULL AND NOT is_manual_override "
        "AND status IS NOT DISTINCT FROM 'MISSING' RETURNING id"
    )


def test_recalc_creates_missing_records_for_newly_matching_entities():
    """La rama `crear` del recalculo: un asset que ahora matchea la
    condicion pero todavia no tiene compliance_record. No estaba ejercitada
    en ningun test de la suite (Ronda de arreglo 1, punto 6)."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"target_entity": "ASSET"}
    conn.fetch.side_effect = [
        [{"id": "a-nuevo"}],  # crear
        [],  # sobran
        [{"id": "cr-nuevo-1"}],  # INSERT ... RETURNING id
    ]
    client = make_client(pool)

    res = client.post("/api/v1/compliance-requirements/r1/recalc")

    assert res.status_code == 200
    assert res.json() == {"creados": 1, "quitados": 0, "bloqueados": 0}
    inserts = [c for c in conn.fetch.call_args_list if "INSERT" in c.args[0].upper()]
    assert len(inserts) == 1
    assert inserts[0].args[1] == ["a-nuevo"]
    assert inserts[0].args[2] == "ASSET"


def test_recalc_vuelve_a_encender_un_registro_apagado_sin_pisarle_el_documento():
    """El indice unico (entity_id, requirement_id) es TOTAL, no parcial: un
    registro apagado sigue ocupando el lugar, asi que un INSERT puro contra
    una entidad que YA tuvo este requisito o explota o lo saltea el
    ON CONFLICT DO NOTHING -- y el endpoint reportaria "creados: N" sin haber
    creado nada. El DO UPDATE enciende el interruptor y NO toca status,
    file_url, metadata ni expiration_date: un registro apagado puede tener
    documento cargado (lo pudo apagar el trigger del vinculo empresa-cliente,
    que no mira D13), y resucitarlo pisandole el archivo seria destruir
    trabajo real -- exactamente lo que este cambio vino a evitar."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"target_entity": "ASSET"}
    conn.fetch.side_effect = [
        [{"id": "a-que-vuelve"}],  # crear
        [],  # sobran
        [{"id": "cr-reencendido"}],  # INSERT ... ON CONFLICT DO UPDATE RETURNING id
    ]
    client = make_client(pool)

    res = client.post("/api/v1/compliance-requirements/r1/recalc")

    assert res.status_code == 200
    assert res.json()["creados"] == 1
    sql = _sql_normalizado(
        [c.args[0] for c in conn.fetch.call_args_list if "INSERT" in c.args[0].upper()][0])
    # El WHERE es el ESPEJO del `AND is_current` del apagado: sin el, una fila
    # que otro escritor encendio entre el calculo y este INSERT se reescribe
    # `true` sobre `true`, entra en el RETURNING, infla `creados` y deja en
    # audit_log un id que este recalculo nunca cambio. Hallazgo de /code-review
    # (2026-08-16): la guarda estaba en un lado del espejo y no en el otro.
    assert sql[sql.index("ON CONFLICT"):] == (
        "ON CONFLICT (entity_id, requirement_id) DO UPDATE SET is_current = true "
        "WHERE NOT public.compliance_records.is_current "
        "RETURNING id"
    )


def test_recalc_reports_rows_actually_turned_off_not_the_planned_count():
    """Ventana D13: si entre el calculo y el UPDATE algo protegio un
    registro (ej. se subio un archivo), el numero que ve el usuario es el
    ejecutado, no el planeado. Se simula devolviendo del UPDATE una sola
    fila aunque la vista previa habia calculado dos."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"target_entity": "ASSET"}
    conn.fetch.side_effect = [
        [],
        [{"id": "rec-1", "entity_id": "a1", "bloqueado": False},
         {"id": "rec-2", "entity_id": "a2", "bloqueado": False}],
        [{"id": "rec-1"}],  # el UPDATE guardado solo apago uno
    ]
    client = make_client(pool)

    res = client.post("/api/v1/compliance-requirements/r1/recalc")

    assert res.status_code == 200
    assert res.json()["quitados"] == 1


def test_recalc_audits_created_and_deleted_ids():
    """compliance_records no tiene tabla de historial: aunque apagar ya no
    sea destructivo, el audit_log sigue siendo lo unico que dice QUE fila
    toco cada recalculo."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"target_entity": "ASSET"}
    conn.fetch.side_effect = [
        [{"id": "a-nuevo"}],  # crear
        [{"id": "rec-libre", "entity_id": "a1", "bloqueado": False}],  # sobran
        [{"id": "cr-nuevo-1"}],  # INSERT RETURNING id
        [{"id": "rec-libre"}],   # UPDATE RETURNING id
    ]
    client = make_client(pool)

    res = client.post("/api/v1/compliance-requirements/r1/recalc")

    assert res.status_code == 200
    audit_calls = [c for c in conn.execute.call_args_list if "audit_log" in c.args[0]]
    assert len(audit_calls) == 1
    _, actor, entity_type, entity_id, action, field, old_value, new_value, source = audit_calls[0].args
    assert action == "recalc"
    assert field == "compliance_records"
    assert json.loads(old_value) == ["rec-libre"]   # quitados
    assert json.loads(new_value) == ["cr-nuevo-1"]  # creados


def test_recalc_404_when_requirement_missing():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = None
    client = make_client(pool)

    res = client.post("/api/v1/compliance-requirements/does-not-exist/recalc")

    assert res.status_code == 404


def test_recalc_requires_admin_not_editor():
    pool = AsyncMock()
    client = make_client_without_admin_override(pool)

    res = client.post("/api/v1/compliance-requirements/r1/recalc")

    assert res.status_code == 403
