"""El padron de conductor por tracto: nivel 2 de app.v_trip_fleet_resolution.

Ver `docs/superpowers/plans/2026-08-17-cierre-bloque-0-padron.md`.

La vista resuelve el conductor con
    COALESCE(fl.driver_id, vda_auto.driver_id, d_by_name.id)
y el del medio —public.vehicle_driver_assignments— tenia UNA fila en toda la
base. Por eso todo caia al tercero, la igualdad exacta de nombre, que acierta
el 34%.

Los RUT de este archivo son SINTETICOS.
"""
from __future__ import annotations

import asyncpg
import pytest

pytestmark = pytest.mark.integracion


async def _tracto(conn, patente: str) -> str:
    return await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type) "
        "VALUES ($1, 'TRACTOCAMION') RETURNING id",
        patente,
    )


async def _conductor(conn, nombre: str, rut: str) -> str:
    return await conn.fetchval(
        "INSERT INTO public.drivers (full_name, tax_id) VALUES ($1, $2) RETURNING id",
        nombre, rut,
    )


# ══════════════════════════════════════════════════════════════════════════
# Un conductor habitual por tracto
# ══════════════════════════════════════════════════════════════════════════

async def test_un_tracto_no_puede_tener_dos_conductores_activos(conexion_revertida):
    """Si los tuviera, el LEFT JOIN de la vista de resolucion duplicaria el
    viaje: la misma fila apareceria dos veces en el Cierre, con dos
    conductores distintos, y contaria doble en todos los totales."""
    conn = conexion_revertida
    tracto = await _tracto(conn, "ZZAA11")
    uno = await _conductor(conn, "Conductor Uno", "12345678-5")
    dos = await _conductor(conn, "Conductor Dos", "1234567-4")

    await conn.execute(
        "INSERT INTO public.vehicle_driver_assignments (asset_id, driver_id) VALUES ($1,$2)",
        tracto, uno)

    with pytest.raises(asyncpg.UniqueViolationError):
        await conn.execute(
            "INSERT INTO public.vehicle_driver_assignments (asset_id, driver_id) VALUES ($1,$2)",
            tracto, dos)


async def test_un_conductor_si_puede_manejar_varios_tractos(conexion_revertida):
    """La restriccion es en UN solo sentido, y no es simetrica: 96 de 348
    conductores del padron son habituales de mas de un tracto (uno llega a 8).
    El join de la vista es por asset_id, asi que este caso no duplica nada."""
    conn = conexion_revertida
    uno = await _tracto(conn, "ZZAA33")
    dos = await _tracto(conn, "ZZAA44")
    conductor = await _conductor(conn, "Conductor Rotativo", "12345678-5")

    for tracto in (uno, dos):
        await conn.execute(
            "INSERT INTO public.vehicle_driver_assignments (asset_id, driver_id) VALUES ($1,$2)",
            tracto, conductor)

    assert await conn.fetchval(
        "SELECT count(*) FROM public.vehicle_driver_assignments "
        "WHERE driver_id = $1 AND status = 'ACTIVE'", conductor) == 2


async def test_el_conductor_anterior_puede_quedar_inactivo(conexion_revertida):
    """El indice es parcial: la historia se conserva, solo se limita a UNO
    activo. Cambiar de conductor habitual no exige borrar el anterior."""
    conn = conexion_revertida
    tracto = await _tracto(conn, "ZZAA22")
    uno = await _conductor(conn, "Conductor Tres", "12345678-5")
    dos = await _conductor(conn, "Conductor Cuatro", "1234567-4")

    await conn.execute(
        "INSERT INTO public.vehicle_driver_assignments (asset_id, driver_id) VALUES ($1,$2)",
        tracto, uno)
    await conn.execute(
        "UPDATE public.vehicle_driver_assignments SET status='INACTIVE', end_date=CURRENT_DATE "
        "WHERE asset_id=$1 AND driver_id=$2", tracto, uno)
    await conn.execute(
        "INSERT INTO public.vehicle_driver_assignments (asset_id, driver_id) VALUES ($1,$2)",
        tracto, dos)

    assert await conn.fetchval(
        "SELECT count(*) FROM public.vehicle_driver_assignments WHERE asset_id=$1", tracto) == 2


