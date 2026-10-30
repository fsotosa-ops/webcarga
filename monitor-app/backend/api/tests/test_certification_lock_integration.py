"""Lo dado de baja no recibe documentación, por ningún camino (30/10).

Antes la regla estaba dos veces y comparaba `<> 'ACTIVE'`: una empresa en
onboarding —la que arma su carpeta— no podía recibir archivos, y los otros ocho
caminos de escritura no tenían regla. Ahora vive en
`services/certification_lock.py` y cada camino la llama. Estos tests ejecutan
los endpoints reales contra Postgres, dentro de la transacción revertida de
`conexion_revertida`: nada queda escrito.

Un test por camino con una empresa dada de baja: si alguno deja de llamar a la
regla, su test se pone rojo. Y la carga directa con una empresa en onboarding,
que es el bug que originó esto.
"""
from __future__ import annotations

import io
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

from app.routers.certification_requests import CertificationRequestBody, create_request
from app.routers.compliance import (
    cargar_planilla, delete_compliance_file, patch_compliance_record,
    reassign_compliance_document, solicitar_documento, upload_compliance_file,
)
from app.routers.document_ingest import classify_batch, move_items, upload_to_tray
from app.schemas.compliance import ComplianceRecordPatchBody, ReassignBody, SolicitudBody
from app.schemas.document_ingest import ClassifyBatchBody, MoveItemsBody
from app.services.certification_lock import ensure_subject_open, locked_records
from tests import d1_subjects as s
from tests.conftest import USER, PoolDeUnaConexion, _usuario_real

pytestmark = pytest.mark.integracion


def _pdf() -> UploadFile:
    return UploadFile(io.BytesIO(b"%PDF-1.4"), filename="doc.pdf",
                      headers=Headers({"content-type": "application/pdf"}))


def _supabase() -> MagicMock:
    supabase = MagicMock()
    supabase.storage.from_.return_value.upload.return_value = None
    return supabase


async def _registro(conn, entity_type: str, entity_id: str, *, status: str = "MISSING") -> str:
    """Un requisito sin fecha y su registro, para que lo único que decida sea la regla."""
    requisito = await s.requirement(conn, entity=entity_type, policy="NONE")
    await s.without_seeding(conn, entity_id)
    return await s.record(conn, requisito, entity_type, entity_id, status=status)


async def _item_de_bandeja(conn, carrier_id: str) -> str:
    lote = await conn.fetchval(
        "INSERT INTO public.document_ingest_batches (carrier_id, source, status, created_by, total_files, unmatched) "
        "VALUES ($1, 'UPLOAD', 'REVIEW', $2, 1, 1) RETURNING id::text", carrier_id, USER["sub"])
    return await conn.fetchval(
        "INSERT INTO public.document_ingest_items (batch_id, storage_path, file_name, mime_type, size_bytes, match_status) "
        "VALUES ($1::uuid, 'zz/bandeja.pdf', 'bandeja.pdf', 'application/pdf', 8, 'UNMATCHED') RETURNING id::text", lote)


async def _rechaza(llamada) -> str:
    with pytest.raises(HTTPException) as e:
        await llamada
    assert e.value.status_code == 409, e.value.detail
    return str(e.value.detail)


# ── La regla ──────────────────────────────────────────────────────────────────


async def test_la_regla_por_estado(conexion_revertida):
    conn = conexion_revertida
    activa = await s.carrier(conn, status="ACTIVE")
    onboarding = await s.carrier(conn, status="ONBOARDING")
    de_baja = await s.carrier(conn, status="INACTIVE")
    casos = {
        "empresa activa": (await _registro(conn, "CARRIER", activa), False),
        "empresa en onboarding": (await _registro(conn, "CARRIER", onboarding), False),
        "empresa de baja": (await _registro(conn, "CARRIER", de_baja), True),
        "conductor de una empresa en onboarding": (
            await _registro(conn, "DRIVER", await s.driver(conn, onboarding)), False),
        "conductor de una empresa de baja": (
            await _registro(conn, "DRIVER", await s.driver(conn, de_baja)), True),
        "equipo de una empresa de baja": (
            await _registro(conn, "ASSET", await s.asset(conn, de_baja)), True),
        "conductor de baja en una empresa activa": (
            await _registro(conn, "DRIVER", await s.driver(conn, activa, status="INACTIVE")), True),
        "conductor sin empresa vigente": (
            await _registro(conn, "DRIVER", await s.driver(conn, None)), False),
    }
    bloqueados = await locked_records(conn, [rid for rid, _ in casos.values()])
    for nombre, (rid, debe_bloquear) in casos.items():
        assert (rid in bloqueados) is debe_bloquear, nombre
    assert "está dada de baja" in bloqueados[casos["empresa de baja"][0]]
    assert bloqueados[casos["conductor de baja en una empresa activa"][0]].startswith("El conductor ")


