"""Quién cambió qué en Configuración (spec 2026-10-22-configuracion-orden-visual §3.3).

Cada guardado escribe en public.audit_log; la pantalla muestra el último cambio por
elemento. Reemplaza la "revisión" como trazabilidad. Contra Postgres, transacción
revertida."""
from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from tests.conftest import PoolDeUnaConexion, _usuario_real, usuario

pytestmark = pytest.mark.integracion


def test_entity_uuid_es_estable_y_distinto():
    from app.services.config_changes import entity_uuid
    a = entity_uuid("operations", "alert-thresholds", "stale_report_hours")
    assert a == entity_uuid("operations", "alert-thresholds", "stale_report_hours")
    assert uuid.UUID(a)
    assert a != entity_uuid("operations", "alert-thresholds", "tms_dropped_hours")
    assert a != entity_uuid("operations", "temperature-ranges", "stale_report_hours")
    assert a != entity_uuid("insurance", "alert-thresholds", "stale_report_hours")


async def test_registrar_y_leer_el_ultimo_cambio(conexion_revertida):
    from app.routers.config import list_config_changes
    from app.services.config_changes import registrar_cambio
    conn = conexion_revertida
    primero = await _usuario_real(conn)
    otro = await conn.fetchrow("SELECT id, full_name FROM public.profiles WHERE id <> $1::uuid LIMIT 1", primero["sub"])
    pool = PoolDeUnaConexion(conn)
    await registrar_cambio(pool, actor=primero["sub"], area="operations", section="temperature-ranges",
                           element_id="zz_test", action="update", before={"min_c": 1}, after={"min_c": 2})
    await registrar_cambio(pool, actor=str(otro["id"]), area="operations", section="temperature-ranges",
                           element_id="zz_test", action="update", before={"min_c": 2}, after={"min_c": 3})

    filas = await list_config_changes(area="operations", section="temperature-ranges", pool=pool, usuario=primero)
    nuestras = [f for f in filas if f["element_id"] == "zz_test"]

    assert len(nuestras) == 1
    assert nuestras[0]["actor_name"] == otro["full_name"]
    assert nuestras[0]["changed_at"]


async def test_cambios_exige_permiso_de_la_seccion(conexion_revertida):
    from app.routers.config import list_config_changes
    sin_accesos = usuario("operations_operator")
    with pytest.raises(HTTPException) as e:
        await list_config_changes(area="people", section="users", pool=PoolDeUnaConexion(conexion_revertida),
                                  usuario=sin_accesos)
    assert e.value.status_code == 403


async def test_cambios_rechaza_una_seccion_desconocida(conexion_revertida):
    from app.routers.config import list_config_changes
    with pytest.raises(HTTPException) as e:
        await list_config_changes(area="operations", section="no-existe", pool=PoolDeUnaConexion(conexion_revertida),
                                  usuario=usuario("admin"))
    assert e.value.status_code == 422
