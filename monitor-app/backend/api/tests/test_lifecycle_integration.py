"""El ciclo de vida del Directorio contra la base (plan 2026-10-21).

La matriz de abajo es la regla de negocio escrita a mano, a propósito: si se
derivara de `LIFECYCLE_TRANSITIONS`, un error en la tabla pasaría el test."""
from __future__ import annotations

import uuid

import asyncpg
import pytest
from fastapi import HTTPException

from app.services import fleet_assignments as fa
from app.services import lifecycle

from .conftest import _usuario_real

pytestmark = pytest.mark.integracion

PREFIX = "ZZ-TEST-LIFECYCLE"


def _rut() -> str:
    return f"7{uuid.uuid4().int % 10**7:07d}-K"


async def _carrier(conn, status: str, *, tax_id: str | None = "auto") -> str:
    return str(await conn.fetchval(
        "INSERT INTO public.carriers (business_name, operational_status, tax_id) VALUES ($1, $2, $3) RETURNING id",
        f"{PREFIX} Empresa {uuid.uuid4().hex[:6]}", status, _rut() if tax_id == "auto" else tax_id))


async def _driver(conn, status: str = "ACTIVE") -> str:
    return str(await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status) VALUES ($1, $2) RETURNING id",
        f"{PREFIX} Conductor {uuid.uuid4().hex[:6]}", status))


async def _asset(conn, status: str = "ACTIVE") -> str:
    return str(await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type, operational_status) "
        "VALUES ($1, 'TRACTOCAMION', $2) RETURNING id",
        f"ZZ{uuid.uuid4().hex[:4].upper()}", status))


async def _subject(conn, entity: str, status: str) -> str:
    return await {"CARRIER": _carrier, "DRIVER": _driver, "ASSET": _asset}[entity](conn, status)


async def _without_documents(conn, entity_id: str) -> None:
    """Sin la carpeta sembrada al crear: nada que la bloquee (cumple para activarse)."""
    await conn.execute("DELETE FROM public.compliance_records WHERE entity_id = $1::uuid", entity_id)


async def _reason(conn, domain: str, code: str) -> str:
    return str(await conn.fetchval(
        "SELECT id FROM app.status_taxonomies WHERE domain = $1 AND code = $2", domain, code))


async def _new_reason(conn, domain: str, group: str, *, active: bool = True) -> str:
    return str(await conn.fetchval(
        "INSERT INTO app.status_taxonomies (domain, label, group_id, active) VALUES ($1, $2, $3, $4) RETURNING id",
        domain, f"{PREFIX} {uuid.uuid4().hex[:6]}", group, active))


def _reason_for(action: str) -> tuple[str, str] | None:
    return {"deactivate": ("DEACTIVATION_REASON", "RELATIONSHIP_ENDED"),
            "reactivate": ("REACTIVATION_REASON", "RELATIONSHIP_RESUMED")}.get(action)


async def _status(conn, entity: str, entity_id: str) -> asyncpg.Record:
    table = {"CARRIER": "carriers", "DRIVER": "drivers", "ASSET": "assets"}[entity]
    return await conn.fetchrow(
        f"SELECT operational_status, status_reason_id::text AS reason_id, status_note, status_changed_at "
        f"FROM public.{table} WHERE id = $1", entity_id)


# ── La matriz: estado de partida × acción → estado final, o 409 ─────────────────

MATRIX = [
    # entidad, desde, acción, hasta (None = no corresponde: 409)
    ("CARRIER", "ONBOARDING", "activate", "ACTIVE"),
    ("CARRIER", "ACTIVE", "activate", None),
    ("CARRIER", "INACTIVE", "activate", None),
    ("CARRIER", "ACTIVE", "deactivate", "INACTIVE"),
    ("CARRIER", "ONBOARDING", "deactivate", "INACTIVE"),
    ("CARRIER", "INACTIVE", "deactivate", None),
    ("CARRIER", "INACTIVE", "reactivate", "ACTIVE"),
    ("CARRIER", "ACTIVE", "reactivate", None),
    ("CARRIER", "ONBOARDING", "reactivate", None),
    ("DRIVER", "ACTIVE", "deactivate", "INACTIVE"),
    ("DRIVER", "INACTIVE", "deactivate", None),
    ("DRIVER", "INACTIVE", "reactivate", "ACTIVE"),
    ("DRIVER", "ACTIVE", "reactivate", None),
    ("ASSET", "ACTIVE", "deactivate", "INACTIVE"),
    ("ASSET", "INACTIVE", "deactivate", None),
    ("ASSET", "INACTIVE", "reactivate", "ACTIVE"),
    ("ASSET", "ACTIVE", "reactivate", None),
]


