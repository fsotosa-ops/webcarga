"""RF1 (Entrega 1 de fichas, 15/10): la sección Documentos de la ficha de un
conductor o equipo SIN empresa lista sus documentos. La ficha pide
`/pending?entity_id=…&estado=todos` sin `carrier_id`; el alcance de la cola
(empresa activa) no puede dejarlo en blanco: la ficha existe sin empresa (C5)."""
from __future__ import annotations

import pytest

from app.routers.compliance import list_pending_compliance_records
from tests import d1_subjects as s
from tests.conftest import PoolDeUnaConexion

pytestmark = pytest.mark.integracion


async def test_rf1_un_conductor_sin_empresa_lista_sus_documentos(conexion_revertida):
    conn = conexion_revertida
    driver = await s.driver(conn, None)
    await s.without_seeding(conn, driver)
    req = await s.requirement(conn, entity="DRIVER")
    record = await s.record(conn, req, "DRIVER", driver)

    respuesta = await list_pending_compliance_records(
        carrier_id=None, category=None, requirement_code=None, q="", operation_type=None,
        entity_id=driver, limit=200, offset=0, estado="todos", state=None,
        pool=PoolDeUnaConexion(conn), _=None,
    )

    filas = respuesta["rows"] if isinstance(respuesta, dict) else respuesta.rows
    assert [str(r["id"] if isinstance(r, dict) else r.id) for r in filas] == [record]


async def test_la_fila_dice_si_operaciones_ya_la_pidio(conexion_revertida):
    """La ficha marca "Pedido a Certificación" desde las mismas filas de /pending
    (revisión final de la Entrega 1: antes salía de …/compliance-records, que nadie
    invalidaba y firmaba una URL por documento)."""
    conn = conexion_revertida
    c = await s.carrier(conn)
    driver = await s.driver(conn, c)
    await s.without_seeding(conn, driver)
    req = await s.requirement(conn, entity="DRIVER")
    await s.record(conn, req, "DRIVER", driver)
    pedido = await conn.fetchval(
        "INSERT INTO app.certification_requests (entity_type, entity_id, requirement_id, status, created_by) "
        "VALUES ('DRIVER', $1, $2, 'OPEN', (SELECT id FROM auth.users LIMIT 1)) RETURNING id::text", driver, req)

    respuesta = await list_pending_compliance_records(
        carrier_id=None, category=None, requirement_code=None, q="", operation_type=None,
        entity_id=driver, limit=200, offset=0, estado="todos", state=None,
        pool=PoolDeUnaConexion(conn), _=None,
    )
    filas = respuesta["rows"] if isinstance(respuesta, dict) else respuesta.rows
    fila = filas[0] if isinstance(filas[0], dict) else filas[0].model_dump()
    assert fila["open_request_id"] == pedido


async def test_f2_lo_que_bloquea_en_pendientes_es_blocking_del_resumen(conexion_revertida):
    """F2 de verdad: la ficha nombra lo que bloquea desde /pending (obligatorios
    vencidos o faltantes); tiene que ser exactamente lo que cuenta `blocking`."""
    from app.services.entity_summary import driver_summary
    conn = conexion_revertida
    ids = [r["id"] for r in await conn.fetch(
        "SELECT id FROM public.drivers WHERE operational_status = 'ACTIVE' ORDER BY id LIMIT 60")]
    assert ids, "sin conductores activos no hay nada que probar"
    for driver_id in ids:
        resumen = (await driver_summary(conn, driver_id))["compliance_summary"]
        respuesta = await list_pending_compliance_records(
            carrier_id=None, category=None, requirement_code=None, q="", operation_type=None,
            entity_id=str(driver_id), limit=500, offset=0, estado="todos", state=None,
            pool=PoolDeUnaConexion(conn), _=None,
        )
        filas = respuesta["rows"] if isinstance(respuesta, dict) else respuesta.rows
        filas = [f if isinstance(f, dict) else f.model_dump() for f in filas]
        bloquean = [f for f in filas if f["certification_type"] == "BASICA" and f["document_state"] in ("OVERDUE", "MISSING")]
        assert len(bloquean) == resumen["blocking"]["own"], (driver_id, len(bloquean), resumen["blocking"])
