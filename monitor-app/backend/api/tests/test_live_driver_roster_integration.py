"""Bloque 0 del Directorio, 0.2: el roster de conductores de una empresa se lee
en vivo. app.carrier_driver_roster es una vista materializada sin trigger de
refresco en public.drivers: renombrar o dar de baja a un conductor dejaba la
lista vieja incluso después de recargar (F-14)."""
from __future__ import annotations

import uuid

import pytest

from app.routers.carriers import list_carrier_drivers
from tests.conftest import PoolDeUnaConexion

pytestmark = pytest.mark.integracion

PREFIJO = "ZZ-TEST-DIRECTORIO"


async def test_renombrar_y_dar_de_baja_se_ve_en_el_roster_sin_refrescar_vistas(conexion_revertida):
    conn = conexion_revertida
    carrier = await conn.fetchval(
        "INSERT INTO public.carriers (business_name, operational_status) VALUES ($1, 'ACTIVE') RETURNING id",
        f"{PREFIJO} Empresa {uuid.uuid4().hex[:6]}")
    driver = await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status) VALUES ($1, 'ACTIVE') RETURNING id",
        f"{PREFIJO} Antes {uuid.uuid4().hex[:6]}")
    # Esta escritura SÍ refresca las vistas (trigger de sentencia en
    # driver_assignments): la vista queda con el nombre de antes.
    await conn.execute(
        "INSERT INTO public.driver_assignments (driver_id, carrier_id, status) VALUES ($1, $2, 'ACTIVE')",
        driver, carrier)
    nuevo = f"{PREFIJO} Despues {uuid.uuid4().hex[:6]}"
    # Esta no: public.drivers no tiene trigger de refresco.
    await conn.execute(
        "UPDATE public.drivers SET full_name = $2, operational_status = 'INACTIVE' WHERE id = $1",
        driver, nuevo)

    filas = await list_carrier_drivers(str(carrier), pool=PoolDeUnaConexion(conn), _=None)

    assert [(f["id"], f["full_name"], f["operational_status"]) for f in filas] == [(driver, nuevo, "INACTIVE")]
    assert set(filas[0]) >= {"total_requirements", "compliance_summary"}
    assert not {"pending_mandatory", "compliance_health"} & set(filas[0])   # D1, Task 16
