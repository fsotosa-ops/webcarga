"""El Cierre de un día contiene exactamente su población, y lo raro va a Pendientes
(plan 2026-10-28, "Empresas en onboarding en el Cierre").

El caso que lo originó: Transportes Crismat (22/10) se activó por excepción, se le asignó
flota, el recálculo creó sus líneas, se dio de baja y las líneas quedaron: contaron,
pidieron motivo y se firmaron. Reglas del usuario:
  · una empresa no activa no forma parte de la operación ni del Cierre;
  · el estado rige desde su día: no reescribe días anteriores;
  · los casos raros aparecen en Pendientes para que Operaciones los revise.
Contra Postgres de verdad, en una transacción revertida."""
from __future__ import annotations

import json
import uuid
from datetime import date

import pytest

from app.services import cierre_lineas, pre_cierre
from tests.conftest import asignacion_previa

pytestmark = pytest.mark.integracion

# Días sin líneas ni períodos en la base: el universo del día es solo lo que crea el test.
ANTES = date.fromisoformat("2001-01-08")   # anterior a cualquier cambio de estado (rige desde hoy)
D = date.fromisoformat("2099-01-05")       # posterior a hoy: ya rige el estado nuevo
TRACTOREO_ID = "89822208-0189-463a-93a0-605fb570c71b"
P = "ZZ-TEST-POBLACION"


async def _empresa_con_flota(conn, estado: str = "ACTIVE") -> dict:
    """Empresa + tracto Tractoreo + conductor, asignados sin límite inferior."""
    carrier = await conn.fetchval(
        "INSERT INTO public.carriers (business_name, operational_status) VALUES ($1, $2) RETURNING id",
        f"{P} Empresa {uuid.uuid4().hex[:6]}", estado)
    plate = f"ZZ{uuid.uuid4().hex[:4].upper()}"
    tractor = await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type, operational_status, webcarga_operation_type_id) "
        "VALUES ($1, 'TRACTOCAMION', 'ACTIVE', $2) RETURNING id", plate, uuid.UUID(TRACTOREO_ID))
    await asignacion_previa(conn, "ASSET", tractor, carrier)
    driver = await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status) VALUES ($1, 'ACTIVE') RETURNING id",
        f"{P} Conductor {uuid.uuid4().hex[:6]}")
    await asignacion_previa(conn, "DRIVER", driver, carrier)
    return {"carrier": carrier, "driver": driver, "tractor": tractor, "plate": plate}


async def _recalcular(conn, dia: date) -> None:
    await conn.execute(
        "INSERT INTO app.closure_periods (business_date, status) VALUES ($1, 'OPEN') ON CONFLICT DO NOTHING", dia)
    await cierre_lineas.recalcular_en(conn, dia)


async def _lineas(conn, dia: date, flota: dict) -> set[str]:
    filas = await conn.fetch(
        "SELECT subject_type FROM app.closure_lines WHERE business_date = $1 AND subject_id = ANY($2::uuid[])",
        dia, [flota["driver"], flota["tractor"]])
    return {f["subject_type"] for f in filas}


async def _a_onboarding(conn, carrier) -> None:
    """Un cambio de estado directo: el trigger lo deja en la historia desde hoy."""
    await conn.execute("UPDATE public.carriers SET operational_status = 'ONBOARDING' WHERE id = $1", carrier)


async def test_la_empresa_que_deja_de_estar_activa_sale_del_dia(conexion_revertida):
    conn = conexion_revertida
    sale = await _empresa_con_flota(conn)
    queda = await _empresa_con_flota(conn)
    await _recalcular(conn, D)
    assert await _lineas(conn, D, sale) == {"DRIVER", "ASSET"}

    await _a_onboarding(conn, sale["carrier"])
    await _recalcular(conn, D)

    assert await _lineas(conn, D, sale) == set()
    assert await _lineas(conn, D, queda) == {"DRIVER", "ASSET"}


async def test_lo_que_sale_queda_en_la_auditoria_con_lo_que_tenia(conexion_revertida):
    """No se pierde en silencio lo que escribió Operaciones (el motivo de Crismat)."""
    conn = conexion_revertida
    sale = await _empresa_con_flota(conn)
    await _recalcular(conn, D)
    motivo = await conn.fetchval(
        "SELECT id FROM app.status_taxonomies WHERE domain = 'DRIVER_REASON' AND active ORDER BY sort_order LIMIT 1")
    await conn.execute(
        "UPDATE app.closure_lines SET reason_id = $3, comentario = 'EETT en proceso' "
        "WHERE business_date = $1 AND subject_id = $2", D, sale["driver"], motivo)

    await _a_onboarding(conn, sale["carrier"])
    await _recalcular(conn, D)

    fila = await conn.fetchrow(
        "SELECT new_value, source FROM public.audit_log WHERE action = 'closure_line_left_population' "
        "AND entity_type = 'DRIVER' AND entity_id = $1", sale["driver"])
    contenido = json.loads(fila["new_value"])
    assert contenido["business_date"] == D.isoformat()
    assert contenido["reason_id"] == str(motivo)
    assert contenido["comentario"] == "EETT en proceso"
    assert fila["source"] == "closure_recompute"


async def test_los_dias_anteriores_al_cambio_no_cambian(conexion_revertida):
    """E (28/10): dar de baja hoy no saca la flota de un día abierto en que sí operó."""
    conn = conexion_revertida
    sale = await _empresa_con_flota(conn)
    await _recalcular(conn, ANTES)

    await _a_onboarding(conn, sale["carrier"])
    await _recalcular(conn, ANTES)

    assert await _lineas(conn, ANTES, sale) == {"DRIVER", "ASSET"}


