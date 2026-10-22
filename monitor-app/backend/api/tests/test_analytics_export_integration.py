"""La descarga Excel de Analítica (plan del módulo, Task 5): baja lo que se ve, queda auditada y respeta los
permisos. Filas creadas a mano en enero de 2025, donde no hay nada más."""
from __future__ import annotations

import io
import uuid
from datetime import date

import openpyxl
import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.routers.analytics import export_rows
from app.services.analytics_export import export_workbook
from app.services.analytics_query import parse_request

from .conftest import PoolDeUnaConexion, _usuario_real, con_roles

pytestmark = pytest.mark.integracion

PARAMS = {"dataset": "trips", "from": "2025-01-01", "to": "2025-01-31"}


async def _tres_viajes(conn):
    for i in range(3):
        await conn.execute(
            "INSERT INTO analytics.bdot (trip_id, trip_code, planning_date, client_name) VALUES ($1, $2, $3, 'Walmart')",
            uuid.uuid4(), f"ZZ-X{i}", date(2025, 1, 10 + i))


def _request(query: str) -> Request:
    return Request({"type": "http", "query_string": query.encode(), "headers": []})


async def _exportaciones(conn) -> list:
    return await conn.fetch(
        "SELECT new_value FROM public.audit_log WHERE entity_type = 'ANALYTICS_EXPORT' AND action = 'export' "
        "AND occurred_at > now() - interval '1 minute'")


async def test_la_descarga_trae_lo_que_se_ve(conexion_revertida):
    await _tres_viajes(conexion_revertida)
    actor = (await _usuario_real(conexion_revertida))["sub"]
    req = parse_request(PARAMS, purpose="export")
    contenido, nombre, filas = await export_workbook(
        conexion_revertida, req, columns=["client_name", "trip_code"], personal=False, actor=actor)
    hoja = openpyxl.load_workbook(io.BytesIO(contenido)).active
    valores = list(hoja.iter_rows(values_only=True))
    assert valores[0][0].startswith("Período 01/01/2025 a 31/01/2025 por planificación")
    assert valores[1] == ("Cliente", "Nº de viaje")
    assert [v[1] for v in valores[2:]] == ["ZZ-X2", "ZZ-X1", "ZZ-X0"]
    assert (nombre, filas) == ("analitica_trips_2025-01-01_2025-01-31.xlsx", 3)


async def test_la_descarga_queda_auditada(conexion_revertida):
    await _tres_viajes(conexion_revertida)
    actor = (await _usuario_real(conexion_revertida))["sub"]
    await export_workbook(conexion_revertida, parse_request(PARAMS, purpose="export"),
                          columns=["trip_code"], personal=False, actor=actor)
    filas = await _exportaciones(conexion_revertida)
    assert len(filas) == 1
    import json
    detalle = json.loads(filas[0]["new_value"])
    assert (detalle["rows"], detalle["personal"], detalle["columns"]) == (3, False, ["trip_code"])


async def test_mas_del_limite_es_413_y_no_se_audita(conexion_revertida):
    await _tres_viajes(conexion_revertida)
    actor = (await _usuario_real(conexion_revertida))["sub"]
    with pytest.raises(HTTPException) as exc:
        await export_workbook(conexion_revertida, parse_request(PARAMS, purpose="export"),
                              columns=["trip_code"], personal=False, actor=actor, max_rows=2)
    assert exc.value.status_code == 413 and exc.value.detail == {"total": 3}
    assert await _exportaciones(conexion_revertida) == []


async def test_columna_personal_sin_permiso_es_403(conexion_revertida):
    base = await _usuario_real(conexion_revertida)
    with pytest.raises(HTTPException) as exc:
        await export_rows(_request("dataset=trips&from=2025-01-01&to=2025-01-31&columns=trip_code,driver_tax_id"),
                          pool=PoolDeUnaConexion(conexion_revertida), user=con_roles(base, "operations_supervisor"))
    assert exc.value.status_code == 403


async def test_descarga_dentro_de_transaccion(conexion_revertida):
    """El modelo se reemplaza de una vez a los :20: la descarga corre igual dentro de una transacción abierta."""
    await _tres_viajes(conexion_revertida)
    base = await _usuario_real(conexion_revertida)
    async with conexion_revertida.transaction():
        respuesta = await export_rows(_request("dataset=trips&from=2025-01-01&to=2025-01-31&columns=trip_code"),
                                      pool=PoolDeUnaConexion(conexion_revertida), user=con_roles(base, "admin"))
    assert respuesta.headers["content-disposition"].endswith('analitica_trips_2025-01-01_2025-01-31.xlsx"')


def test_sin_analytics_export_es_403():
    """La ruta exige analytics.export (la guarda de permisos lee `required_permissions` de su dependencia)."""
    from app.authz import Permission
    from app.main import app
    ruta = next(r for r in app.routes if getattr(r, "path", "") == "/api/v1/analytics/export")
    exigidos = {p for d in ruta.dependant.dependencies for p in getattr(d.call, "required_permissions", ())}
    assert exigidos == {Permission.ANALYTICS_EXPORT}