# ── La carga directa: el bug que originó esto ──────────────────────────────────


async def test_una_empresa_en_onboarding_recibe_archivos(conexion_revertida):
    conn = conexion_revertida
    registro = await _registro(conn, "CARRIER", await s.carrier(conn, status="ONBOARDING"))
    supabase = _supabase()
    # La carga deja auditoría con su autor: tiene que ser un usuario que exista.
    await upload_compliance_file(registro, file=_pdf(), expiration_date=None, issue_date=None,
                                 period_start=None, pool=PoolDeUnaConexion(conn), supabase=supabase,
                                 user=await _usuario_real(conn))
    supabase.storage.from_.return_value.upload.assert_called_once()
    assert await conn.fetchval("SELECT file_url IS NOT NULL FROM public.compliance_records WHERE id = $1", registro)


async def test_subir_a_una_empresa_de_baja_se_rechaza_antes_de_tocar_storage(conexion_revertida):
    conn = conexion_revertida
    registro = await _registro(conn, "CARRIER", await s.carrier(conn, status="INACTIVE"))
    supabase = _supabase()
    await _rechaza(upload_compliance_file(
        registro, file=_pdf(), expiration_date=None, issue_date=None, period_start=None,
        pool=PoolDeUnaConexion(conn), supabase=supabase, user=USER))
    supabase.storage.from_.return_value.upload.assert_not_called()


# ── Los demás caminos ─────────────────────────────────────────────────────────


async def test_editar_un_registro_de_baja_se_rechaza(conexion_revertida):
    conn = conexion_revertida
    registro = await _registro(conn, "CARRIER", await s.carrier(conn, status="INACTIVE"))
    await _rechaza(patch_compliance_record(
        registro, ComplianceRecordPatchBody(status="APPROVED_MANUAL"),
        pool=PoolDeUnaConexion(conn), supabase=_supabase(), user=USER))


async def test_borrar_el_archivo_de_un_registro_de_baja_se_rechaza(conexion_revertida):
    conn = conexion_revertida
    registro = await _registro(conn, "CARRIER", await s.carrier(conn, status="INACTIVE"), status="APPROVED_MANUAL")
    await _rechaza(delete_compliance_file(registro, pool=PoolDeUnaConexion(conn), supabase=_supabase(), user=USER))


async def test_reasignar_hacia_una_empresa_de_baja_se_rechaza(conexion_revertida):
    conn = conexion_revertida
    origen = await _registro(conn, "CARRIER", await s.carrier(conn, status="ACTIVE"), status="APPROVED_MANUAL")
    de_baja = await s.carrier(conn, status="INACTIVE")
    requisito = await s.requirement(conn, entity="CARRIER", policy="NONE")
    await s.without_seeding(conn, de_baja)
    await s.record(conn, requisito, "CARRIER", de_baja)
    await _rechaza(reassign_compliance_document(
        origen, ReassignBody(target_entity_type="CARRIER", target_entity_id=de_baja, target_requirement_id=requisito),
        pool=PoolDeUnaConexion(conn), supabase=_supabase(), user=USER))


async def test_solicitar_un_documento_a_una_empresa_de_baja_se_rechaza(conexion_revertida):
    conn = conexion_revertida
    de_baja = await s.carrier(conn, status="INACTIVE")
    requisito = await s.requirement(conn, entity="CARRIER", policy="NONE", exigible_on="ON_REQUEST")
    await conn.execute("UPDATE public.compliance_requirements SET is_active = true WHERE id = $1", requisito)
    await _rechaza(solicitar_documento(
        SolicitudBody(requirement_id=requisito, entity_type="CARRIER", entity_id=de_baja),
        pool=PoolDeUnaConexion(conn), user=USER))


async def test_operaciones_no_pide_documentos_a_una_empresa_de_baja(conexion_revertida):
    conn = conexion_revertida
    de_baja = await s.carrier(conn, status="INACTIVE")
    await _rechaza(create_request(
        CertificationRequestBody(entity_type="CARRIER", entity_id=de_baja, note="zz"),
        pool=PoolDeUnaConexion(conn), user=USER))


async def test_la_planilla_no_escribe_en_una_empresa_de_baja(conexion_revertida):
    conn = conexion_revertida
    registro = await _registro(conn, "CARRIER", await s.carrier(conn, status="INACTIVE"))
    csv = f"id_registro;documento_recibido;fecha_vencimiento\n{registro};si;\n".encode()
    archivo = UploadFile(io.BytesIO(csv), filename="planilla.csv", headers=Headers({"content-type": "text/csv"}))
    respuesta = await cargar_planilla(file=archivo, dry_run=True, pool=PoolDeUnaConexion(conn), user=USER)
    errores = [e for e in respuesta["errores"] if e.get("registro_id") == registro]
    assert errores and "está dada de baja" in errores[0]["error"], respuesta


