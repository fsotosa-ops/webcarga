"""El cierre del día sobre app.closure_periods / app.closure_lines.

services/cierre_lineas.py es el único que las escribe. Estos tests reemplazan a
los que fijaban strings de `_RECOMPUTE_SQL` y la secuencia de llamadas de un
pool falso: las reglas viven en SQL contra tablas con restricciones, y un mock
no ejecuta ninguna. Cada conducta que protegían sigue acá, contra la base.

Escenario creado por el test en la transacción revertida de
`conexion_revertida`: una empresa con un tracto de Tractoreo, un conductor
cuyo tracto habitual es ése, y un día (2026-06-10) sin datos reales.

Casos de la Solicitud de Cambios Diario 2.0 (16/09): "Se retira sin carga"
queda Trabajando sin asignación, Vacaciones con vigencia llega al día
siguiente, el motivo del conductor llega al tracto, un día firmado no se
recalcula, y cerrar es un solo acto.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta

import pytest
from fastapi import HTTPException

from app.services import cierre_lineas
from tests.conftest import PoolDeUnaConexion, _usuario_real

pytestmark = pytest.mark.integracion

D = date.fromisoformat("2026-06-10")
TRACTOREO_ID = "89822208-0189-463a-93a0-605fb570c71b"


def _patente():
    return f"ZZ{uuid.uuid4().hex[:4].upper()}"


async def _escenario(conn):
    """Empresa ACTIVE + tracto Tractoreo + conductor con asignación activa y
    ese tracto como habitual. Así el conductor entra al roster del cierre."""
    carrier = await conn.fetchval(
        "INSERT INTO public.carriers (business_name, operational_status) "
        "VALUES ('Empresa cierre de prueba', 'ACTIVE') RETURNING id")
    tractor = await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type, operational_status, webcarga_operation_type_id) "
        "VALUES ($1, 'TRACTOCAMION', 'ACTIVE', $2) RETURNING id",
        _patente(), uuid.UUID(TRACTOREO_ID))
    await conn.execute(
        "INSERT INTO public.asset_assignments (asset_id, carrier_id, status) VALUES ($1, $2, 'ACTIVE')",
        tractor, carrier)
    conductor = await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status) VALUES ('Conductor cierre de prueba', 'ACTIVE') "
        "RETURNING id")
    await conn.execute(
        "INSERT INTO public.driver_assignments (driver_id, carrier_id, status) VALUES ($1, $2, 'ACTIVE')",
        conductor, carrier)
    await conn.execute(
        "INSERT INTO public.vehicle_driver_assignments (asset_id, driver_id, status, source, is_manual_override) "
        "VALUES ($1, $2, 'ACTIVE', 'manual', true)",
        tractor, conductor)
    return {"carrier": carrier, "tractor": tractor, "conductor": conductor}


async def _viaje(conn, esc, dia, trip_status="CERRADO FINALIZADO"):
    trip_id = uuid.uuid4()
    await conn.execute(
        """
        INSERT INTO app.trips (id, planning_date, client_name, source_system, source_system_trip_id,
                               trip_status, status_reported_at, is_active, is_assigned)
        VALUES ($1, $2, 'TEST-CIERRE-LINEAS', 'qanalytics', $3, $4, $5, false, true)
        """,
        trip_id, dia, str(trip_id), trip_status, datetime.combine(dia, datetime.min.time()))
    await conn.execute(
        """
        INSERT INTO app.trip_fleet_links (trip_id, driver_id, carrier_id, tractor_asset_id, link_source)
        VALUES ($1, $2, $3, $4, 'manual')
        ON CONFLICT (trip_id) DO UPDATE SET driver_id = EXCLUDED.driver_id, carrier_id = EXCLUDED.carrier_id,
            tractor_asset_id = EXCLUDED.tractor_asset_id, link_source = 'manual'
        """,
        trip_id, esc["conductor"], esc["carrier"], esc["tractor"])
    return trip_id


async def _motivo(conn, label):
    return str(await conn.fetchval(
        "SELECT id FROM app.status_taxonomies WHERE domain = 'DRIVER_REASON' AND label = $1", label))


async def _linea(conn, dia, subject_type, subject_id):
    return await conn.fetchrow(
        f"""
        SELECT l.status, l.reason_id::text AS reason_id, l.valid_until, l.comentario, l.computed_at,
               lin.category
        FROM app.closure_lines l
        JOIN {cierre_lineas.LINEAS_CONDUCTORES if subject_type == 'DRIVER' else cierre_lineas.LINEAS_TRACTOS} lin
          ON lin.business_date = l.business_date
         AND lin.{'driver_id' if subject_type == 'DRIVER' else 'asset_id'} = l.subject_id
        WHERE l.business_date = $1 AND l.subject_type = $2 AND l.subject_id = $3
        """,
        dia, subject_type, subject_id)


async def _poner(conn, dia, subject_type, subject_id, user, **campos):
    await cierre_lineas.poner_motivo(
        PoolDeUnaConexion(conn), dia, subject_type, [str(subject_id)],
        campos=set(campos), reason_id=campos.get("unassigned_reason_id"),
        valid_until=campos.get("valid_until"), comentario=campos.get("comentario"), user=user)


# ── recalcular ───────────────────────────────────────────────────────────────

async def test_un_conductor_con_viaje_queda_asignado_y_sin_viaje_sin_resolver(conexion_revertida):
    conn = conexion_revertida
    esc = await _escenario(conn)
    pool = PoolDeUnaConexion(conn)

    await cierre_lineas.recalcular(pool, D)
    assert (await _linea(conn, D, "DRIVER", esc["conductor"]))["category"] == "SIN_RESOLVER"

    await _viaje(conn, esc, D)
    await cierre_lineas.recalcular(pool, D)
    assert (await _linea(conn, D, "DRIVER", esc["conductor"]))["category"] == "ASIGNADO"
    assert (await _linea(conn, D, "ASSET", esc["tractor"]))["category"] == "ASIGNADO"


async def test_un_cancelado_no_asigna_al_conductor(conexion_revertida):
    """Solicitud 16/09: "reasignaron la ruta, queda Cancelado, el conductor
    aparece como asignado"."""
    conn = conexion_revertida
    esc = await _escenario(conn)
    await _viaje(conn, esc, D, trip_status="CANCELADO")

    await cierre_lineas.recalcular(PoolDeUnaConexion(conn), D)

    assert (await _linea(conn, D, "DRIVER", esc["conductor"]))["status"] == "UNASSIGNED"


