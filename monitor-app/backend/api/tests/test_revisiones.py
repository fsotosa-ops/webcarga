"""El registro de revisión: separar "lo revisamos" de "nadie lo miró".

La mitad de abajo (`integracion`) ejecuta las enumeraciones contra Postgres,
que es lo único que puede decir si el SQL de cada sección es válido: un
AsyncMock acepta cualquier cosa, y una sección cuya enumeración esté rota
haría que la portada cuente de menos sin que nada falle.
"""
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.auth import get_current_user, require_admin
from app.db import get_pool
from app.routers.config import router as config_router
from app.routers.config_reviews import router as reviews_router
from app.routers.status_taxonomies import router as taxonomies_router
from app.services.revisiones import (
    POR_SECCION, REVISABLES, SECCION_DE_TAXONOMIA, SQL_PENDIENTES_POR_DOMINIO,
    exigir_seccion, registrar_revision,
)

USER = {"sub": "11111111-1111-1111-1111-111111111111", "email": "a@b.c", "role": "admin"}


def cliente(pool):
    app = FastAPI()
    for r in (config_router, reviews_router, taxonomies_router):
        app.include_router(r, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_admin] = lambda: USER
    return TestClient(app)


def sql_ejecutado(mock) -> str:
    return " ".join(str(c.args[0]) for c in mock.execute.call_args_list)


# ── El registro ──────────────────────────────────────────────────────────────

def test_cada_seccion_revisable_es_unica():
    claves = [(r.dominio, r.seccion) for r in REVISABLES]
    assert len(claves) == len(set(claves))


def test_personas_no_es_revisable():
    """Es opt-in a propósito: una cuenta de usuario no es una decisión de
    configuración que alguien tenga que confirmar. Si algún día lo fuera, se
    agrega una fila al registro — no un `if` en la portada."""
    assert not [r for r in REVISABLES if r.dominio == "people"]


def test_una_seccion_desconocida_no_se_puede_revisar():
    with pytest.raises(HTTPException) as e:
        exigir_seccion("certification", "inventada")
    assert e.value.status_code == 422
    # El mensaje dice cuáles SÍ: un 422 que no orienta obliga a leer código.
    assert "certification/conditions" in e.value.detail


def test_el_mapa_de_taxonomias_sale_del_registro():
    """Un vocabulario que apareciera acá sin estar declarado como revisable
    sería una sección que se registra y que la portada no cuenta: un contador
    que miente, justo lo que este registro viene a arreglar."""
    for vocabulario, (dominio, seccion) in SECCION_DE_TAXONOMIA.items():
        assert (dominio, seccion) in POR_SECCION
        assert POR_SECCION[(dominio, seccion)].vocabulario == vocabulario


@pytest.mark.asyncio
async def test_registrar_una_seccion_desconocida_no_escribe():
    """Silencioso a propósito: el llamador es un endpoint de guardado, y que
    una sección no sea revisable no puede hacer fallar el guardado."""
    conn = AsyncMock()
    await registrar_revision(conn, "people", "users", "u1", USER["sub"])
    assert conn.execute.await_count == 0


@pytest.mark.asyncio
async def test_revisar_dos_veces_pisa_la_anterior():
    """Interesa la última decisión, no el historial: para eso está audit_log."""
    conn = AsyncMock()
    await registrar_revision(conn, "certification", "conditions", "r1", USER["sub"])
    assert "ON CONFLICT (domain, section, element_id) DO UPDATE" in sql_ejecutado(conn)


# ── Guardar cuenta como revisar ──────────────────────────────────────────────

def test_guardar_un_estado_lo_deja_revisado():
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "id": "ASIGNADO", "label": "Asignado", "bg_color": "#fff", "text_color": "#000",
        "group": "en_ruta", "sort_order": 1,
    }
    res = cliente(pool).patch("/api/v1/config/statuses/ASIGNADO", json={"label": "Asignado"})
    assert res.status_code == 200
    ejecutado = sql_ejecutado(pool)
    assert "app.config_reviews" in ejecutado


