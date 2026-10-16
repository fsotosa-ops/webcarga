"""El inventario de Configuración contra la base real.

Los tests de `test_config_monitor.py` simulan la conexión, así que el SQL nunca
corría: cuando el contract de RBAC (10/10) borró `profiles.role`, la portada de
Configuración quedó en "Sin datos por ahora" en todos los dominios y ningún test
se enteró (encontrado en la simulación local de Certificación, 11/10)."""
from __future__ import annotations

import pytest

from app.routers.config import _INVENTARIO_SQL

pytestmark = pytest.mark.integracion


async def test_el_inventario_corre_contra_el_esquema_vigente(conexion_revertida):
    fila = await conexion_revertida.fetchrow(_INVENTARIO_SQL)
    assert fila is not None


async def test_los_roles_son_los_que_tienen_las_personas_activas(conexion_revertida):
    """Mismo significado que antes del RBAC: cuántos roles distintos tiene la
    gente con cuenta activa, ahora desde app.user_roles."""
    esperado = await conexion_revertida.fetchval(
        """
        SELECT count(DISTINCT ur.role_id)
        FROM app.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
        WHERE p.active
        """)
    fila = await conexion_revertida.fetchrow(_INVENTARIO_SQL)
    assert fila["roles"] == esperado


async def test_el_inventario_desglosa_lo_sin_revisar_por_seccion(conexion_revertida):
    """El índice de Configuración (Parte 1) muestra cuánto falta revisar en cada
    sección, no solo en el área. La suma de las secciones es la del área."""
    from app.routers.config import inventario_configuracion
    from tests.conftest import USER, PoolDeUnaConexion

    inv = await inventario_configuracion(pool=PoolDeUnaConexion(conexion_revertida), usuario=USER)
    ops = inv["operations"]
    assert "driver-reasons" in ops["secciones"]
    assert sum(ops["secciones"].values()) == ops["revision"]["sin_revisar"]
    assert set(inv["insurance"]["secciones"]) == {"expiry-alerts"}