async def test_al_tener_carga_se_limpia_el_motivo_pero_no_el_comentario(conexion_revertida):
    """El comentario es una nota del día que escribió una persona (14/09); el
    motivo sólo tiene sentido en una fila sin carga."""
    conn = conexion_revertida
    esc = await _escenario(conn)
    pool = PoolDeUnaConexion(conn)
    user = await _usuario_real(conn)
    await cierre_lineas.recalcular(pool, D)
    await _poner(conn, D, "DRIVER", esc["conductor"], user,
                 unassigned_reason_id=await _motivo(conn, "Panne"), comentario="llegó tarde el repuesto")

    await _viaje(conn, esc, D)
    await cierre_lineas.recalcular(pool, D)

    linea = await _linea(conn, D, "DRIVER", esc["conductor"])
    assert linea["reason_id"] is None
    assert linea["comentario"] == "llegó tarde el repuesto"


# ── qué significa el motivo ──────────────────────────────────────────────────

async def test_se_retira_sin_carga_es_trabajando_sin_asignacion(conexion_revertida):
    """Solicitud 16/09: "los retirados sin carga tienen que quedar trabajando
    sin asignación; actualmente quedan No trabajando"."""
    conn = conexion_revertida
    esc = await _escenario(conn)
    user = await _usuario_real(conn)
    await cierre_lineas.recalcular(PoolDeUnaConexion(conn), D)

    await _poner(conn, D, "DRIVER", esc["conductor"], user,
                 unassigned_reason_id=await _motivo(conn, "Se retira sin carga"))
    assert (await _linea(conn, D, "DRIVER", esc["conductor"]))["category"] == "TRABAJANDO_SIN_ASIGNACION"

    await _poner(conn, D, "DRIVER", esc["conductor"], user,
                 unassigned_reason_id=await _motivo(conn, "Vacaciones"))
    assert (await _linea(conn, D, "DRIVER", esc["conductor"]))["category"] == "NO_TRABAJANDO"


