"""El ciclo de vida con fecha de vigencia y la activación de una empresa en onboarding
(plan 2026-10-28, "Empresas en onboarding en el Cierre").

Reglas del usuario (28/10):
  · Activa Certificación (directory.delete), con la fecha que elija; por defecto, mañana.
  · Una excepción es provisoria: pide fecha de compromiso. Si a esa fecha la carpeta no
    cumple, vuelve sola a onboarding desde el día siguiente.
  · Se activa sola cuando la carpeta (propia y de la flota) cumple y tiene RUT: desde mañana.
  · Existe "volver a onboarding", desde activa o dada de baja.
  · Un cambio rige desde su día: no reescribe los días anteriores.
Contra Postgres de verdad, en una transacción revertida."""
from __future__ import annotations

from datetime import date, timedelta

import pytest
from fastapi import HTTPException

from app.authz.permissions import Permission
from app.services import lifecycle

from .conftest import _usuario_real
from .test_lifecycle_integration import (
    _carrier, _driver, _missing_mandatory, _reason, _status, _without_documents,
)

pytestmark = pytest.mark.integracion


async def _today(conn) -> date:
    return await conn.fetchval("SELECT app.first_unclosed_day(public.hoy_chile())")


async def _status_on(conn, entity: str, entity_id: str, day: date) -> str | None:
    return await conn.fetchval("SELECT app.status_on($1, $2::uuid, $3)", entity, entity_id, day)


async def _ready_carrier(conn) -> str:
    """En onboarding, con RUT y sin nada que la bloquee."""
    carrier = await _carrier(conn, "ONBOARDING")
    await _without_documents(conn, carrier)
    return carrier


# ── La vigencia ──────────────────────────────────────────────────────────────

async def test_un_alta_y_un_cambio_directo_quedan_en_la_historia(conexion_revertida):
    """El trigger captura a cualquier escritor: el alta rige siempre; un UPDATE directo, desde hoy."""
    conn = conexion_revertida
    today = await _today(conn)
    driver = await _driver(conn)
    assert await _status_on(conn, "DRIVER", driver, date(2020, 1, 6)) == "ACTIVE"

    await conn.execute("UPDATE public.drivers SET operational_status = 'INACTIVE' WHERE id = $1", driver)

    assert await _status_on(conn, "DRIVER", driver, today - timedelta(days=1)) == "ACTIVE"
    assert await _status_on(conn, "DRIVER", driver, today) == "INACTIVE"


async def test_dar_de_baja_no_reescribe_los_dias_anteriores(conexion_revertida):
    conn = conexion_revertida
    actor = (await _usuario_real(conn))["sub"]
    today = await _today(conn)
    carrier = await _carrier(conn, "ACTIVE")

    await lifecycle.transition(conn, entity="CARRIER", entity_id=carrier, action="deactivate", actor=actor,
                               reason_id=await _reason(conn, "DEACTIVATION_REASON", "RELATIONSHIP_ENDED"))

    assert await _status_on(conn, "CARRIER", carrier, today - timedelta(days=1)) == "ACTIVE"
    assert await _status_on(conn, "CARRIER", carrier, today) == "INACTIVE"
    assert (await _status(conn, "CARRIER", carrier))["operational_status"] == "INACTIVE"


async def test_una_fecha_de_vigencia_pasada_es_422(conexion_revertida):
    conn = conexion_revertida
    actor = (await _usuario_real(conn))["sub"]
    carrier = await _ready_carrier(conn)
    with pytest.raises(HTTPException) as exc:
        await lifecycle.transition(conn, entity="CARRIER", entity_id=carrier, action="activate", actor=actor,
                                   effective_date=(await _today(conn)) - timedelta(days=1))
    assert exc.value.status_code == 422
    assert (await _status(conn, "CARRIER", carrier))["operational_status"] == "ONBOARDING"


# ── Activar: Certificación, con fecha ────────────────────────────────────────

def test_activar_y_volver_a_onboarding_son_de_certificacion():
    """Separación de funciones: habilita quien califica, no quien despacha (28/10)."""
    assert lifecycle.transition_for("CARRIER", "activate").permission == Permission.DIRECTORY_DELETE
    assert lifecycle.transition_for("CARRIER", "return_to_onboarding").permission == Permission.DIRECTORY_DELETE