def test_guardar_una_taxonomia_la_deja_revisada_en_su_seccion():
    """El endpoint es genérico y no sabe en qué pantalla está parado quien
    edita: la sección sale del `domain` de la fila."""
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "id": "t1", "domain": "FLEET_SERVICE_TYPE", "code": None, "label": "Furgón",
        "bg_color": "#fff", "text_color": "#000", "group": None, "sort_order": 1, "active": True,
    }
    res = cliente(pool).patch("/api/v1/config/taxonomies/t1", json={"label": "Furgón"})
    assert res.status_code == 200
    argumentos = [c.args for c in pool.execute.call_args_list if "config_reviews" in str(c.args[0])]
    assert argumentos, "guardar un subtipo no dejó registro de revisión"
    assert argumentos[0][1:3] == ("fleet", "subtypes")


def test_guardar_un_vocabulario_no_revisable_no_rompe_el_guardado():
    """`DRIVER_REASON` sí es revisable; el caso a cubrir es el contrario: un
    vocabulario que no esté declarado no puede hacer fallar un PATCH."""
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "id": "t1", "domain": "VOCABULARIO_NUEVO", "code": None, "label": "X",
        "bg_color": "#fff", "text_color": "#000", "group": None, "sort_order": 1, "active": True,
    }
    res = cliente(pool).patch("/api/v1/config/taxonomies/t1", json={"label": "X"})
    assert res.status_code == 200
    assert "config_reviews" not in sql_ejecutado(pool)


def test_mover_no_cuenta_como_revisar():
    """Cambiar el orden de la lista no es decidir sobre el elemento: si contara,
    reordenar apagaría insignias sin que nadie mirara la regla."""
    conn = AsyncMock()
    conn.fetchrow.return_value = {"sort_order": 2}
    conn.fetch.return_value = [{"id": "A", "sort_order": 1}, {"id": "B", "sort_order": 2}]
    pool = AsyncMock()
    from tests.conftest import wire_transactional_conn
    wire_transactional_conn(pool, conn)
    pool.fetch.return_value = []

    cliente(pool).post("/api/v1/config/statuses/B/move", json={"direction": "up"})

    assert "config_reviews" not in sql_ejecutado(conn)


# ── El gesto de confirmar ────────────────────────────────────────────────────

def test_confirmar_registra_la_revision():
    pool = AsyncMock()
    res = cliente(pool).post("/api/v1/config/reviews", json={
        "domain": "certification", "section": "conditions", "element_id": "r1",
    })
    assert res.status_code == 200
    assert res.json() == {"revisado": True}
    assert "app.config_reviews" in sql_ejecutado(pool)


def test_confirmar_una_seccion_inventada_es_422():
    pool = AsyncMock()
    res = cliente(pool).post("/api/v1/config/reviews", json={
        "domain": "certification", "section": "inventada", "element_id": "r1",
    })
    assert res.status_code == 422
    assert pool.execute.await_count == 0


def test_listar_devuelve_los_revisados_no_los_pendientes():
    """La lista de elementos ya la tiene la pantalla; pedirle al backend que la
    repita crearía una segunda definición de qué elementos hay."""
    pool = AsyncMock()
    pool.fetch.return_value = [
        {"element_id": "r1", "reviewed_at": "2026-08-17T10:00:00Z", "reviewed_by": "Felipe"},
    ]
    res = cliente(pool).get(
        "/api/v1/config/reviews?domain=certification&section=conditions")
    assert res.status_code == 200
    assert res.json()[0]["element_id"] == "r1"
    assert res.json()[0]["reviewed_by"] == "Felipe"


# ── Contra Postgres ──────────────────────────────────────────────────────────

@pytest.mark.integracion
@pytest.mark.asyncio
@pytest.mark.parametrize("revisable", REVISABLES, ids=lambda r: f"{r.dominio}/{r.seccion}")
async def test_integracion_cada_enumeracion_corre_y_devuelve_id(conexion_revertida, revisable):
    """Una sección cuya enumeración esté rota haría que la portada cuente de
    menos, sin que nada falle. Esto ejecuta las diez."""
    filas = await conexion_revertida.fetch(revisable.sql)
    assert all("id" in f.keys() for f in filas)