async def test_sin_especificar_quita_el_motivo(conexion_revertida):
    conn = conexion_revertida
    esc = await _escenario(conn)
    user = await _usuario_real(conn)
    await cierre_lineas.recalcular(PoolDeUnaConexion(conn), D)
    await _poner(conn, D, "DRIVER", esc["conductor"], user, unassigned_reason_id=await _motivo(conn, "Panne"))

    await _poner(conn, D, "DRIVER", esc["conductor"], user, unassigned_reason_id=None)

    assert (await _linea(conn, D, "DRIVER", esc["conductor"]))["category"] == "SIN_RESOLVER"


async def test_poner_solo_comentario_no_borra_el_motivo_ni_al_reves(conexion_revertida):
    conn = conexion_revertida
    esc = await _escenario(conn)
    user = await _usuario_real(conn)
    panne = await _motivo(conn, "Panne")
    await cierre_lineas.recalcular(PoolDeUnaConexion(conn), D)

    await _poner(conn, D, "DRIVER", esc["conductor"], user, unassigned_reason_id=panne, comentario="nota")
    await _poner(conn, D, "DRIVER", esc["conductor"], user, comentario="otra nota")
    await _poner(conn, D, "DRIVER", esc["conductor"], user, unassigned_reason_id=panne)

    linea = await _linea(conn, D, "DRIVER", esc["conductor"])
    assert (linea["reason_id"], linea["comentario"]) == (panne, "otra nota")


async def test_motivo_en_una_fila_con_carga_es_422_y_comentario_no(conexion_revertida):
    conn = conexion_revertida
    esc = await _escenario(conn)
    user = await _usuario_real(conn)
    await _viaje(conn, esc, D)
    await cierre_lineas.recalcular(PoolDeUnaConexion(conn), D)

    with pytest.raises(HTTPException) as exc:
        await _poner(conn, D, "DRIVER", esc["conductor"], user, unassigned_reason_id=await _motivo(conn, "Panne"))
    assert exc.value.status_code == 422

    await _poner(conn, D, "DRIVER", esc["conductor"], user, comentario="hizo dos vueltas")
    assert (await _linea(conn, D, "DRIVER", esc["conductor"]))["comentario"] == "hizo dos vueltas"


# ── vigencia ─────────────────────────────────────────────────────────────────

async def test_vacaciones_con_vigencia_llega_al_dia_siguiente(conexion_revertida):
    """Solicitud 16/09: "al siguiente día no se mantienen los No Trabajando,
    se deben colocar de nuevo"."""
    conn = conexion_revertida
    esc = await _escenario(conn)
    pool = PoolDeUnaConexion(conn)
    user = await _usuario_real(conn)
    vacaciones = await _motivo(conn, "Vacaciones")
    await cierre_lineas.recalcular(pool, D)
    await _poner(conn, D, "DRIVER", esc["conductor"], user,
                 unassigned_reason_id=vacaciones, valid_until=D + timedelta(days=2))

    await cierre_lineas.recalcular(pool, D + timedelta(days=1))
    await cierre_lineas.recalcular(pool, D + timedelta(days=3))

    assert (await _linea(conn, D + timedelta(days=1), "DRIVER", esc["conductor"]))["reason_id"] == vacaciones
    assert (await _linea(conn, D + timedelta(days=3), "DRIVER", esc["conductor"]))["reason_id"] is None


async def test_un_viaje_le_gana_a_la_vigencia_ese_dia_sin_borrarla(conexion_revertida):
    conn = conexion_revertida
    esc = await _escenario(conn)
    pool = PoolDeUnaConexion(conn)
    user = await _usuario_real(conn)
    vacaciones = await _motivo(conn, "Vacaciones")
    await cierre_lineas.recalcular(pool, D)
    await _poner(conn, D, "DRIVER", esc["conductor"], user,
                 unassigned_reason_id=vacaciones, valid_until=D + timedelta(days=2))

    await _viaje(conn, esc, D + timedelta(days=1))
    await cierre_lineas.recalcular(pool, D + timedelta(days=1))
    await cierre_lineas.recalcular(pool, D + timedelta(days=2))

    assert (await _linea(conn, D + timedelta(days=1), "DRIVER", esc["conductor"]))["category"] == "ASIGNADO"
    assert (await _linea(conn, D + timedelta(days=2), "DRIVER", esc["conductor"]))["reason_id"] == vacaciones


