"""D1 "Una sola respuesta" (spec 2026-10-12-directory-d1-one-answer-design.md §8.1):
para toda empresa ACTIVA, Vencidos / Por vencer / Faltan valen lo mismo en el
Directorio, la vista rápida y el embudo de Certificación que en
GET /compliance-records/pending/summary?group_by=carrier.

Es el único test del plan que lee datos de producción: compara dos lecturas de
los mismos datos, dentro de la misma transacción revertida, y no fija cifras.
Hoy falla (F-02): cada lector cuenta otro universo. Cada comparación lleva su
propio xfail(strict=True); la tarea que arregla ese lector lo quita (Task 5:
Directorio; Task 6: vista rápida y embudo). Con strict, si un lector se
arregla sin quitar la marca, la corrida falla (XPASS) y obliga a quitarla."""
from __future__ import annotations

from typing import Callable
from uuid import UUID

import pytest

from app.routers.carriers import list_carriers
from app.routers.compliance import get_certification_status, pending_summary
from app.services.entity_summary import carrier_summary
from tests.conftest import PoolDeUnaConexion

try:  # Task 2 crea tests/d1_subjects.py; hasta entonces no hay nada que aplicar.
    from tests.d1_subjects import apply_fleet_facts
except ImportError:
    apply_fleet_facts = None

pytestmark = pytest.mark.integracion

Triple = tuple[int, int, int]  # (overdue, expiring, missing)


@pytest.fixture(autouse=True)
async def _hechos_de_flota(conexion_revertida):
    """Aplica los hechos de flota (app.active_fleet) a la transacción revertida
    antes de cada test, para que los lectores arreglados no fallen con
    UndefinedTable mientras la migración no esté desplegada (ruling F3).
    Task 2 hace real `apply_fleet_facts`; hoy es un no-op."""
    if apply_fleet_facts is not None:
        await apply_fleet_facts(conexion_revertida)
    yield


async def _activas(conn) -> list[str]:
    return [str(f["id"]) for f in await conn.fetch(
        "SELECT id FROM public.carriers WHERE operational_status = $1 ORDER BY id", "ACTIVE")]


async def _esperado(conn) -> dict[str, Triple]:
    """La respuesta de Pendientes. Una empresa sin fila no debe nada: (0, 0, 0)."""
    resumen = await pending_summary(group_by="carrier", pool=PoolDeUnaConexion(conn), _=None)
    return {f["key"]: (f["overdue"], f["expiring"], f["missing"]) for f in resumen["rows"]}


def _desde_resumen(resumen) -> Triple:
    """`compliance_summary` del contrato (Task 4): lo propio más lo de la flota."""
    if hasattr(resumen, "model_dump"):
        resumen = resumen.model_dump()
    own = resumen["own"]
    fleet = resumen.get("fleet") or {"overdue": 0, "expiring": 0, "missing": 0}
    return (own["overdue"] + fleet["overdue"], own["expiring"] + fleet["expiring"],
            own["missing"] + fleet["missing"])


def _diferencias(activas: list[str], esperado: dict[str, Triple], filas: dict[str, dict],
                 legado: Callable[[dict], tuple[str, object]]) -> list[str]:
    """Las empresas cuyo lector no dice lo mismo que Pendientes.

    Con `compliance_summary` (desde la Task 5/6) se compara la terna. Sin él (hoy)
    se compara lo que la pantalla muestra hoy: una terna si el lector ya la
    tiene, o el total si solo trae un número. Así el test falla hoy por la cifra,
    no por un KeyError."""
    malas = []
    for cid in activas:
        fila = filas.get(cid)
        if fila is None:
            malas.append(f"{cid}: el lector no la trae")
            continue
        quiere = esperado.get(cid, (0, 0, 0))
        if fila.get("compliance_summary") is not None:
            dice, compara = _desde_resumen(fila["compliance_summary"]), quiere
        else:
            tipo, valor = legado(fila)
            dice, compara = valor, (quiere if tipo == "triple" else sum(quiere))
        if dice != compara:
            malas.append(f"{cid}: dice {dice}, Pendientes {compara}")
    return malas


def _informe(malas: list[str], activas: list[str], lector: str) -> str:
    # Solo ids: el informe no copia nombres de empresas (memoria "redactar PII").
    return (f"{lector}: {len(malas)} de {len(activas)} empresas activas difieren de Pendientes:\n"
            + "\n".join(malas[:10]))


async def test_el_comparador_dice_igual_cuando_es_igual(conexion_revertida):
    """Control. Pendientes contra sí mismo no difiere: sin esto, un comparador
    roto (siempre rojo) haría pasar por medido un xfail que no mide nada."""
    conn = conexion_revertida
    activas, esperado = await _activas(conn), await _esperado(conn)
    filas = {cid: {"compliance_summary": {
        "own": dict(zip(("overdue", "expiring", "missing"), esperado.get(cid, (0, 0, 0)))),
        "fleet": None}} for cid in activas}

    assert _diferencias(activas, esperado, filas, lambda f: ("total", None)) == []


async def test_directorio_cuenta_lo_mismo_que_pendientes(conexion_revertida):
    conn = conexion_revertida
    activas, esperado = await _activas(conn), await _esperado(conn)
    respuesta = await list_carriers(q="", operational_status="ACTIVE", enablement="", page=1, limit=100,
                                    pool=PoolDeUnaConexion(conn), _=None)
    assert respuesta["count"] == len(activas) <= 100, "la página no trae a todas las activas"
    filas = {str(f["id"]): f for f in respuesta["data"]}

    # Sin compliance_summary no hay otra cifra que comparar (pending_mandatory se retiró en la T16).
    malas = _diferencias(activas, esperado, filas, lambda f: ("total", None))

    assert malas == [], _informe(malas, activas, "Directorio")


async def test_vista_rapida_cuenta_lo_mismo_que_pendientes(conexion_revertida):
    conn = conexion_revertida
    activas, esperado = await _activas(conn), await _esperado(conn)
    filas = {cid: await carrier_summary(conn, UUID(cid)) for cid in activas}

    malas = _diferencias(activas, esperado, filas, lambda f: (
        "triple", (f["documents"]["expired"], f["documents"]["expiring"], f["documents"]["missing"])))

    assert malas == [], _informe(malas, activas, "Vista rápida")


async def test_embudo_cuenta_lo_mismo_que_pendientes(conexion_revertida):
    conn = conexion_revertida
    activas, esperado = await _activas(conn), await _esperado(conn)
    respuesta = await get_certification_status(group="carrier", scope="active", carrier_id=None, q="",
                                               limit=500, pool=PoolDeUnaConexion(conn), _=None)
    filas = {f["carrier_id"]: f for f in respuesta["rows"]}

    malas = _diferencias(activas, esperado, filas, lambda f: ("total", f["pending_count"]))

    assert malas == [], _informe(malas, activas, "Embudo")