async def test_una_empresa_en_onboarding_nunca_entra(conexion_revertida):
    conn = conexion_revertida
    nueva = await _empresa_con_flota(conn, "ONBOARDING")
    await _recalcular(conn, D)
    assert await _lineas(conn, D, nueva) == set()


async def test_una_activacion_programada_entra_desde_su_dia(conexion_revertida):
    """F (28/10): activar rige desde una fecha; antes de esa fecha la flota no está."""
    conn = conexion_revertida
    nueva = await _empresa_con_flota(conn, "ONBOARDING")
    await conn.execute("SELECT app.write_status_period('CARRIER', $1::uuid, 'ACTIVE', $2, 'app', "
                       "NULL, NULL, NULL, NULL)", nueva["carrier"], D)
    dia_antes = date.fromisoformat("2099-01-04")

    await _recalcular(conn, dia_antes)
    await _recalcular(conn, D)

    assert await _lineas(conn, dia_antes, nueva) == set()
    assert await _lineas(conn, D, nueva) == {"DRIVER", "ASSET"}


async def test_si_vuelve_a_estar_activa_su_linea_vuelve(conexion_revertida):
    conn = conexion_revertida
    flota = await _empresa_con_flota(conn)
    await _recalcular(conn, D)
    await _a_onboarding(conn, flota["carrier"])
    await _recalcular(conn, D)
    await conn.execute("UPDATE public.carriers SET operational_status = 'ACTIVE' WHERE id = $1", flota["carrier"])
    await _recalcular(conn, D)
    assert await _lineas(conn, D, flota) == {"DRIVER", "ASSET"}


# ── Pendientes ────────────────────────────────────────────────────────────────

async def test_lo_que_salio_aparece_en_pendientes_y_no_bloquea(conexion_revertida):
    conn = conexion_revertida
    sale = await _empresa_con_flota(conn)
    await _recalcular(conn, D)
    await _a_onboarding(conn, sale["carrier"])
    await _recalcular(conn, D)

    avisos = await pre_cierre.avisos_del_dia(conn, D)

    nuestros = {(a["subject_type"], a["subject_id"]): a for a in avisos["escalations"]["LEFT_DAY_POPULATION"]
                if a["carrier_id"] == str(sale["carrier"])}
    assert set(nuestros) == {("DRIVER", str(sale["driver"])), ("ASSET", str(sale["tractor"]))}
    assert nuestros[("DRIVER", str(sale["driver"]))]["carrier_status"] == "ONBOARDING"
    assert "LEFT_DAY_POPULATION" not in cierre_lineas.ESCALACIONES_QUE_BLOQUEAN


async def test_si_vuelve_el_aviso_desaparece(conexion_revertida):
    conn = conexion_revertida
    flota = await _empresa_con_flota(conn)
    await _recalcular(conn, D)
    await _a_onboarding(conn, flota["carrier"])
    await _recalcular(conn, D)
    await conn.execute("UPDATE public.carriers SET operational_status = 'ACTIVE' WHERE id = $1", flota["carrier"])
    await _recalcular(conn, D)

    avisos = await pre_cierre.avisos_del_dia(conn, D)

    assert not [a for a in avisos["escalations"]["LEFT_DAY_POPULATION"] if a["carrier_id"] == str(flota["carrier"])]


async def _viaje(conn, dia: date, plate: str) -> None:
    await conn.execute(
        "INSERT INTO app.trips (id, planning_date, client_name, source_system, source_system_trip_id, "
        "trip_status, is_active, is_assigned, fleet) VALUES ($1, $2, 'Walmart', 'qanalytics', $3, 'RUTA', true, true, "
        "$4::jsonb)", uuid.uuid4(), dia, f"{P}-{uuid.uuid4().hex[:6]}", json.dumps({"tractor_plate": plate}))


async def test_un_viaje_de_una_empresa_que_ese_dia_no_esta_activa_bloquea(conexion_revertida):
    """D (28/10): la flota de una empresa no activa que igual viajó se queda a la vista y bloquea."""
    conn = conexion_revertida
    flota = await _empresa_con_flota(conn)
    await _a_onboarding(conn, flota["carrier"])
    await _viaje(conn, D, flota["plate"])

    avisos = await pre_cierre.avisos_del_dia(conn, D)

    nuestras = [r for r in avisos["escalations"]["EMPRESA_ONBOARDING"] if r["carrier_id"] == str(flota["carrier"])]
    assert [r["operational_status"] for r in nuestras] == ["ONBOARDING"]
    assert "EMPRESA_ONBOARDING" in cierre_lineas.ESCALACIONES_QUE_BLOQUEAN


async def test_un_viaje_de_un_dia_en_que_estaba_activa_no_avisa(conexion_revertida):
    """El estado que cuenta es el de ESE día, no el de hoy."""
    conn = conexion_revertida
    flota = await _empresa_con_flota(conn)
    await _a_onboarding(conn, flota["carrier"])
    await _viaje(conn, ANTES, flota["plate"])

    avisos = await pre_cierre.avisos_del_dia(conn, ANTES)

    assert not [r for r in avisos["escalations"]["EMPRESA_ONBOARDING"] if r["carrier_id"] == str(flota["carrier"])]
