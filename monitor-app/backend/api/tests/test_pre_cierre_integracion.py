"""El pre-cierre contra Postgres de verdad: las correcciones escriben lo mismo
que antes y en lote, y los avisos no escriben nada."""
from __future__ import annotations

import json
import uuid
from datetime import date

import pytest

from app.services import pre_cierre

pytestmark = pytest.mark.integracion
D = date.fromisoformat("2026-06-11")
P = "ZZ-TEST-PRECIERRE"


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


async def test_reasigna_la_patente_y_audita_en_lote(conexion_revertida):
    vieja = await _empresa(conexion_revertida, f"{P} Vieja")
    nueva = await _empresa(conexion_revertida, f"{P} Nueva")
    plate = f"ZZ{uuid.uuid4().hex[:4].upper()}"
    asset = await conexion_revertida.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type, operational_status) VALUES ($1, 'TRACTOCAMION', 'ACTIVE') RETURNING id", plate)
    await conexion_revertida.execute(
        "INSERT INTO public.asset_assignments (asset_id, carrier_id, status) VALUES ($1, $2, 'ACTIVE')", asset, vieja)
    await _viaje(conexion_revertida, plate=plate, transporter=f"{P} Nueva")

    await pre_cierre.aplicar_correcciones(conexion_revertida, D)

    activa = await conexion_revertida.fetchval(
        "SELECT carrier_id FROM public.asset_assignments WHERE asset_id = $1 AND status = 'ACTIVE'", asset)
    assert activa == nueva
    fila = await conexion_revertida.fetchrow(
        "SELECT action, field, old_value, new_value, source, actor FROM public.audit_log "
        "WHERE entity_id = $1 ORDER BY id DESC LIMIT 1", asset)
    assert (fila["action"], fila["field"], fila["source"], fila["actor"]) == (
        "pre_cierre_reasignar_empresa", "carrier_id", "pre_cierre_auto", None)
    assert fila["old_value"] == f'"{P} Vieja"' and fila["new_value"] == f'"{P} Nueva"'


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


async def test_corrige_el_nombre_del_conductor_por_rut(conexion_revertida):
    rut, canon = await _rut_libre(conexion_revertida)
    conductor = await conexion_revertida.fetchval(
        "INSERT INTO public.drivers (full_name, tax_id, operational_status) VALUES ('Ana', $1, 'ACTIVE') RETURNING id", canon)
    await _viaje(conexion_revertida, rut=rut, driver_name="Ana Paz")

    await pre_cierre.aplicar_correcciones(conexion_revertida, D)

    assert await conexion_revertida.fetchval("SELECT full_name FROM public.drivers WHERE id = $1", conductor) == "Ana Paz"


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


async def test_un_override_en_la_empresa_nueva_no_deja_al_tracto_sin_empresa_ni_audita(conexion_revertida):
    """Hallazgo 4 de la revisión final: la auditoría sale de lo que se escribió,
    no de lo que se clasificó. Si la fila (tracto, empresa nueva) está fijada a
    mano como inactiva, la reasignación no ocurre: el tracto conserva su empresa
    y no queda ninguna fila de auditoría que diga lo contrario."""
    vieja = await _empresa(conexion_revertida, f"{P} Vieja")
    nueva = await _empresa(conexion_revertida, f"{P} Nueva")
    plate = f"ZZ{uuid.uuid4().hex[:4].upper()}"
    asset = await conexion_revertida.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type, operational_status) VALUES ($1, 'TRACTOCAMION', 'ACTIVE') RETURNING id", plate)
    await conexion_revertida.execute(
        "INSERT INTO public.asset_assignments (asset_id, carrier_id, status) VALUES ($1, $2, 'ACTIVE')", asset, vieja)
    await conexion_revertida.execute(
        "INSERT INTO public.asset_assignments (asset_id, carrier_id, status, is_manual_override) "
        "VALUES ($1, $2, 'INACTIVE', true)", asset, nueva)
    await _viaje(conexion_revertida, plate=plate, transporter=f"{P} Nueva")

    await pre_cierre.aplicar_correcciones(conexion_revertida, D)

    assert await conexion_revertida.fetchval(
        "SELECT carrier_id FROM public.asset_assignments WHERE asset_id = $1 AND status = 'ACTIVE'", asset) == vieja
    assert await conexion_revertida.fetchval(
        "SELECT count(*) FROM public.audit_log WHERE entity_id = $1 AND source = 'pre_cierre_auto'", asset) == 0


async def test_un_vinculo_fijado_a_mano_no_se_audita(conexion_revertida):
    """Mismo hallazgo para empresa ↔ cliente: un vínculo inactivo con override
    manual no se reactiva, y entonces no se audita."""
    empresa = await _empresa(conexion_revertida, f"{P} Empresa")
    cliente = await conexion_revertida.fetchval(
        "INSERT INTO public.shippers (name, status) VALUES ($1, 'ACTIVE') RETURNING id", f"{P} Cliente {uuid.uuid4().hex[:6]}")
    nombre_cliente = await conexion_revertida.fetchval("SELECT name FROM public.shippers WHERE id = $1", cliente)
    plate = f"ZZ{uuid.uuid4().hex[:4].upper()}"
    asset = await conexion_revertida.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type, operational_status) VALUES ($1, 'TRACTOCAMION', 'ACTIVE') RETURNING id", plate)
    await conexion_revertida.execute(
        "INSERT INTO public.asset_assignments (asset_id, carrier_id, status) VALUES ($1, $2, 'ACTIVE')", asset, empresa)
    await conexion_revertida.execute(
        "INSERT INTO public.carrier_shippers (carrier_id, shipper_id, status, is_manual_override) "
        "VALUES ($1, $2, 'INACTIVE', true)", empresa, cliente)
    await _viaje(conexion_revertida, plate=plate, transporter="WEBCARGA", client=nombre_cliente)

    await pre_cierre.aplicar_correcciones(conexion_revertida, D)

    assert await conexion_revertida.fetchval(
        "SELECT status FROM public.carrier_shippers WHERE carrier_id = $1 AND shipper_id = $2", empresa, cliente) == "INACTIVE"
    assert await conexion_revertida.fetchval(
        "SELECT count(*) FROM public.audit_log WHERE entity_id = $1 AND source = 'pre_cierre_auto'", empresa) == 0