async def test_trabajar_sin_asignacion_no_tiene_vigencia(conexion_revertida):
    conn = conexion_revertida
    esc = await _escenario(conn)
    user = await _usuario_real(conn)
    await cierre_lineas.recalcular(PoolDeUnaConexion(conn), D)

    with pytest.raises(HTTPException) as exc:
        await _poner(conn, D, "DRIVER", esc["conductor"], user,
                     unassigned_reason_id=await _motivo(conn, "Esperando carga"),
                     valid_until=D + timedelta(days=1))
    assert exc.value.status_code == 422


# ── los ejes se hablan ───────────────────────────────────────────────────────

async def test_el_motivo_del_conductor_llega_a_su_tracto_habitual(conexion_revertida):
    """Solicitud 16/09: marcaban el motivo en Conductores y tenían que volver a
    ponerlo en Tractos."""
    conn = conexion_revertida
    esc = await _escenario(conn)
    user = await _usuario_real(conn)
    await cierre_lineas.recalcular(PoolDeUnaConexion(conn), D)

    await _poner(conn, D, "DRIVER", esc["conductor"], user, unassigned_reason_id=await _motivo(conn, "Licencia"))

    tracto = await _linea(conn, D, "ASSET", esc["tractor"])
    assert tracto["reason_id"] == await _motivo(conn, "Sin conductor")


async def test_la_propagacion_no_pisa_lo_que_escribio_una_persona_en_el_tracto(conexion_revertida):
    conn = conexion_revertida
    esc = await _escenario(conn)
    user = await _usuario_real(conn)
    panne = await _motivo(conn, "Panne")
    await cierre_lineas.recalcular(PoolDeUnaConexion(conn), D)
    await _poner(conn, D, "ASSET", esc["tractor"], user, unassigned_reason_id=panne)

    await _poner(conn, D, "DRIVER", esc["conductor"], user, unassigned_reason_id=await _motivo(conn, "Licencia"))

    assert (await _linea(conn, D, "ASSET", esc["tractor"]))["reason_id"] == panne


async def test_trabajar_sin_asignacion_no_se_propaga_al_tracto(conexion_revertida):
    conn = conexion_revertida
    esc = await _escenario(conn)
    user = await _usuario_real(conn)
    await cierre_lineas.recalcular(PoolDeUnaConexion(conn), D)

    await _poner(conn, D, "DRIVER", esc["conductor"], user, unassigned_reason_id=await _motivo(conn, "Esperando carga"))

    assert (await _linea(conn, D, "ASSET", esc["tractor"]))["reason_id"] is None


# ── cerrar / reabrir ─────────────────────────────────────────────────────────

async def test_no_se_cierra_con_pendientes_y_la_respuesta_los_nombra(conexion_revertida):
    conn = conexion_revertida
    esc = await _escenario(conn)
    user = await _usuario_real(conn)

    with pytest.raises(HTTPException) as exc:
        await cierre_lineas.cerrar(PoolDeUnaConexion(conn), D, override=False, override_note=None, user=user)

    assert exc.value.status_code == 409
    assert str(esc["conductor"]) in {p["driver_id"] for p in exc.value.detail["pending"]}
    assert str(esc["tractor"]) in {p["asset_id"] for p in exc.value.detail["pending_equipment"]}


async def test_forzar_el_cierre_exige_admin_y_nota(conexion_revertida):
    conn = conexion_revertida
    await _escenario(conn)
    pool = PoolDeUnaConexion(conn)
    writer = {**(await _usuario_real(conn)), "role": "writer"}
    admin = {**writer, "role": "admin"}

    with pytest.raises(HTTPException) as exc:
        await cierre_lineas.cerrar(pool, D, override=True, override_note="se fuerza", user=writer)
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as exc:
        await cierre_lineas.cerrar(pool, D, override=True, override_note="  ", user=admin)
    assert exc.value.status_code == 422

    resultado = await cierre_lineas.cerrar(pool, D, override=True, override_note="se fuerza", user=admin)
    assert resultado["overridden"] > 0