async def test_activar_sin_fecha_rige_desde_manana(conexion_revertida):
    conn = conexion_revertida
    actor = (await _usuario_real(conn))["sub"]
    today = await _today(conn)
    carrier = await _ready_carrier(conn)

    result = await lifecycle.transition(conn, entity="CARRIER", entity_id=carrier, action="activate", actor=actor)

    assert result["effective_date"] == (today + timedelta(days=1)).isoformat()
    assert (await _status(conn, "CARRIER", carrier))["operational_status"] == "ONBOARDING"
    assert await _status_on(conn, "CARRIER", carrier, today) == "ONBOARDING"
    assert await _status_on(conn, "CARRIER", carrier, today + timedelta(days=1)) == "ACTIVE"


async def test_activar_con_fecha_de_hoy_rige_hoy(conexion_revertida):
    conn = conexion_revertida
    actor = (await _usuario_real(conn))["sub"]
    today = await _today(conn)
    carrier = await _ready_carrier(conn)

    await lifecycle.transition(conn, entity="CARRIER", entity_id=carrier, action="activate", actor=actor,
                               effective_date=today)

    assert (await _status(conn, "CARRIER", carrier))["operational_status"] == "ACTIVE"
    assert await _status_on(conn, "CARRIER", carrier, today) == "ACTIVE"


async def test_un_cambio_programado_llega_a_la_fila_cuando_rige(conexion_revertida):
    conn = conexion_revertida
    carrier = await _ready_carrier(conn)
    today = await _today(conn)
    # Un período que rige desde hoy pero que la fila todavía no refleja (lo programado de ayer).
    await conn.execute("SELECT app.write_status_period('CARRIER', $1::uuid, 'ACTIVE', $2, 'app', "
                       "NULL, NULL, NULL, NULL)", carrier, today)
    assert (await _status(conn, "CARRIER", carrier))["operational_status"] == "ONBOARDING"

    assert await conn.fetchval("SELECT app.apply_due_lifecycle_statuses()") >= 1

    assert (await _status(conn, "CARRIER", carrier))["operational_status"] == "ACTIVE"


async def test_la_excepcion_pide_fecha_de_compromiso(conexion_revertida):
    conn = conexion_revertida
    actor = (await _usuario_real(conn))["sub"]
    today = await _today(conn)
    carrier = await _carrier(conn, "ONBOARDING")
    await _without_documents(conn, carrier)
    await _missing_mandatory(conn, carrier)
    motivo = await _reason(conn, "ACTIVATION_EXCEPTION_REASON", "DOCUMENTS_IN_PROGRESS")

    with pytest.raises(HTTPException) as exc:
        await lifecycle.transition(conn, entity="CARRIER", entity_id=carrier, action="activate", actor=actor,
                                   reason_id=motivo, effective_date=today)
    assert exc.value.status_code == 422

    await lifecycle.transition(conn, entity="CARRIER", entity_id=carrier, action="activate", actor=actor,
                               reason_id=motivo, effective_date=today,
                               exception_until=today + timedelta(days=7))
    until = await conn.fetchval(
        "SELECT exception_until FROM app.lifecycle_status_periods "
        "WHERE entity_type = 'CARRIER' AND entity_id = $1::uuid AND valid_during @> $2::date", carrier, today)
    assert until == today + timedelta(days=7)


async def test_sin_excepcion_no_se_manda_fecha_de_compromiso(conexion_revertida):
    conn = conexion_revertida
    actor = (await _usuario_real(conn))["sub"]
    today = await _today(conn)
    carrier = await _ready_carrier(conn)
    with pytest.raises(HTTPException) as exc:
        await lifecycle.transition(conn, entity="CARRIER", entity_id=carrier, action="activate", actor=actor,
                                   effective_date=today, exception_until=today + timedelta(days=7))
    assert exc.value.status_code == 422


# ── Volver a onboarding ──────────────────────────────────────────────────────

