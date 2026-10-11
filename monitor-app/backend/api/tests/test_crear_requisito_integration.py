"""El alta de un tipo de documento desde Configuración ("Nuevo documento").

L4 (simulación local 11/10): el alta no fijaba `requires_file` y la columna
vale `false` por defecto. El formulario describe un documento con archivo, y
Certificación lo carga con archivo, pero la ficha del Directorio leía el flag y
no ofrecía subirlo."""
from __future__ import annotations

from uuid import uuid4

import pytest

from app.routers.requirements import create_requirement
from app.schemas.requirement import RequirementCreateBody
from tests.conftest import PoolDeUnaConexion, _usuario_real

pytestmark = pytest.mark.integracion


async def test_un_documento_nuevo_se_carga_con_archivo(conexion_revertida):
    creado = await create_requirement(
        RequirementCreateBody(name=f"ZZ-TEST-ALTA {uuid4().hex[:8]}", target_entity="DRIVER"),
        pool=PoolDeUnaConexion(conexion_revertida), user=await _usuario_real(conexion_revertida))

    requiere = await conexion_revertida.fetchval(
        "SELECT requires_file FROM public.compliance_requirements WHERE id = $1::uuid", creado["id"])
    assert requiere is True