@pytest.mark.parametrize("entity,start,action,end", MATRIX)
async def test_la_matriz_de_transiciones(conexion_revertida, entity, start, action, end):
    conn = conexion_revertida
    actor = (await _usuario_real(conn))["sub"]
    subject = await _subject(conn, entity, start)
    if action == "activate":
        await _without_documents(conn, subject)   # la regla de la carpeta tiene sus propios tests
    reason = _reason_for(action)
    reason_id = await _reason(conn, *reason) if reason else None

    if end is None:
        with pytest.raises(HTTPException) as exc:
            await lifecycle.transition(conn, entity=entity, entity_id=subject, action=action,
                                       actor=actor, reason_id=reason_id)
        assert exc.value.status_code == 409
        assert (await _status(conn, entity, subject))["operational_status"] == start
        return

    await lifecycle.transition(conn, entity=entity, entity_id=subject, action=action,
                               actor=actor, reason_id=reason_id)
    row = await _status(conn, entity, subject)
    assert row["operational_status"] == end
    assert row["reason_id"] == reason_id
    assert row["status_changed_at"] is not None


@pytest.mark.parametrize("entity,action", [("DRIVER", "activate"), ("ASSET", "activate")])
def test_conductores_y_equipos_no_se_activan(entity, action):
    """Nacen activos: no hay transición `activate` para la flota."""
    assert (entity, action) not in lifecycle.LIFECYCLE_TRANSITIONS


# ── El motivo ──────────────────────────────────────────────────────────────────

async def test_dar_de_baja_deja_el_motivo_y_la_auditoria(conexion_revertida):
    conn = conexion_revertida
    actor = (await _usuario_real(conn))["sub"]
    driver = await _driver(conn)
    other = await _reason(conn, "DEACTIVATION_REASON", "OTHER")

    await lifecycle.transition(conn, entity="DRIVER", entity_id=driver, action="deactivate",
                               actor=actor, reason_id=other, note="  Se fue a otra empresa  ")

    row = await _status(conn, "DRIVER", driver)
    assert (row["reason_id"], row["status_note"]) == (other, "Se fue a otra empresa")
    audit = await conn.fetch(
        "SELECT action, field, old_value, new_value FROM public.audit_log "
        "WHERE entity_type = 'DRIVER' AND entity_id = $1 ORDER BY id", driver)
    assert [(a["action"], a["field"]) for a in audit] == [("update", "operational_status"), ("deactivate", None)]
    assert '"Se fue a otra empresa"' in audit[1]["new_value"]


@pytest.mark.parametrize("case", ["missing", "wrong_domain", "inactive", "other_entity", "other_without_note"])
async def test_un_motivo_invalido_es_422_y_no_escribe(conexion_revertida, case):
    conn = conexion_revertida
    actor = (await _usuario_real(conn))["sub"]
    driver = await _driver(conn)
    reason_id = {
        "missing": None,
        "wrong_domain": await _reason(conn, "REACTIVATION_REASON", "RELATIONSHIP_RESUMED"),
        "inactive": await _new_reason(conn, "DEACTIVATION_REASON", "all", active=False),
        # Un motivo solo de equipos no sirve para un conductor.
        "other_entity": await _reason(conn, "DEACTIVATION_REASON", "ASSET_RETIRED"),
        "other_without_note": await _reason(conn, "DEACTIVATION_REASON", "OTHER"),
    }[case]

    with pytest.raises(HTTPException) as exc:
        await lifecycle.transition(conn, entity="DRIVER", entity_id=driver, action="deactivate",
                                   actor=actor, reason_id=reason_id, note="   ")
    assert exc.value.status_code == 422
    assert (await _status(conn, "DRIVER", driver))["operational_status"] == "ACTIVE"


async def test_un_motivo_creado_en_configuracion_sirve_para_su_entidad(conexion_revertida):
    """Una fila nueva no tiene `code` (Configuración no lo escribe): vale igual."""
    conn = conexion_revertida
    actor = (await _usuario_real(conn))["sub"]
    asset = await _asset(conn)
    reason_id = await _new_reason(conn, "DEACTIVATION_REASON", "asset")
    await lifecycle.transition(conn, entity="ASSET", entity_id=asset, action="deactivate",
                               actor=actor, reason_id=reason_id)
    assert (await _status(conn, "ASSET", asset))["reason_id"] == reason_id


