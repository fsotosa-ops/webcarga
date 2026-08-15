import re
from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user, require_editor
from app.db import get_pool
from app.routers.requirements import requirements_router
from tests.conftest import USER, wire_transactional_conn


def make_client(pool):
    app = FastAPI()
    app.include_router(requirements_router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_editor] = lambda: USER
    return TestClient(app)


# ── Catalogo de requisitos (GET /compliance-requirements) ──────────────────
# Lo consume el desplegable de clasificacion de la bandeja de sin clasificar.
# La tabla existia desde el inicio pero ningun endpoint la listaba.

def test_list_requirements_returns_catalog():
    pool = AsyncMock()
    pool.fetch.return_value = [{
        "id": "req-1", "target_entity": "DRIVER", "requirement_id": "req-1", "requirement_code": "LICENCIA_CONDUCIR",
        "name": "Licencia de Conducir", "requirement_level": "LEGAL_MANDATORY",
        "has_expiration": True,
    }]
    client = make_client(pool)

    res = client.get("/api/v1/compliance-requirements")

    assert res.status_code == 200
    body = res.json()
    assert body[0]["requirement_code"] == "LICENCIA_CONDUCIR"
    assert body[0]["has_expiration"] is True


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


# ── Condiciones configurables + recalculo (Tramo 3) ─────────────────────────
# Guardar la regla y aplicarla son dos actos distintos: PATCH /conditions solo
# cambia el catalogo, GET /recalc-preview mira sin escribir, POST /recalc
# aplica. D13: el recalculo nunca borra un registro con documento, con
# edicion manual o fuera de MISSING.

def test_preview_no_escribe_nada():
    """La vista previa es de sólo lectura. Si escribe, el usuario no puede
    mirar antes de decidir — que es todo el punto."""
    pool = AsyncMock()
    pool.fetchrow.return_value = {"target_entity": "ASSET"}
    pool.fetch.return_value = []
    client = make_client(pool)

    res = client.get("/api/v1/compliance-requirements/r1/recalc-preview")

    assert res.status_code == 200
    assert res.json() == {"crear": 0, "quitar": 0, "bloqueados": 0}
    # ni un INSERT, UPDATE o DELETE en todo el camino
    for c in pool.execute.call_args_list:
        assert not re.search(r"\b(INSERT|UPDATE|DELETE)\b", c.args[0], re.I)


def test_recalc_nunca_borra_un_registro_con_documento():
    """D13. Borrar un documento cargado porque cambio una regla de catalogo
    seria destruir trabajo real."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    pool.fetchrow.return_value = {"target_entity": "ASSET"}
    # uno sin tocar, uno con archivo
    pool.fetch.side_effect = [
        [],  # crear
        [{"id": "rec-libre", "entity_id": "a1", "bloqueado": False},
         {"id": "rec-con-doc", "entity_id": "a2", "bloqueado": True}],
    ]
    client = make_client(pool)

    res = client.post("/api/v1/compliance-requirements/r1/recalc")

    assert res.status_code == 200
    assert res.json() == {"creados": 0, "quitados": 1, "bloqueados": 1}
    borrado = [c for c in conn.execute.call_args_list if "DELETE" in c.args[0].upper()]
    assert len(borrado) == 1
    assert borrado[0].args[1] == ["rec-libre"]


def test_patch_conditions_rechaza_una_gestion_inventada():
    pool = AsyncMock()
    client = make_client(pool)
    res = client.patch("/api/v1/compliance-requirements/r1/conditions",
                       json={"applies_to_management_types": ["SIDER"]})
    assert res.status_code == 422