# ══════════════════════════════════════════════════════════════════════════
# El padron
# ══════════════════════════════════════════════════════════════════════════

async def test_el_padron_da_una_sola_fila_por_patente(conexion_revertida):
    """Es la clave de la tabla destino: si repitiera patente, el sembrado
    chocaria contra ux_vehicle_driver_assignments_active_asset."""
    fila = await conexion_revertida.fetchrow(
        "SELECT count(*) AS filas, count(DISTINCT patente) AS patentes "
        "FROM app.v_legacy_padron_conductor")
    assert fila["filas"] > 0, "el padron vacio no prueba nada"
    assert fila["filas"] == fila["patentes"]


async def test_el_padron_solo_trae_identificadores_canonicos(conexion_revertida):
    """Nada que no pase por rut_canonico/patente_canonica sale de la vista."""
    assert await conexion_revertida.fetchval(
        """
        SELECT count(*) FROM app.v_legacy_padron_conductor
        WHERE public.rut_canonico(tax_id) IS DISTINCT FROM tax_id
           OR public.patente_canonica(patente) IS DISTINCT FROM patente
        """
    ) == 0


async def test_el_padron_cubre_las_patentes_que_estan_rodando(conexion_revertida):
    """La prueba que importa: los viajes de agosto —que el legacy NO conoce,
    porque sus despachos cortan el 31/07— tienen que resolver igual."""
    fila = await conexion_revertida.fetchrow(
        """
        WITH v AS (
            SELECT DISTINCT public.patente_canonica(t.fleet->>'tractor_plate') AS patente
            FROM app.trips t
            WHERE t.planning_date >= '2026-08-01'
              AND public.patente_canonica(t.fleet->>'tractor_plate') IS NOT NULL
        )
        SELECT count(*) AS patentes,
               count(*) FILTER (
                   WHERE EXISTS (SELECT 1 FROM app.v_legacy_padron_conductor p
                                 WHERE p.patente = v.patente)) AS cubiertas
        FROM v
        """
    )
    assert fila["patentes"] > 0
    # Medido 2026-08-17: 47 de 47. Se exige 90% para que no se rompa por una
    # patente nueva legitima, pero si baja de ahi hay que mirar.
    assert fila["cubiertas"] / fila["patentes"] >= 0.90


# ══════════════════════════════════════════════════════════════════════════
# El sembrado
# ══════════════════════════════════════════════════════════════════════════

async def test_sembrar_es_idempotente(conexion_revertida):
    """Correrlo dos veces deja lo mismo que correrlo una."""
    conn = conexion_revertida
    sql = "SELECT count(*) FROM public.vehicle_driver_assignments WHERE status='ACTIVE'"
    await conn.execute("SELECT * FROM app.sembrar_padron_conductor()")
    primera = await conn.fetchval(sql)
    await conn.execute("SELECT * FROM app.sembrar_padron_conductor()")
    assert await conn.fetchval(sql) == primera


async def test_no_siembra_entradas_viejas_del_padron(conexion_revertida):
    """El corte de frescura, que es la decision de diseno mas importante del
    sembrado. Medido contra julio: una entrada de menos de 3 meses acierta el
    94,2% (673 casos); una de 3 a 6 meses acierta el 4,0% (25 casos). Una
    entrada vieja no es una conjetura peor, es un nombre casi seguro
    equivocado — y en el Cierre un nombre plausible se confirma solo.
    Dejar la celda vacia hace la pregunta; llenarla mal la esconde."""
    conn = conexion_revertida
    vieja = await conn.fetchrow(
        """
        SELECT p.patente, p.tax_id FROM app.v_legacy_padron_conductor p
        JOIN public.assets  a ON a.license_plate = p.patente
        JOIN public.drivers d ON d.tax_id        = p.tax_id
        WHERE p.ultimo_despacho < current_date - 90
        LIMIT 1
        """
    )
    if vieja is None:
        pytest.skip("no hay entradas viejas con alta previa: nada que verificar")

    asset_id = await conn.fetchval(
        "SELECT id FROM public.assets WHERE license_plate = $1", vieja["patente"])
    await conn.execute(
        "DELETE FROM public.vehicle_driver_assignments WHERE asset_id = $1", asset_id)

    await conn.execute("SELECT * FROM app.sembrar_padron_conductor()")

    assert await conn.fetchval(
        "SELECT count(*) FROM public.vehicle_driver_assignments "
        "WHERE asset_id = $1 AND status = 'ACTIVE'", asset_id) == 0


