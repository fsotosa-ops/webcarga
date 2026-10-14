"""El pre-cierre contra Postgres de verdad: desde D2 (14/10) el recálculo no
escribe el directorio, y los avisos no escriben nada."""
from __future__ import annotations

import json
import uuid
from datetime import date

import pytest

from app.services import cierre_lineas, pre_cierre
from tests.conftest import asignacion_previa

pytestmark = pytest.mark.integracion
D = date.fromisoformat("2026-06-11")
P = "ZZ-TEST-PRECIERRE"


async def _dia_abierto(conn):
    """recalcular_en escribe líneas del día: el período tiene que existir."""
    await conn.execute(
        "INSERT INTO app.closure_periods (business_date, status) VALUES ($1, 'OPEN') ON CONFLICT DO NOTHING", D)


async def _empresa(conn, nombre):
    return await conn.fetchval(
        "INSERT INTO public.carriers (business_name, operational_status) VALUES ($1, 'ACTIVE') RETURNING id", nombre)


async def _viaje(conn, *, plate=None, transporter=None, rut=None, driver_name=None, client="Walmart"):
    fleet = {k: v for k, v in {"tractor_plate": plate, "transporter_name_tms": transporter,
                               "driver_rut_tms": rut, "driver_name_tms": driver_name}.items() if v}
    await conn.execute(
        "INSERT INTO app.trips (id, planning_date, client_name, source_system, source_system_trip_id, "
        "trip_status, is_active, is_assigned, fleet) VALUES ($1, $2, $3, 'qanalytics', $4, 'RUTA', true, true, $5::jsonb)",
        uuid.uuid4(), D, client, f"{P}-{uuid.uuid4().hex[:6]}", json.dumps(fleet))


async def test_a6_el_recalculo_no_cambia_la_empresa_del_tracto_ni_agrega_clientes(conexion_revertida):
    """P11 y P10 (14/10): la empresa del TMS se ignora y los clientes se declaran."""
    vieja = await _empresa(conexion_revertida, f"{P} Vieja")
    await _empresa(conexion_revertida, f"{P} Nueva")
    plate = f"ZZ{uuid.uuid4().hex[:4].upper()}"
    asset = await conexion_revertida.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type, operational_status) VALUES ($1, 'TRACTOCAMION', 'ACTIVE') RETURNING id", plate)
    await asignacion_previa(conexion_revertida, 'ASSET', asset, vieja)
    cliente = await conexion_revertida.fetchval(
        "INSERT INTO public.shippers (name, status) VALUES ($1, 'ACTIVE') RETURNING id", f"{P} Cliente {uuid.uuid4().hex[:6]}")
    nombre_cliente = await conexion_revertida.fetchval("SELECT name FROM public.shippers WHERE id = $1", cliente)
    await _viaje(conexion_revertida, plate=plate, transporter=f"{P} Nueva", client=nombre_cliente)

    await _dia_abierto(conexion_revertida)
    await cierre_lineas.recalcular_en(conexion_revertida, D)

    assert await conexion_revertida.fetchval(
        "SELECT carrier_id FROM public.asset_assignments WHERE asset_id = $1 AND status = 'ACTIVE'", asset) == vieja
    assert not await conexion_revertida.fetchval(
        "SELECT 1 FROM public.carrier_shippers WHERE carrier_id = $1", vieja)
    assert not await conexion_revertida.fetchval(
        "SELECT 1 FROM public.audit_log WHERE entity_id = ANY($1::uuid[]) AND source = 'pre_cierre_auto'", [asset, vieja])


def _rut_con_puntos(numero: int) -> str:
    """Un RUT válido (dígito verificador módulo 11), con puntos como lo manda el TMS."""
    suma, factor = 0, 2
    for d in reversed(str(numero)):
        suma += int(d) * factor
        factor = 2 if factor == 7 else factor + 1
    dv = {11: "0", 10: "K"}.get(11 - suma % 11, str(11 - suma % 11))
    return f"{numero:,}".replace(",", ".") + f"-{dv}"


