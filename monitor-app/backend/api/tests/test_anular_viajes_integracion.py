"""Anular viajes manuales con motivo (spec 2026-10-10 anulación y firma versionada, §2).

Reemplaza a test_eliminar_viajes_integracion.py: el viaje no se borra, queda con
quién, cuándo y por qué. Quién anula depende del día del viaje (planning_date):
abierto, el creador o trips.void_any; firmado, closures.sign. Todo corre en la
transacción revertida de `conexion_revertida`; cada test crea su viaje con el
endpoint real en un día que Operaciones nunca firma."""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

import pytest
from fastapi import HTTPException

from app.routers.trips import (
    TripCreateBody, TripStopCreate, assign_fleet_link, conteo_de_viajes_activos, create_trip, get_trip, list_trips,
    patch_trip,
)
from app.schemas.trip import TripPatch, TripVoidBody
from pydantic import ValidationError
from app.services.anular_viajes import anular_viajes, revertir_anulacion
from tests.conftest import PoolDeUnaConexion, _usuario_real, con_roles, usuario as usuario_de, ADMIN_EQUIVALENTE

pytestmark = pytest.mark.integracion

DIA = date(2099, 1, 1)


async def _viaje_manual(conn, usuario) -> str:
    viaje = await create_trip(
        TripCreateBody(
            planning_date=DIA.isoformat(), client_name=f"TEST-{uuid.uuid4().hex[:8]}",
            driver_name="CONDUCTOR DE PRUEBA",
            stops=[TripStopCreate(local="SAN BERNARDO", stop_type="ORIGIN"), TripStopCreate(local="IANSA")],
        ),
        pool=PoolDeUnaConexion(conn), user=usuario,
    )
    return str(viaje["id"])


def _otro(*roles: str) -> dict:
    return con_roles({"sub": str(uuid.uuid4()), "email": "otro@webcarga.cl"}, *roles)


def _sin_firmar(usuario: dict) -> dict:
    """El creador como Supervisor de Operaciones, pero sin closures.sign."""
    sup = con_roles(usuario, "operations_supervisor")
    return {**sup, "permissions": sup["permissions"] - {"closures.sign"}}


async def _firmar_dia(conn, usuario) -> None:
    # closure_periods_cerrado_tiene_firma: un período CLOSED lleva quién y cuándo.
    await conn.execute(
        "INSERT INTO app.closure_periods (business_date, status, closed_by, closed_at) "
        "VALUES ($1, 'CLOSED', $2::uuid, now()) "
        "ON CONFLICT (business_date) DO UPDATE SET status = 'CLOSED', closed_by = $2::uuid, closed_at = now()",
        DIA, usuario["sub"])


async def _motivo(conn, code: str = "DUPLICADO") -> str:
    return str(await conn.fetchval(
        "SELECT id FROM app.status_taxonomies WHERE domain = 'TRIP_VOID_REASON' AND code = $1", code))


async def _anulado(conn, tid: str):
    return await conn.fetchrow(
        "SELECT t.voided_at, t.voided_by::text, t.void_reason_id::text, t.void_note, m.voided_at AS m_voided_at, "
        "m.void_reason_id::text AS m_reason "
        "FROM app.trips t JOIN app.trips_manual m ON m.id = t.id WHERE t.id = $1::uuid", tid)


async def _listados(conn, usuario) -> set[str]:
    ids: set[str] = set()
    for view in ("en_curso", "historial"):
        respuesta = await list_trips(
            view=view, fecha_desde=DIA.isoformat(), fecha_hasta=DIA.isoformat(), limit=500,
            pool=PoolDeUnaConexion(conn), user=usuario)
        ids |= {str(d["id"]) for d in respuesta["data"]}
    return ids