async def test_un_dia_cerrado_no_se_recalcula_ni_se_edita(conexion_revertida):
    """La prueba que cierra el diseño: firmar, volver a abrir la pantalla, y que
    computed_at no cambie. Hasta el 16/09, 6 de 7 días firmados se habían
    recalculado después."""
    conn = conexion_revertida
    esc = await _escenario(conn)
    pool = PoolDeUnaConexion(conn)
    admin = {**(await _usuario_real(conn)), "role": "admin"}
    await cierre_lineas.cerrar(pool, D, override=True, override_note="prueba", user=admin)
    antes = (await _linea(conn, D, "DRIVER", esc["conductor"]))["computed_at"]

    await _viaje(conn, esc, D)
    assert await cierre_lineas.recalcular(pool, D) is None

    linea = await _linea(conn, D, "DRIVER", esc["conductor"])
    assert (linea["computed_at"], linea["status"]) == (antes, "UNASSIGNED")
    with pytest.raises(HTTPException) as exc:
        await _poner(conn, D, "DRIVER", esc["conductor"], admin, comentario="tarde")
    assert exc.value.status_code == 409


async def test_cerrar_firma_los_dos_ejes_en_el_periodo_y_en_las_cabeceras_viejas(conexion_revertida):
    conn = conexion_revertida
    await _escenario(conn)
    admin = {**(await _usuario_real(conn)), "role": "admin"}

    await cierre_lineas.cerrar(PoolDeUnaConexion(conn), D, override=True, override_note="prueba", user=admin)

    assert await conn.fetchval("SELECT status FROM app.closure_periods WHERE business_date = $1", D) == "CLOSED"
    assert await conn.fetchval("SELECT count(*) FROM app.daily_closures WHERE business_date = $1", D) == 1
    assert await conn.fetchval("SELECT count(*) FROM app.equipment_closures WHERE business_date = $1", D) == 1


async def test_reabrir_exige_admin_y_nota_y_vuelve_a_recalcular(conexion_revertida):
    conn = conexion_revertida
    esc = await _escenario(conn)
    pool = PoolDeUnaConexion(conn)
    admin = {**(await _usuario_real(conn)), "role": "admin"}
    await cierre_lineas.cerrar(pool, D, override=True, override_note="prueba", user=admin)

    with pytest.raises(HTTPException) as exc:
        await cierre_lineas.reabrir(pool, D, nota="corregir", user={**admin, "role": "writer"})
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as exc:
        await cierre_lineas.reabrir(pool, D, nota="", user=admin)
    assert exc.value.status_code == 422

    await cierre_lineas.reabrir(pool, D, nota="faltaba el viaje de la tarde", user=admin)
    await _viaje(conn, esc, D)
    await cierre_lineas.recalcular(pool, D)

    assert (await _linea(conn, D, "DRIVER", esc["conductor"]))["category"] == "ASIGNADO"
    assert await conn.fetchval("SELECT count(*) FROM app.daily_closures WHERE business_date = $1", D) == 0


async def test_las_tablas_viejas_quedan_como_proyeccion_de_las_lineas(conexion_revertida):
    conn = conexion_revertida
    esc = await _escenario(conn)
    user = await _usuario_real(conn)
    await cierre_lineas.recalcular(PoolDeUnaConexion(conn), D)
    panne = await _motivo(conn, "Panne")

    await _poner(conn, D, "DRIVER", esc["conductor"], user, unassigned_reason_id=panne, comentario="nota")

    vieja = await conn.fetchrow(
        "SELECT unassigned_reason_id::text AS r, comentario FROM app.driver_day_status "
        "WHERE driver_id = $1 AND business_date = $2", esc["conductor"], D)
    assert (vieja["r"], vieja["comentario"]) == (panne, "nota")


def test_las_escalaciones_de_propuesta_no_bloquean_el_cierre():
    """CONDUCTOR_SIN_EMPRESA propone y no escribe: bloquear el día con una
    propuesta cambiaría la operación sin que nadie lo haya pedido."""
    assert "CONDUCTOR_SIN_EMPRESA" not in cierre_lineas.ESCALACIONES_QUE_BLOQUEAN
    assert "SIN_TIPO_OPERACION" not in cierre_lineas.ESCALACIONES_QUE_BLOQUEAN


def test_sodimac_no_entra_al_estado_de_ningun_eje():
    """Esa fuente no resuelve conductor ni tracto por la misma cadena."""
    assert "t.source_system != 'sodimac'" in cierre_lineas.SQL_ESTADO_CONDUCTORES
    assert "t.source_system != 'sodimac'" in cierre_lineas.SQL_ESTADO_TRACTOS