async def _rut_libre(conn) -> tuple[str, str]:
    """Un RUT que ningún conductor real tiene: el test crea su sujeto, no toma uno de producción."""
    for numero in range(30_000_001, 30_001_000):
        crudo = _rut_con_puntos(numero)
        canon = await conn.fetchval("SELECT public.canonical_rut($1)", crudo)
        if not await conn.fetchval("SELECT 1 FROM public.drivers WHERE tax_id = $1", canon):
            return crudo, canon
    raise AssertionError("no hay un RUT libre en el rango de prueba")


async def test_un_nombre_distinto_en_el_tms_no_renombra_al_conductor(conexion_revertida):
    """Bloque 0 del Directorio, 0.10 (P9, 12/10): el nombre lo gestiona el
    Directorio; el TMS solo dice quién manejó cada viaje. Hasta acá este test
    afirmaba lo contrario: fijaba el defecto (A-7, el origen de D7)."""
    rut, canon = await _rut_libre(conexion_revertida)
    conductor = await conexion_revertida.fetchval(
        "INSERT INTO public.drivers (full_name, tax_id, operational_status) VALUES ('Ana', $1, 'ACTIVE') RETURNING id", canon)
    await _viaje(conexion_revertida, rut=rut, driver_name="Ana Paz")

    await _dia_abierto(conexion_revertida)
    await cierre_lineas.recalcular_en(conexion_revertida, D)

    assert await conexion_revertida.fetchval("SELECT full_name FROM public.drivers WHERE id = $1", conductor) == "Ana"
    assert not await conexion_revertida.fetchval(
        "SELECT 1 FROM public.audit_log WHERE entity_id = $1 AND action = 'pre_cierre_actualizar_nombre'", conductor)


async def test_los_avisos_no_escriben_nada(conexion_revertida):
    await _viaje(conexion_revertida, plate=f"ZZ{uuid.uuid4().hex[:4].upper()}", transporter="Otra")
    antes = await conexion_revertida.fetchrow(
        "SELECT sum(n_tup_ins) i, sum(n_tup_upd) u, sum(n_tup_del) d FROM pg_stat_xact_user_tables")

    avisos = await pre_cierre.avisos_del_dia(conexion_revertida, D)

    despues = await conexion_revertida.fetchrow(
        "SELECT sum(n_tup_ins) i, sum(n_tup_upd) u, sum(n_tup_del) d FROM pg_stat_xact_user_tables")
    assert tuple(antes) == tuple(despues)
    assert set(avisos["escalations"]) == set(pre_cierre.ESCALACIONES)
    assert avisos["escalations"]["PATENTE_NO_REGISTRADA"], "la patente inventada tiene que avisarse"


async def test_la_empresa_en_onboarding_trae_su_estado(conexion_revertida):
    """Bloque 0 del Directorio, 0.3: "Activar empresa" se ofrece con
    directory.edit solo para las filas en ONBOARDING; las demás (dar de baja,
    reactivar) son de directory.delete. La fila trae el estado para decidirlo,
    y las filas que devuelve el aviso son las mismas que antes."""
    estados = {}
    for estado in ("ONBOARDING", "INACTIVE"):
        empresa = await conexion_revertida.fetchval(
            "INSERT INTO public.carriers (business_name, operational_status) VALUES ($1, $2) RETURNING id",
            f"{P} {estado}", estado)
        plate = f"ZZ{uuid.uuid4().hex[:4].upper()}"
        asset = await conexion_revertida.fetchval(
            "INSERT INTO public.assets (license_plate, asset_type, operational_status) "
            "VALUES ($1, 'TRACTOCAMION', 'ACTIVE') RETURNING id", plate)
        await asignacion_previa(conexion_revertida, 'ASSET', asset, empresa)
        await _viaje(conexion_revertida, plate=plate)
        await _viaje(conexion_revertida, plate=plate)   # dos viajes, una sola fila (DISTINCT)
        estados[str(empresa)] = estado

    avisos = await pre_cierre.avisos_del_dia(conexion_revertida, D)

    nuestras = [r for r in avisos["escalations"]["EMPRESA_ONBOARDING"] if r["carrier_id"] in estados]
    assert sorted((r["carrier_id"], r["operational_status"]) for r in nuestras) == sorted(estados.items())
