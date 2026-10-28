"""La baja definitiva se marca en Configuración › Motivos de baja (28/10).

`blocks_reactivation` es un atributo del motivo en el catálogo: la API de catálogos lo
devuelve y lo deja editar, y el ciclo de vida lo lee (services/lifecycle.py). Contra
Postgres de verdad, en una transacción revertida."""
from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from app.routers.status_taxonomies import list_taxonomies, patch_taxonomy
from app.schemas.status_taxonomy import StatusTaxonomyPatch
from app.services import lifecycle

from .conftest import PoolDeUnaConexion, _usuario_real
from .test_lifecycle_integration import _carrier, _reason, _without_documents

pytestmark = pytest.mark.integracion


async def test_marcar_un_motivo_como_baja_definitiva_bloquea_la_reactivacion(conexion_revertida):
    conn = conexion_revertida
    pool = PoolDeUnaConexion(conn)
    user = await _usuario_real(conn)
    motivo = str(await conn.fetchval(
        "INSERT INTO app.status_taxonomies (domain, label, group_id) VALUES ('DEACTIVATION_REASON', $1, 'all') "
        "RETURNING id", f"ZZ-TEST {uuid.uuid4().hex[:6]}"))

    fila = await patch_taxonomy(motivo, StatusTaxonomyPatch(blocks_reactivation=True), pool=pool, usuario=user)
    assert fila["blocks_reactivation"] is True
    listado = {r["id"]: r for r in await list_taxonomies(domain="DEACTIVATION_REASON", pool=pool, _permiso=user)}
    assert listado[motivo]["blocks_reactivation"] is True

    carrier = await _carrier(conn, "ACTIVE")
    await _without_documents(conn, carrier)
    await lifecycle.transition(conn, entity="CARRIER", entity_id=carrier, action="deactivate",
                               actor=user["sub"], reason_id=motivo)
    with pytest.raises(HTTPException) as exc:
        await lifecycle.transition(conn, entity="CARRIER", entity_id=carrier, action="reactivate", actor=user["sub"],
                                   reason_id=await _reason(conn, "REACTIVATION_REASON", "RELATIONSHIP_RESUMED"))
    assert exc.value.status_code == 403

    # Desmarcarlo la vuelve a una baja común.
    await patch_taxonomy(motivo, StatusTaxonomyPatch(blocks_reactivation=False), pool=pool, usuario=user)
    result = await lifecycle.transition(
        conn, entity="CARRIER", entity_id=carrier, action="reactivate", actor=user["sub"],
        reason_id=await _reason(conn, "REACTIVATION_REASON", "RELATIONSHIP_RESUMED"))
    assert result["operational_status"] == "ACTIVE"