# ── Empresas: RUT y flota ──────────────────────────────────────────────────────

async def test_activar_una_empresa_sin_rut_pide_el_rut(conexion_revertida):
    conn = conexion_revertida
    actor = (await _usuario_real(conn))["sub"]
    carrier = await _carrier(conn, "ONBOARDING", tax_id=None)
    await _without_documents(conn, carrier)

    with pytest.raises(HTTPException) as exc:
        await lifecycle.transition(conn, entity="CARRIER", entity_id=carrier, action="activate", actor=actor)
    assert exc.value.status_code == 422

    rut = _rut()
    await lifecycle.transition(conn, entity="CARRIER", entity_id=carrier, action="activate", actor=actor, tax_id=rut)
    row = await conn.fetchrow("SELECT operational_status, tax_id FROM public.carriers WHERE id = $1", carrier)
    assert (row["operational_status"], row["tax_id"]) == ("ACTIVE", rut)


async def test_activar_con_un_rut_que_ya_existe_es_409(conexion_revertida):
    conn = conexion_revertida
    actor = (await _usuario_real(conn))["sub"]
    existing = await conn.fetchval("SELECT tax_id FROM public.carriers WHERE id = $1", await _carrier(conn, "ACTIVE"))
    carrier = await _carrier(conn, "ONBOARDING", tax_id=None)
    with pytest.raises(HTTPException) as exc:
        await lifecycle.transition(conn, entity="CARRIER", entity_id=carrier, action="activate",
                                   actor=actor, tax_id=existing)
    assert exc.value.status_code == 409


async def test_reactivar_una_empresa_sin_rut_es_422(conexion_revertida):
    conn = conexion_revertida
    actor = (await _usuario_real(conn))["sub"]
    carrier = await _carrier(conn, "INACTIVE", tax_id=None)
    with pytest.raises(HTTPException) as exc:
        await lifecycle.transition(conn, entity="CARRIER", entity_id=carrier, action="reactivate", actor=actor,
                                   reason_id=await _reason(conn, "REACTIVATION_REASON", "RELATIONSHIP_RESUMED"))
    assert exc.value.status_code == 422


async def test_una_heredada_del_padron_viejo_se_reactiva_con_la_flota_elegida(conexion_revertida):
    """El caso que originó el cambio: una empresa dada de baja por el padrón viejo
    (hoy INACTIVE con motivo LEGACY_IMPORT) vuelve con la flota que se eligió."""
    conn = conexion_revertida
    actor = (await _usuario_real(conn))["sub"]
    carrier = await _carrier(conn, "ACTIVE")
    kept, released = await _driver(conn), await _driver(conn)
    for d in (kept, released):
        await fa.assign(conn, fa.DRIVER, d, carrier, actor=actor)
    await conn.execute(
        "UPDATE public.carriers SET operational_status = 'INACTIVE', status_reason_id = $2 WHERE id = $1",
        carrier, await _reason(conn, "DEACTIVATION_REASON", "LEGACY_IMPORT"))

    result = await lifecycle.transition(
        conn, entity="CARRIER", entity_id=carrier, action="reactivate", actor=actor,
        reason_id=await _reason(conn, "REACTIVATION_REASON", "RELATIONSHIP_RESUMED"),
        driver_ids=[kept], asset_ids=[])

    assert result == {"operational_status": "ACTIVE", "released_drivers": 1, "released_assets": 0}
    assert str(await conn.fetchval("SELECT app.carrier_of('DRIVER', $1::uuid)", kept)) == carrier
    assert await conn.fetchval("SELECT app.carrier_of('DRIVER', $1::uuid)", released) is None


# ── La migración ───────────────────────────────────────────────────────────────

async def test_la_baja_es_un_solo_estado(conexion_revertida):
    conn = conexion_revertida
    assert await conn.fetchval(
        "SELECT count(*) FROM public.carriers WHERE operational_status = 'LEGACY_INACTIVE'") == 0
    with pytest.raises(asyncpg.CheckViolationError):
        async with conn.transaction():
            await _carrier(conn, "LEGACY_INACTIVE")


