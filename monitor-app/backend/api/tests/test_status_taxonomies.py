from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user, require_admin
from app.db import get_pool
from app.routers.status_taxonomies import router

USER = {"sub": "11111111-1111-1111-1111-111111111111", "email": "a@b.c", "role": "admin"}


def make_client(pool):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_admin] = lambda: USER
    return TestClient(app)


def test_list_requires_domain_query_param():
    pool = AsyncMock()
    client = make_client(pool)
    res = client.get("/api/v1/config/taxonomies")
    assert res.status_code == 422


def test_list_rejects_invalid_domain():
    """Un dominio existe si la TABLA tiene filas con ese valor. Antes habia un
    set escrito a mano en Python y un union en TypeScript, y extender uno solo
    dejaba media pantalla devolviendo 422 -- paso con WEBCARGA_OPERATION_TYPE."""
    pool = AsyncMock()
    pool.fetchval.return_value = False          # la tabla no conoce ese dominio
    pool.fetch.return_value = [{"domain": "EQUIPMENT_STATE"}]
    client = make_client(pool)
    res = client.get("/api/v1/config/taxonomies?domain=NOT_A_DOMAIN")
    assert res.status_code == 422
    # El mensaje dice cuales SI existen: un 422 que no orienta obliga a leer codigo.
    assert "EQUIPMENT_STATE" in res.json()["detail"]


def test_list_filters_by_domain():
    pool = AsyncMock()
    pool.fetchval.return_value = True
    pool.fetch.return_value = [{
        "id": "t1", "domain": "EQUIPMENT_STATE", "label": "Disponible",
        "bg_color": "#fff", "text_color": "#000", "group": None, "sort_order": 1, "active": True,
    }]
    client = make_client(pool)
    res = client.get("/api/v1/config/taxonomies?domain=EQUIPMENT_STATE")
    assert res.status_code == 200
    assert res.json()[0]["label"] == "Disponible"
    query = pool.fetch.call_args.args[0]
    assert "domain = $1" in query
    assert pool.fetch.call_args.args[1] == "EQUIPMENT_STATE"


def test_create_rejects_invalid_domain():
    pool = AsyncMock()
    pool.fetchval.return_value = False          # la tabla no conoce ese dominio
    pool.fetch.return_value = [{"domain": "EQUIPMENT_STATE"}]
    client = make_client(pool)
    res = client.post("/api/v1/config/taxonomies", json={"domain": "NOT_A_DOMAIN", "label": "X"})
    assert res.status_code == 422


def test_create_taxonomy():
    pool = AsyncMock()
    pool.fetchval.return_value = True
    pool.fetchrow.return_value = {
        "id": "t1", "domain": "EQUIPMENT_STATE", "label": "En Pana",
        "bg_color": "#fef2f2", "text_color": "#b91c1c", "group": None, "sort_order": 3, "active": True,
    }
    client = make_client(pool)
    res = client.post("/api/v1/config/taxonomies", json={
        "domain": "EQUIPMENT_STATE", "label": "En Pana", "bg_color": "#fef2f2", "text_color": "#b91c1c", "sort_order": 3,
    })
    assert res.status_code == 200
    assert res.json()["label"] == "En Pana"


# Auditoría 2026-07-27: OPERATIONAL_STATE/DRIVER_REASON alimentan GET
# /trips/meta, cacheado 5 min — sin invalidar acá el admin no ve su cambio
# reflejado en el Diario hasta que expire el TTL (mismo bug que temperature-
# ranges en config.py).
def test_create_taxonomy_invalidates_meta_cache():
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "id": "t1", "domain": "DRIVER_REASON", "label": "En Pana",
        "bg_color": "#fef2f2", "text_color": "#b91c1c", "group": None, "sort_order": 3, "active": True,
    }
    client = make_client(pool)
    with patch("app.routers.status_taxonomies.invalidate_trips_meta_cache", new_callable=AsyncMock) as inv:
        res = client.post("/api/v1/config/taxonomies", json={
            "domain": "DRIVER_REASON", "label": "En Pana", "bg_color": "#fef2f2", "text_color": "#b91c1c", "sort_order": 3,
        })
    assert res.status_code == 200
    inv.assert_awaited_once()


def test_patch_taxonomy_404_when_missing():
    pool = AsyncMock()
    pool.fetchrow.return_value = None
    client = make_client(pool)
    res = client.patch("/api/v1/config/taxonomies/t1", json={"label": "Nuevo"})
    assert res.status_code == 404


def test_patch_taxonomy_no_fields_422():
    pool = AsyncMock()
    pool.fetchrow.return_value = {"id": "t1"}
    client = make_client(pool)
    res = client.patch("/api/v1/config/taxonomies/t1", json={})
    assert res.status_code == 422


def test_deactivate_taxonomy():
    pool = AsyncMock()
    pool.execute.return_value = "UPDATE 1"
    pool.fetchval.return_value = 0
    client = make_client(pool)
    res = client.delete("/api/v1/config/taxonomies/t1")
    assert res.status_code == 200
    assert res.json() == {"desactivado": True, "en_uso_por": 0}


def test_desactivar_un_subtipo_en_uso_avisa_cuantas_reglas_lo_usan():
    """Desactivar no rompe nada -- el borrado es logico y el UUID sobrevive en
    applies_to_fleet_service_type_ids -- pero el subtipo desaparece de las
    casillas y la condicion se ve como '0 marcas' sin serlo. Quien desactiva
    tiene que enterarse en el momento, no despues."""
    pool = AsyncMock()
    pool.execute.return_value = "UPDATE 1"
    pool.fetchval.return_value = 2
    client = make_client(pool)

    res = client.delete("/api/v1/config/taxonomies/t1")

    assert res.status_code == 200
    assert res.json() == {"desactivado": True, "en_uso_por": 2}


def test_deactivate_taxonomy_cuenta_las_condiciones_que_apuntan_al_id():
    """El conteo tiene que preguntar por ESTE id dentro del arreglo de subtipos
    de las condiciones. Sin fijar la consulta y el argumento, un conteo que
    mirara otra columna -- o que ignorara el id -- pasaria igual."""
    pool = AsyncMock()
    pool.execute.return_value = "UPDATE 1"
    pool.fetchval.return_value = 2
    client = make_client(pool)

    client.delete("/api/v1/config/taxonomies/t1")

    query = pool.fetchval.call_args.args[0]
    assert "public.compliance_requirements" in query
    assert "$1::uuid = ANY(applies_to_fleet_service_type_ids)" in query
    assert pool.fetchval.call_args.args[1] == "t1"


def test_deactivate_taxonomy_404_no_cuenta_condiciones():
    """Si no se desactivo nada, no hay nada que contar: la segunda consulta
    no se hace."""
    pool = AsyncMock()
    pool.execute.return_value = "UPDATE 0"
    client = make_client(pool)

    res = client.delete("/api/v1/config/taxonomies/t1")

    assert res.status_code == 404
    pool.fetchval.assert_not_awaited()


def test_deactivate_taxonomy_404_when_missing():
    pool = AsyncMock()
    pool.execute.return_value = "UPDATE 0"
    client = make_client(pool)
    res = client.delete("/api/v1/config/taxonomies/t1")
    assert res.status_code == 404