# Solo desde activa (28/10): una dada de baja vuelve con "Reactivar", que decide según su carpeta.
@pytest.mark.parametrize("start,ok", [("ACTIVE", True), ("INACTIVE", False), ("ONBOARDING", False)])
async def test_volver_a_onboarding(conexion_revertida, start, ok):
    conn = conexion_revertida
    actor = (await _usuario_real(conn))["sub"]
    carrier = await _carrier(conn, start)
    motivo = await _reason(conn, "RETURN_TO_ONBOARDING_REASON", "ACTIVATED_BY_MISTAKE")

    if not ok:
        with pytest.raises(HTTPException) as exc:
            await lifecycle.transition(conn, entity="CARRIER", entity_id=carrier, action="return_to_onboarding",
                                       actor=actor, reason_id=motivo)
        assert exc.value.status_code == 409
        return

    await lifecycle.transition(conn, entity="CARRIER", entity_id=carrier, action="return_to_onboarding",
                               actor=actor, reason_id=motivo)
    row = await _status(conn, "CARRIER", carrier)
    assert (row["operational_status"], row["reason_id"]) == ("ONBOARDING", motivo)


async def test_volver_a_onboarding_pide_un_motivo_de_su_vocabulario(conexion_revertida):
    conn = conexion_revertida
    actor = (await _usuario_real(conn))["sub"]
    carrier = await _carrier(conn, "ACTIVE")
    with pytest.raises(HTTPException) as exc:
        await lifecycle.transition(conn, entity="CARRIER", entity_id=carrier, action="return_to_onboarding",
                                   actor=actor, reason_id=await _reason(conn, "DEACTIVATION_REASON",
                                                                        "RELATIONSHIP_ENDED"))
    assert exc.value.status_code == 422


# ── La activación automática y la excepción que vence ────────────────────────

async def test_la_empresa_que_cumple_se_activa_sola_desde_manana(conexion_revertida):
    conn = conexion_revertida
    today = await _today(conn)
    lista = await _ready_carrier(conn)
    sin_rut = await _carrier(conn, "ONBOARDING", tax_id=None)
    await _without_documents(conn, sin_rut)
    con_pendientes = await _carrier(conn, "ONBOARDING")
    await _without_documents(conn, con_pendientes)
    await _missing_mandatory(conn, con_pendientes)

    await lifecycle.activate_ready_carriers(conn)

    manana = today + timedelta(days=1)
    assert await _status_on(conn, "CARRIER", lista, manana) == "ACTIVE"
    assert await _status_on(conn, "CARRIER", lista, today) == "ONBOARDING"
    assert await _status_on(conn, "CARRIER", sin_rut, manana) == "ONBOARDING"
    assert await _status_on(conn, "CARRIER", con_pendientes, manana) == "ONBOARDING"
    source = await conn.fetchval(
        "SELECT source FROM app.lifecycle_status_periods WHERE entity_type = 'CARRIER' "
        "AND entity_id = $1::uuid AND valid_during @> $2::date", lista, manana)
    assert source == "auto"
    # Una segunda pasada no la vuelve a programar.
    await lifecycle.activate_ready_carriers(conn)
    assert await conn.fetchval(
        "SELECT count(*) FROM app.lifecycle_status_periods WHERE entity_type = 'CARRIER' AND entity_id = $1::uuid",
        lista) == 2


async def test_la_excepcion_vencida_sin_cumplir_vuelve_a_onboarding(conexion_revertida):
    conn = conexion_revertida
    actor = (await _usuario_real(conn))["sub"]
    today = await _today(conn)
    debe = await _carrier(conn, "ONBOARDING")
    cumplio = await _carrier(conn, "ONBOARDING")
    motivo = await _reason(conn, "ACTIVATION_EXCEPTION_REASON", "DOCUMENTS_IN_PROGRESS")
    for carrier in (debe, cumplio):
        await _without_documents(conn, carrier)
        await _missing_mandatory(conn, carrier)
        await lifecycle.transition(conn, entity="CARRIER", entity_id=carrier, action="activate", actor=actor,
                                   reason_id=motivo, effective_date=today, exception_until=today)
    await _without_documents(conn, cumplio)   # completó su carpeta a tiempo

    await lifecycle.activate_ready_carriers(conn, today=today + timedelta(days=1))

    manana = today + timedelta(days=1)
    assert await _status_on(conn, "CARRIER", debe, manana) == "ONBOARDING"
    assert await _status_on(conn, "CARRIER", debe, today) == "ACTIVE"
    assert await _status_on(conn, "CARRIER", cumplio, manana) == "ACTIVE"


