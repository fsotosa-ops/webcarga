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