async def test_quien_lo_creo_lo_anula_con_motivo_y_queda_auditado(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    assert (await get_trip(tid, pool=PoolDeUnaConexion(conn), user=usuario))["can_void"] is True

    motivo = await _motivo(conn)
    assert await anular_viajes(conn, [tid], motivo, None, usuario) == 1

    fila = await _anulado(conn, tid)
    assert fila["voided_at"] is not None and fila["m_voided_at"] is not None
    assert (fila["voided_by"], fila["void_reason_id"], fila["m_reason"]) == (usuario["sub"], motivo, motivo)
    assert await conn.fetchval(
        "SELECT count(*) FROM public.audit_log WHERE entity_type='TRIP' AND entity_id=$1::uuid AND action='void'",
        tid) == 1
    detalle = await get_trip(tid, pool=PoolDeUnaConexion(conn), user=usuario)
    assert (detalle["void_reason_label"], detalle["can_void"], detalle["can_revert_void"]) == ("Duplicado", False, True)
    assert detalle["voided_by_name"] is not None


async def test_el_monitor_no_lista_los_anulados(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    assert tid in await _listados(conn, usuario)

    await anular_viajes(conn, [tid], await _motivo(conn), None, usuario)

    assert tid not in await _listados(conn, usuario)


async def test_sin_motivo_de_catalogo_no_se_anula(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    with pytest.raises(HTTPException) as err:
        await anular_viajes(conn, [tid], "", None, usuario)
    assert err.value.status_code == 422
    assert (await _anulado(conn, tid))["voided_at"] is None


async def test_otro_operador_no_puede_y_void_any_si(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    with pytest.raises(HTTPException) as err:
        await anular_viajes(conn, [tid], await _motivo(conn), None, _otro("operations_operator"))
    assert err.value.status_code == 403

    otro_perfil = str(await conn.fetchval("SELECT id FROM public.profiles WHERE id <> $1::uuid LIMIT 1", usuario["sub"]))
    admin = con_roles({"sub": otro_perfil, "email": "admin@webcarga.cl"}, *ADMIN_EQUIVALENTE)
    assert await anular_viajes(conn, [tid], await _motivo(conn), None, admin) == 1


async def test_un_viaje_del_tms_no_se_anula(conexion_revertida):
    conn = conexion_revertida
    tms = str(await conn.fetchval("SELECT id FROM app.trips WHERE source_system <> 'manual' LIMIT 1"))
    with pytest.raises(HTTPException) as err:
        await anular_viajes(conn, [tms], await _motivo(conn), None, _otro("owner"))
    assert err.value.status_code == 409


async def test_en_dia_firmado_lo_anula_solo_quien_firma(conexion_revertida):
    """Sin reabrir: el día sigue firmado y la anulación es un ajuste posterior."""
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    await _firmar_dia(conn, usuario)

    with pytest.raises(HTTPException) as err:
        await anular_viajes(conn, [tid], await _motivo(conn), None, _sin_firmar(usuario))
    assert err.value.status_code == 403
    assert "firmado" in str(err.value.detail)

    assert await anular_viajes(conn, [tid], await _motivo(conn), None, con_roles(usuario, "operations_operator")) == 1
    assert await conn.fetchval("SELECT status FROM app.closure_periods WHERE business_date = $1", DIA) == "CLOSED"


async def test_revertir_en_dia_firmado_exige_firmar_y_vuelve_a_la_firma(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    await anular_viajes(conn, [tid], await _motivo(conn), None, usuario)
    await _firmar_dia(conn, usuario)

    with pytest.raises(HTTPException) as err:
        await revertir_anulacion(conn, [tid], _sin_firmar(usuario))
    assert err.value.status_code == 403

    assert await revertir_anulacion(conn, [tid], con_roles(usuario, "operations_operator")) == 1
    assert (await _anulado(conn, tid))["voided_at"] is None
    assert await conn.fetchval(
        "SELECT count(*) FROM public.audit_log WHERE entity_type='TRIP' AND entity_id=$1::uuid AND action='void_revert'",
        tid) == 1


async def test_lote_mezclado_no_anula_ninguno(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    propio = await _viaje_manual(conn, usuario)
    inexistente = str(uuid.uuid4())
    with pytest.raises(HTTPException) as err:
        await anular_viajes(conn, [propio, inexistente], await _motivo(conn), None, usuario)
    assert err.value.status_code == 404
    assert [e["trip_id"] for e in err.value.detail["errors"]] == [inexistente]
    assert (await _anulado(conn, propio))["voided_at"] is None


async def test_anular_dos_veces_es_conflicto(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    await anular_viajes(conn, [tid], await _motivo(conn), None, usuario)
    with pytest.raises(HTTPException) as err:
        await anular_viajes(conn, [tid], await _motivo(conn, "CARGADO_POR_ERROR"), None, usuario)
    assert err.value.status_code == 409


async def test_un_viaje_que_ocupo_un_dia_firmado_posterior_lo_anula_solo_quien_firma(conexion_revertida):
    """Revisión final: un viaje manual planificado para un día abierto que, por sus
    marcas, también ocupó el día siguiente (app.trips_del_dia), ya firmado. Anularlo
    cambia lo que se lee de ese día firmado: exige closures.sign, como exigía el
    borrado (miraba cada día firmado donde el viaje contaba)."""
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    siguiente = date(2099, 1, 2)
    await conn.execute(
        "UPDATE app.trip_stops SET departure_date = $2 WHERE trip_id = $1::uuid",
        tid, datetime(2099, 1, 2, 12, 0, tzinfo=timezone.utc))
    assert await conn.fetchval("SELECT $2::uuid IN (SELECT trip_id FROM app.trips_del_dia($1))", siguiente, tid)
    await conn.execute(
        "INSERT INTO app.closure_periods (business_date, status, closed_by, closed_at) "
        "VALUES ($1, 'CLOSED', $2::uuid, now()) "
        "ON CONFLICT (business_date) DO UPDATE SET status = 'CLOSED', closed_by = $2::uuid, closed_at = now()",
        siguiente, usuario["sub"])

    detalle = await get_trip(tid, pool=PoolDeUnaConexion(conn), user=_sin_firmar(usuario))
    assert detalle["can_void"] is False
    assert "02/01" in detalle["void_blocked_reason"]
    with pytest.raises(HTTPException) as err:
        await anular_viajes(conn, [tid], await _motivo(conn), None, _sin_firmar(usuario))
    assert err.value.status_code == 403

    assert await anular_viajes(conn, [tid], await _motivo(conn), None, con_roles(usuario, "operations_operator")) == 1


async def test_motivo_de_otro_dominio_es_422(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    no_asignacion = str(await conn.fetchval(
        "SELECT id FROM app.status_taxonomies WHERE domain = 'TRIP_UNASSIGNED_REASON' AND active LIMIT 1"))
    with pytest.raises(HTTPException) as err:
        await anular_viajes(conn, [tid], no_asignacion, None, usuario)
    assert err.value.status_code == 422
    assert (await _anulado(conn, tid))["voided_at"] is None


async def test_otro_exige_nota_y_con_nota_anula(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    otro = await _motivo(conn, "OTRO")
    with pytest.raises(HTTPException) as err:
        await anular_viajes(conn, [tid], otro, "  ", usuario)
    assert err.value.status_code == 422

    assert await anular_viajes(conn, [tid], otro, "El cliente lo canceló por correo", usuario) == 1
    detalle = await get_trip(tid, pool=PoolDeUnaConexion(conn), user=usuario)
    assert (detalle["void_reason_label"], detalle["void_note"]) == ("Otro", "El cliente lo canceló por correo")


async def test_otro_renombrado_sigue_exigiendo_nota(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    otro = await _motivo(conn, "OTRO")
    await conn.execute("UPDATE app.status_taxonomies SET label = 'Otra razón' WHERE id = $1::uuid", otro)
    with pytest.raises(HTTPException) as err:
        await anular_viajes(conn, [tid], otro, None, usuario)
    assert err.value.status_code == 422


async def test_motivo_desactivado_se_sigue_leyendo_y_no_se_ofrece(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    motivo = await _motivo(conn, "CARGADO_POR_ERROR")
    await anular_viajes(conn, [tid], motivo, None, usuario)
    await conn.execute("UPDATE app.status_taxonomies SET active = false WHERE id = $1::uuid", motivo)

    detalle = await get_trip(tid, pool=PoolDeUnaConexion(conn), user=usuario)
    assert detalle["void_reason_label"] == "Cargado por error"
    otro_viaje = await _viaje_manual(conn, usuario)
    with pytest.raises(HTTPException) as err:
        await anular_viajes(conn, [otro_viaje], motivo, None, usuario)
    assert err.value.status_code == 422


async def test_revertir_limpia_motivo_y_nota(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    await anular_viajes(conn, [tid], await _motivo(conn, "OTRO"), "nota", usuario)
    await revertir_anulacion(conn, [tid], usuario)
    fila = await _anulado(conn, tid)
    assert (fila["voided_at"], fila["void_reason_id"], fila["void_note"]) == (None, None, None)


# ── Pendientes de las revisiones finales (10/10) ──────────────────────────────

async def test_anular_bloquea_los_periodos_que_mira(conexion_revertida):
    """Carrera anular↔firmar: `FOR UPDATE OF t` no bloquea closure_periods, así que
    un `cerrar` concurrente podía firmar el día entre la lectura de la regla y la
    escritura. La anulación toma FOR SHARE sobre los períodos que mira; `cerrar`
    los toma FOR UPDATE (bloquear_periodo), así que se esperan."""
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    await anular_viajes(conn, [tid], await _motivo(conn), None, usuario)
    assert await conn.fetchval(
        "SELECT count(*) FROM pg_locks l JOIN pg_class c ON c.oid = l.relation "
        "WHERE l.pid = pg_backend_pid() AND c.relname = 'closure_periods' AND l.mode = 'RowShareLock'") == 1


async def test_sin_trips_void_no_se_ofrece_anular(conexion_revertida):
    """can_void coincide con la ruta, que exige trips.void: un rol con
    closures.sign pero sin trips.void no ve un botón que lo lleve a un 403."""
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    solo_firma = {**usuario, "permissions": frozenset({"operations.read", "closures.sign"})}
    detalle = await get_trip(tid, pool=PoolDeUnaConexion(conn), user=solo_firma)
    assert detalle["can_void"] is False


async def test_administracion_pura_puede_anular(conexion_revertida):
    """El rol admin trae trips.void_any; trips.void va con él (la ruta lo exige)."""
    conn = conexion_revertida
    creador = await _usuario_real(conn)
    tid = await _viaje_manual(conn, creador)
    otro_perfil = str(await conn.fetchval("SELECT id FROM public.profiles WHERE id <> $1::uuid LIMIT 1", creador["sub"]))
    admin = usuario_de("admin", sub=otro_perfil)
    assert "trips.void" in admin["permissions"]
    assert (await get_trip(tid, pool=PoolDeUnaConexion(conn), user=admin))["can_void"] is True


async def test_un_viaje_anulado_no_se_edita(conexion_revertida):
    """Un anulado es de solo lectura: se deshace la anulación para editarlo."""
    conn = conexion_revertida
    usuario = con_roles(await _usuario_real(conn), *ADMIN_EQUIVALENTE)
    tid = await _viaje_manual(conn, usuario)
    await anular_viajes(conn, [tid], await _motivo(conn), None, usuario)
    with pytest.raises(HTTPException) as err:
        await patch_trip(tid, TripPatch(notes="x"), pool=PoolDeUnaConexion(conn), user=usuario)
    assert err.value.status_code == 409
    with pytest.raises(HTTPException) as err:
        await assign_fleet_link(tid, {"driver_name_raw": "X"}, pool=PoolDeUnaConexion(conn), user=usuario)
    assert err.value.status_code == 409


async def test_conteo_de_activos_no_cuenta_anulados(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    conductor = await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status) VALUES ('ZZ-TEST Conteo', 'ACTIVE') RETURNING id")
    tid = await _viaje_manual(conn, usuario)
    await conn.execute("UPDATE app.trips SET is_active = true WHERE id = $1::uuid", tid)
    await conn.execute(
        "INSERT INTO app.trip_fleet_links (trip_id, driver_id, link_source) VALUES ($1::uuid, $2, 'manual') "
        "ON CONFLICT (trip_id) DO UPDATE SET driver_id = EXCLUDED.driver_id", tid, conductor)
    conteo = lambda: conteo_de_viajes_activos(entity_type="DRIVER", entity_id=str(conductor), pool=PoolDeUnaConexion(conn))
    assert (await conteo())["activos"] == 1

    await anular_viajes(conn, [tid], await _motivo(conn), None, usuario)

    assert (await conteo())["activos"] == 0


async def test_lote_con_un_viaje_de_dia_firmado_no_anula_ninguno(conexion_revertida):
    """Foco 2 de la revisión: propio en día abierto + uno de día firmado, sin closures.sign."""
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    firmado = await _viaje_manual(conn, usuario)
    await _firmar_dia(conn, usuario)
    abierto = str((await create_trip(
        TripCreateBody(planning_date="2099-01-07", client_name=f"TEST-{uuid.uuid4().hex[:8]}",
                       driver_name="CONDUCTOR DE PRUEBA",
                       stops=[TripStopCreate(local="SAN BERNARDO", stop_type="ORIGIN"), TripStopCreate(local="IANSA")]),
        pool=PoolDeUnaConexion(conn), user=usuario))["id"])
    with pytest.raises(HTTPException) as err:
        await anular_viajes(conn, [abierto, firmado], await _motivo(conn), None, _sin_firmar(usuario))
    assert err.value.status_code == 403
    assert [e["trip_id"] for e in err.value.detail["errors"]] == [firmado]
    assert (await _anulado(conn, abierto))["voided_at"] is None


async def test_un_anulado_que_el_tms_reporto_despues_se_puede_revertir(conexion_revertida):
    """Si el TMS reporta el viaje (mismo id md5), deja de ser manual; la anulación
    quedó (merge_exclude_columns) y no se podía deshacer."""
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    await anular_viajes(conn, [tid], await _motivo(conn), None, usuario)
    await conn.execute("UPDATE app.trips SET source_system = 'qanalytics' WHERE id = $1::uuid", tid)

    assert (await get_trip(tid, pool=PoolDeUnaConexion(conn), user=usuario))["can_revert_void"] is True
    assert await revertir_anulacion(conn, [tid], usuario) == 1


def test_el_comentario_tiene_largo_maximo():
    with pytest.raises(ValidationError):
        TripVoidBody(trip_ids=[uuid.uuid4()], reason_id=uuid.uuid4(), note="x" * 501)