# ── Una empresa dada de baja que vuelve (28/10) ──────────────────────────────

async def _deactivated_with(conn, actor: str, reason_code: str) -> str:
    carrier = await _carrier(conn, "ACTIVE")
    await lifecycle.transition(conn, entity="CARRIER", entity_id=carrier, action="deactivate", actor=actor,
                               reason_id=await _reason(conn, "DEACTIVATION_REASON", reason_code))
    return carrier


async def _reactivate(conn, actor: str, carrier: str, **kw) -> dict:
    return await lifecycle.transition(conn, entity="CARRIER", entity_id=carrier, action="reactivate", actor=actor,
                                      reason_id=await _reason(conn, "REACTIVATION_REASON", "RELATIONSHIP_RESUMED"),
                                      **kw)


async def test_reactivar_con_la_carpeta_completa_vuelve_a_activa(conexion_revertida):
    conn = conexion_revertida
    actor = (await _usuario_real(conn))["sub"]
    carrier = await _deactivated_with(conn, actor, "RELATIONSHIP_ENDED")
    await _without_documents(conn, carrier)

    result = await _reactivate(conn, actor, carrier)

    assert result["operational_status"] == "ACTIVE"


async def test_reactivar_con_la_carpeta_incompleta_queda_en_onboarding(conexion_revertida):
    """Recalificación: vuelve por la misma puerta que una empresa nueva."""
    conn = conexion_revertida
    actor = (await _usuario_real(conn))["sub"]
    carrier = await _deactivated_with(conn, actor, "RELATIONSHIP_ENDED")
    await _without_documents(conn, carrier)
    await _missing_mandatory(conn, carrier)

    result = await _reactivate(conn, actor, carrier)

    assert result["operational_status"] == "ONBOARDING"
    assert (await _status(conn, "CARRIER", carrier))["operational_status"] == "ONBOARDING"
    # Al completar la carpeta se activa sola, como cualquier empresa en onboarding.
    await _without_documents(conn, carrier)
    await lifecycle.activate_ready_carriers(conn)
    assert await _status_on(conn, "CARRIER", carrier, (await _today(conn)) + timedelta(days=1)) == "ACTIVE"


async def test_una_baja_definitiva_no_se_reactiva_sin_el_permiso(conexion_revertida):
    conn = conexion_revertida
    actor = (await _usuario_real(conn))["sub"]
    carrier = await _deactivated_with(conn, actor, "DO_NOT_REHIRE")
    await _without_documents(conn, carrier)

    def sin_permiso():
        raise HTTPException(403, "sin permiso")

    with pytest.raises(HTTPException) as exc:
        await _reactivate(conn, actor, carrier, reinstate_check=sin_permiso)
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as exc:   # sin chequeo también se niega: nunca pasa por defecto
        await _reactivate(conn, actor, carrier)
    assert exc.value.status_code == 403
    assert (await _status(conn, "CARRIER", carrier))["operational_status"] == "INACTIVE"

    llamado = []
    result = await _reactivate(conn, actor, carrier, reinstate_check=lambda: llamado.append(True))
    assert llamado == [True]
    assert result["operational_status"] == "ACTIVE"


async def test_una_baja_comun_no_pide_el_permiso(conexion_revertida):
    conn = conexion_revertida
    actor = (await _usuario_real(conn))["sub"]
    carrier = await _deactivated_with(conn, actor, "RELATIONSHIP_ENDED")
    await _without_documents(conn, carrier)

    def no_deberia_llamarse():
        raise AssertionError("una baja común no pide directory.reinstate")

    assert (await _reactivate(conn, actor, carrier, reinstate_check=no_deberia_llamarse))["operational_status"] == "ACTIVE"


def test_revertir_una_baja_definitiva_es_solo_de_administracion():
    from app.authz.permissions import PERMISSION_META, SYSTEM_ROLES
    assert PERMISSION_META[Permission.DIRECTORY_REINSTATE].privileged
    con_el_permiso = {r.code for r in SYSTEM_ROLES if Permission.DIRECTORY_REINSTATE in r.permissions or r.grants_all}
    assert con_el_permiso == {"owner", "admin"}