@pytest.mark.integracion
@pytest.mark.asyncio
async def test_integracion_revisar_baja_el_contador_de_su_dominio(conexion_revertida):
    conn = conexion_revertida
    antes = {r["domain"]: r["sin_revisar"] for r in await conn.fetch(SQL_PENDIENTES_POR_DOMINIO)}

    elemento = await conn.fetchval(
        "SELECT id::text FROM public.compliance_requirements ORDER BY id LIMIT 1")
    revisor = await conn.fetchval("SELECT id FROM public.profiles LIMIT 1")
    await registrar_revision(conn, "certification", "conditions", elemento, str(revisor))

    despues = {r["domain"]: r["sin_revisar"] for r in await conn.fetch(SQL_PENDIENTES_POR_DOMINIO)}
    assert despues["certification"] == antes["certification"] - 1
    # Y no toca a los otros dominios: el contador es por dominio, no global.
    assert despues["operations"] == antes["operations"]
    assert despues["fleet"] == antes["fleet"]


@pytest.mark.integracion
@pytest.mark.asyncio
async def test_integracion_revisar_dos_veces_no_cuenta_dos(conexion_revertida):
    conn = conexion_revertida
    elemento = await conn.fetchval(
        "SELECT id::text FROM public.compliance_requirements ORDER BY id LIMIT 1")
    revisor = await conn.fetchval("SELECT id FROM public.profiles LIMIT 1")

    await registrar_revision(conn, "certification", "conditions", elemento, str(revisor))
    primera = await conn.fetchval(
        "SELECT reviewed_at FROM app.config_reviews WHERE element_id = $1", elemento)
    await registrar_revision(conn, "certification", "conditions", elemento, str(revisor))

    assert await conn.fetchval(
        "SELECT count(*) FROM app.config_reviews WHERE element_id = $1", elemento) == 1
    segunda = await conn.fetchval(
        "SELECT reviewed_at FROM app.config_reviews WHERE element_id = $1", elemento)
    assert segunda >= primera


def test_el_mapa_de_taxonomias_dice_lo_mismo_en_python_y_en_typescript():
    """`TaxonomyTab` es un solo componente que sirve a los cinco vocabularios,
    asi que necesita saber en que seccion esta parado — y el backend necesita
    lo mismo para registrar la revision al guardar. Son dos copias del mismo
    mapa, en dos lenguajes, y este test es lo unico que impide que se separen.

    Es la misma red que ya existe para el union de dominios de TypeScript
    (test_integracion_certificacion), y por la misma razon: la vez que esas dos
    copias divergieron, media pantalla devolvia 422."""
    from pathlib import Path
    import re

    fuente = (
        Path(__file__).resolve().parents[3] / "frontend" / "app" / "dashboard"
        / "admin" / "settings" / "dominios.ts"
    ).read_text(encoding="utf-8")
    bloque = fuente.split("export const SECCION_DE_TAXONOMIA")[1].split("}")[0]
    en_typescript = {
        vocabulario: (dominio, seccion)
        for vocabulario, dominio, seccion in re.findall(
            r"(\w+):\s*\['([\w-]+)',\s*'([\w-]+)'\]", bloque
        )
    }

    assert en_typescript == SECCION_DE_TAXONOMIA


def test_toda_seccion_revisable_existe_en_el_registro_de_dominios():
    """Una seccion que el backend cuenta como revisable y que el frontend no
    tiene seria un numero en la portada que no lleva a ningun lado."""
    from pathlib import Path

    fuente = (
        Path(__file__).resolve().parents[3] / "frontend" / "app" / "dashboard"
        / "admin" / "settings" / "dominios.ts"
    ).read_text(encoding="utf-8")

    for r in REVISABLES:
        assert f"clave: '{r.dominio}'" in fuente, r.dominio
        assert f"clave: '{r.seccion}'" in fuente, r.seccion