async def test_no_pisa_una_correccion_manual(conexion_revertida):
    """La regla que sostiene todo el diseno: quien corrigio a mano sabe algo
    que la inferencia no, y el proximo sembrado no puede borrarlo."""
    conn = conexion_revertida
    fila = await conn.fetchrow(
        """
        SELECT p.patente FROM app.v_legacy_padron_conductor p
        JOIN public.assets  a ON a.license_plate = p.patente
        JOIN public.drivers d ON d.tax_id        = p.tax_id
        WHERE p.ultimo_despacho >= current_date - 90
        LIMIT 1
        """
    )
    assert fila is not None, "sin padron fresco con alta previa el test no prueba nada"
    asset_id = await conn.fetchval(
        "SELECT id FROM public.assets WHERE license_plate = $1", fila["patente"])

    otro = await _conductor(conn, "Correccion A Mano", "12345678-5")
    await conn.execute(
        "DELETE FROM public.vehicle_driver_assignments WHERE asset_id = $1", asset_id)
    await conn.execute(
        "INSERT INTO public.vehicle_driver_assignments "
        "(asset_id, driver_id, is_manual_override) VALUES ($1,$2,true)", asset_id, otro)

    await conn.execute("SELECT * FROM app.sembrar_padron_conductor()")

    assert await conn.fetchval(
        "SELECT driver_id FROM public.vehicle_driver_assignments "
        "WHERE asset_id=$1 AND status='ACTIVE'", asset_id) == otro


async def test_reemplaza_una_asignacion_automatica_desactualizada(conexion_revertida):
    """Lo automatico si se actualiza, y el anterior queda como historia."""
    conn = conexion_revertida
    fila = await conn.fetchrow(
        """
        SELECT p.patente FROM app.v_legacy_padron_conductor p
        JOIN public.assets  a ON a.license_plate = p.patente
        JOIN public.drivers d ON d.tax_id        = p.tax_id
        WHERE p.ultimo_despacho >= current_date - 90
        LIMIT 1
        """
    )
    asset_id = await conn.fetchval(
        "SELECT id FROM public.assets WHERE license_plate = $1", fila["patente"])

    viejo = await _conductor(conn, "Conductor Viejo", "1234567-4")
    await conn.execute(
        "DELETE FROM public.vehicle_driver_assignments WHERE asset_id = $1", asset_id)
    await conn.execute(
        "INSERT INTO public.vehicle_driver_assignments "
        "(asset_id, driver_id, is_manual_override) VALUES ($1,$2,false)", asset_id, viejo)

    await conn.execute("SELECT * FROM app.sembrar_padron_conductor()")

    assert await conn.fetchval(
        "SELECT status FROM public.vehicle_driver_assignments "
        "WHERE asset_id=$1 AND driver_id=$2", asset_id, viejo) == "INACTIVE"
    assert await conn.fetchval(
        "SELECT count(*) FROM public.vehicle_driver_assignments "
        "WHERE asset_id=$1 AND status='ACTIVE'", asset_id) == 1


async def test_la_resolucion_del_conductor_mejora_de_verdad(conexion_revertida):
    """El test que justifica el plan entero: la vista que consumen los 5
    routers tiene que resolver mas viajes despues de sembrar que antes."""
    conn = conexion_revertida
    sql = """
        SELECT count(*) FILTER (WHERE vfr.resolved_driver_id IS NOT NULL)::float
             / NULLIF(count(*), 0)
        FROM app.trips t
        JOIN app.v_trip_fleet_resolution vfr ON vfr.trip_id = t.id
        WHERE t.planning_date >= current_date - 30
    """
    antes = await conn.fetchval(sql)
    await conn.execute("SELECT * FROM app.sembrar_padron_conductor()")
    despues = await conn.fetchval(sql)

    assert antes is not None and despues is not None
    assert despues > antes, f"sembrar no mejoro nada: antes={antes} despues={despues}"