async def test_toda_empresa_traspasada_por_la_migracion_tiene_su_motivo(conexion_revertida):
    conn = conexion_revertida
    sin_motivo = await conn.fetchval(
        """
        SELECT count(*) FROM public.audit_log a
        JOIN public.carriers c ON c.id = a.entity_id
        LEFT JOIN app.status_taxonomies r ON r.id = c.status_reason_id
        WHERE a.source = 'migration' AND a.field = 'operational_status'
          AND a.old_value = to_jsonb('LEGACY_INACTIVE'::text)
          AND c.operational_status = 'INACTIVE'
          AND r.code IS DISTINCT FROM 'LEGACY_IMPORT'
        """)
    assert sin_motivo == 0



# ── Onboarding (21/10): salir exige lo mismo que la habilitación ────────────────

async def _missing_mandatory(conn, carrier_id: str) -> None:
    """Un obligatorio legal que le falta a la empresa (lo que bloquea la habilitación),
    con los helpers de siempre (tests/d1_subjects.py)."""
    from . import d1_subjects as s
    await s.record(conn, await s.requirement(conn, entity="CARRIER"), "CARRIER", carrier_id)


async def test_una_empresa_en_onboarding_con_pendientes_no_se_activa(conexion_revertida):
    conn = conexion_revertida
    actor = (await _usuario_real(conn))["sub"]
    carrier = await _carrier(conn, "ONBOARDING")
    await _without_documents(conn, carrier)
    await _missing_mandatory(conn, carrier)

    with pytest.raises(HTTPException) as exc:
        await lifecycle.transition(conn, entity="CARRIER", entity_id=carrier, action="activate", actor=actor)

    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "ONBOARDING_INCOMPLETE"
    assert (exc.value.detail["own"], exc.value.detail["fleet"]) == (1, 0)
    assert (await _status(conn, "CARRIER", carrier))["operational_status"] == "ONBOARDING"


async def test_lo_que_le_falta_es_lo_mismo_que_la_habilitacion(conexion_revertida):
    """Una sola regla: requirements_pending lee requirements_met del resumen de documentos."""
    conn = conexion_revertida
    carrier = await _carrier(conn, "ONBOARDING")
    await _without_documents(conn, carrier)
    assert await lifecycle.requirements_pending(conn, carrier) is None
    await _missing_mandatory(conn, carrier)
    assert await lifecycle.requirements_pending(conn, carrier) == (1, 0)


async def test_activar_como_excepcion_pide_un_motivo_de_su_vocabulario(conexion_revertida):
    conn = conexion_revertida
    actor = (await _usuario_real(conn))["sub"]
    carrier = await _carrier(conn, "ONBOARDING")
    await _without_documents(conn, carrier)
    await _missing_mandatory(conn, carrier)

    with pytest.raises(HTTPException) as exc:   # un motivo de otro vocabulario no sirve
        await lifecycle.transition(conn, entity="CARRIER", entity_id=carrier, action="activate", actor=actor,
                                   reason_id=await _reason(conn, "REACTIVATION_REASON", "RELATIONSHIP_RESUMED"))
    assert exc.value.status_code == 422

    motivo = await _reason(conn, "ACTIVATION_EXCEPTION_REASON", "CLIENT_NEEDS_IT_NOW")
    await lifecycle.transition(conn, entity="CARRIER", entity_id=carrier, action="activate", actor=actor,
                               reason_id=motivo)
    row = await _status(conn, "CARRIER", carrier)
    assert (row["operational_status"], row["reason_id"]) == ("ACTIVE", motivo)
    audit = await conn.fetchval(
        "SELECT new_value FROM public.audit_log WHERE entity_type = 'CARRIER' AND entity_id = $1::uuid "
        "AND action = 'activate'", carrier)
    assert '"exception": true' in audit


async def test_la_carpeta_de_una_empresa_en_onboarding_entra_a_pendientes(conexion_revertida):
    from app.services.vencimientos import in_scope_sql
    conn = conexion_revertida
    entra = await _carrier(conn, "ONBOARDING")
    no_entra = await _carrier(conn, "INACTIVE")
    for carrier in (entra, no_entra):
        await _without_documents(conn, carrier)
        await _missing_mandatory(conn, carrier)
    alcance = {str(r["entity_id"]): r["in_scope"] for r in await conn.fetch(
        f"SELECT cr.entity_id, {in_scope_sql('cr')} AS in_scope FROM public.compliance_records cr "
        "WHERE cr.entity_id = ANY($1::uuid[])", [entra, no_entra])}
    assert alcance == {entra: True, no_entra: False}