async def test_la_bandeja_de_una_empresa_de_baja_no_recibe_archivos(conexion_revertida):
    conn = conexion_revertida
    de_baja = await s.carrier(conn, status="INACTIVE")
    supabase = _supabase()
    await _rechaza(upload_to_tray(de_baja, files=[_pdf()], requirement_id=None, requirement_code=None,
                                  requirement_target=None, pool=PoolDeUnaConexion(conn), supabase=supabase, user=USER))
    supabase.storage.from_.return_value.upload.assert_not_called()


async def test_mover_archivos_hacia_una_empresa_de_baja_se_rechaza_y_sacarlos_no(conexion_revertida):
    conn = conexion_revertida
    de_baja = await s.carrier(conn, status="INACTIVE")
    activa = await s.carrier(conn, status="ACTIVE")
    varado = await _item_de_bandeja(conn, de_baja)
    await _rechaza(move_items(MoveItemsBody(item_ids=[varado], carrier_id=de_baja), pool=PoolDeUnaConexion(conn), user=USER))
    # Sacar un archivo varado hacia una empresa en certificación sí se puede.
    await move_items(MoveItemsBody(item_ids=[varado], carrier_id=activa), pool=PoolDeUnaConexion(conn), user=USER)
    assert await conn.fetchval("SELECT carrier_id::text FROM public.document_ingest_items WHERE id = $1", varado) == activa


async def test_clasificar_hacia_una_empresa_de_baja_se_rechaza(conexion_revertida):
    conn = conexion_revertida
    de_baja = await s.carrier(conn, status="INACTIVE")
    requisito = await s.requirement(conn, entity="CARRIER", policy="NONE")
    await s.without_seeding(conn, de_baja)
    await s.record(conn, requisito, "CARRIER", de_baja)
    item = await _item_de_bandeja(conn, de_baja)
    await _rechaza(classify_batch(
        ClassifyBatchBody(item_ids=[item], entity_type="CARRIER", entity_id=de_baja, requirement_id=requisito),
        pool=PoolDeUnaConexion(conn), user=USER))


async def test_un_conductor_sin_empresa_vigente_recibe_documentos(conexion_revertida):
    conn = conexion_revertida
    await ensure_subject_open(conn, "DRIVER", await s.driver(conn, None))


# ── Reactivar abre de nuevo ───────────────────────────────────────────────────
# La regla lee el estado al momento de escribir, no una marca guardada: reactivar
# alcanza. Una empresa que vuelve con la carpeta incompleta entra en onboarding
# (28/10), y en onboarding se carga.


async def test_una_empresa_reactivada_vuelve_a_onboarding_y_recibe_archivos(conexion_revertida):
    from app.services import lifecycle
    from tests.test_lifecycle_integration import _reason

    conn = conexion_revertida
    user = await _usuario_real(conn)
    empresa = await s.carrier(conn, status="ACTIVE")
    registro = await _registro(conn, "CARRIER", empresa)  # pendiente: la carpeta queda incompleta

    await lifecycle.transition(conn, entity="CARRIER", entity_id=empresa, action="deactivate", actor=user["sub"],
                               reason_id=await _reason(conn, "DEACTIVATION_REASON", "RELATIONSHIP_ENDED"))
    await _rechaza(upload_compliance_file(
        registro, file=_pdf(), expiration_date=None, issue_date=None, period_start=None,
        pool=PoolDeUnaConexion(conn), supabase=_supabase(), user=user))

    reactivada = await lifecycle.transition(
        conn, entity="CARRIER", entity_id=empresa, action="reactivate", actor=user["sub"],
        reason_id=await _reason(conn, "REACTIVATION_REASON", "RELATIONSHIP_RESUMED"))
    assert reactivada["operational_status"] == "ONBOARDING"

    supabase = _supabase()
    await upload_compliance_file(registro, file=_pdf(), expiration_date=None, issue_date=None, period_start=None,
                                 pool=PoolDeUnaConexion(conn), supabase=supabase, user=user)
    supabase.storage.from_.return_value.upload.assert_called_once()


async def test_un_conductor_reactivado_vuelve_a_recibir_documentos(conexion_revertida):
    from app.services import lifecycle
    from tests.test_lifecycle_integration import _reason

    conn = conexion_revertida
    user = await _usuario_real(conn)
    conductor = await s.driver(conn, await s.carrier(conn, status="ACTIVE"), status="INACTIVE")
    await _rechaza(ensure_subject_open(conn, "DRIVER", conductor))

    await lifecycle.transition(conn, entity="DRIVER", entity_id=conductor, action="reactivate", actor=user["sub"],
                               reason_id=await _reason(conn, "REACTIVATION_REASON", "RELATIONSHIP_RESUMED"))
    await ensure_subject_open(conn, "DRIVER", conductor)
