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
        "INSERT INTO public.vehicle_driver_assignments (asset_id, driver_id, source) "
        "VALUES ($1,$2,'padron_legacy')",
        tracto, uno)

    with pytest.raises(asyncpg.UniqueViolationError):
        await conn.execute(
            "INSERT INTO public.vehicle_driver_assignments (asset_id, driver_id, source) "
        "VALUES ($1,$2,'padron_legacy')",
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
            "INSERT INTO public.vehicle_driver_assignments (asset_id, driver_id, source) "
        "VALUES ($1,$2,'padron_legacy')",
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
        "INSERT INTO public.vehicle_driver_assignments (asset_id, driver_id, source) "
        "VALUES ($1,$2,'padron_legacy')",
        tracto, uno)
    await conn.execute(
        "UPDATE public.vehicle_driver_assignments SET status='INACTIVE', end_date=CURRENT_DATE "
        "WHERE asset_id=$1 AND driver_id=$2", tracto, uno)
    await conn.execute(
        "INSERT INTO public.vehicle_driver_assignments (asset_id, driver_id, source) "
        "VALUES ($1,$2,'padron_legacy')",
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
        "SELECT count(*) AS filas, count(DISTINCT plate) AS plates "
        "FROM silver.int_habitual_driver_by_tractor")
    assert fila["filas"] > 0, "el padron vacio no prueba nada"
    assert fila["filas"] == fila["plates"]


async def test_el_padron_solo_trae_identificadores_canonicos(conexion_revertida):
    """Nada que no pase por canonical_rut/canonical_plate sale de la vista."""
    assert await conexion_revertida.fetchval(
        """
        SELECT count(*) FROM silver.int_habitual_driver_by_tractor
        WHERE public.canonical_rut(tax_id) IS DISTINCT FROM tax_id
           OR public.canonical_plate(plate) IS DISTINCT FROM plate
        """
    ) == 0


async def test_el_padron_cubre_las_patentes_que_estan_rodando(conexion_revertida):
    """La prueba que importa: los viajes de agosto —que el legacy NO conoce,
    porque sus despachos cortan el 31/07— tienen que resolver igual."""
    fila = await conexion_revertida.fetchrow(
        """
        WITH v AS (
            SELECT DISTINCT public.canonical_plate(t.fleet->>'tractor_plate') AS plate
            FROM app.trips t
            WHERE t.planning_date >= '2026-08-01'
              AND public.canonical_plate(t.fleet->>'tractor_plate') IS NOT NULL
        )
        SELECT count(*) AS plates,
               count(*) FILTER (
                   WHERE EXISTS (SELECT 1 FROM silver.int_habitual_driver_by_tractor p
                                 WHERE p.plate = v.plate)) AS cubiertas
        FROM v
        """
    )
    assert fila["plates"] > 0
    # Medido 2026-08-17: 47 de 47. Se exige 90% para que no se rompa por una
    # patente nueva legitima, pero si baja de ahi hay que mirar.
    assert fila["cubiertas"] / fila["plates"] >= 0.90


# ══════════════════════════════════════════════════════════════════════════
# El sembrado
# ══════════════════════════════════════════════════════════════════════════

async def test_sembrar_es_idempotente(conexion_revertida):
    """Correrlo dos veces deja lo mismo que correrlo una."""
    conn = conexion_revertida
    sql = "SELECT count(*) FROM public.vehicle_driver_assignments WHERE status='ACTIVE'"
    await conn.execute("SELECT * FROM public.sync_habitual_drivers()")
    primera = await conn.fetchval(sql)
    await conn.execute("SELECT * FROM public.sync_habitual_drivers()")
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
        SELECT p.plate, p.tax_id FROM silver.int_habitual_driver_by_tractor p
        JOIN public.assets  a ON a.license_plate = p.plate
        JOIN public.drivers d ON d.tax_id        = p.tax_id
        WHERE p.last_dispatched_on < current_date - 90
        LIMIT 1
        """
    )
    if vieja is None:
        pytest.skip("no hay entradas viejas con alta previa: nada que verificar")

    asset_id = await conn.fetchval(
        "SELECT id FROM public.assets WHERE license_plate = $1", vieja["plate"])
    await conn.execute(
        "DELETE FROM public.vehicle_driver_assignments WHERE asset_id = $1", asset_id)

    await conn.execute("SELECT * FROM public.sync_habitual_drivers()")

    assert await conn.fetchval(
        "SELECT count(*) FROM public.vehicle_driver_assignments "
        "WHERE asset_id = $1 AND status = 'ACTIVE'", asset_id) == 0


async def test_no_pisa_una_correccion_manual(conexion_revertida):
    """La regla que sostiene todo el diseno: quien corrigio a mano sabe algo
    que la inferencia no, y el proximo sembrado no puede borrarlo."""
    conn = conexion_revertida
    fila = await conn.fetchrow(
        """
        SELECT p.plate FROM silver.int_habitual_driver_by_tractor p
        JOIN public.assets  a ON a.license_plate = p.plate
        JOIN public.drivers d ON d.tax_id        = p.tax_id
        WHERE p.last_dispatched_on >= current_date - 90
        LIMIT 1
        """
    )
    assert fila is not None, "sin padron fresco con alta previa el test no prueba nada"
    asset_id = await conn.fetchval(
        "SELECT id FROM public.assets WHERE license_plate = $1", fila["plate"])

    otro = await _conductor(conn, "Correccion A Mano", "12345678-5")
    await conn.execute(
        "DELETE FROM public.vehicle_driver_assignments WHERE asset_id = $1", asset_id)
    await conn.execute(
        "INSERT INTO public.vehicle_driver_assignments "
        "(asset_id, driver_id, is_manual_override, source) VALUES ($1,$2,true,'manual')", asset_id, otro)

    await conn.execute("SELECT * FROM public.sync_habitual_drivers()")

    assert await conn.fetchval(
        "SELECT driver_id FROM public.vehicle_driver_assignments "
        "WHERE asset_id=$1 AND status='ACTIVE'", asset_id) == otro


async def test_reemplaza_una_asignacion_automatica_desactualizada(conexion_revertida):
    """Lo automatico si se actualiza, y el anterior queda como historia."""
    conn = conexion_revertida
    fila = await conn.fetchrow(
        """
        SELECT p.plate FROM silver.int_habitual_driver_by_tractor p
        JOIN public.assets  a ON a.license_plate = p.plate
        JOIN public.drivers d ON d.tax_id        = p.tax_id
        WHERE p.last_dispatched_on >= current_date - 90
        LIMIT 1
        """
    )
    asset_id = await conn.fetchval(
        "SELECT id FROM public.assets WHERE license_plate = $1", fila["plate"])

    viejo = await _conductor(conn, "Conductor Viejo", "1234567-4")
    await conn.execute(
        "DELETE FROM public.vehicle_driver_assignments WHERE asset_id = $1", asset_id)
    await conn.execute(
        "INSERT INTO public.vehicle_driver_assignments "
        "(asset_id, driver_id, is_manual_override, source) VALUES ($1,$2,false,'padron_legacy')", asset_id, viejo)

    await conn.execute("SELECT * FROM public.sync_habitual_drivers()")

    assert await conn.fetchval(
        "SELECT status FROM public.vehicle_driver_assignments "
        "WHERE asset_id=$1 AND driver_id=$2", asset_id, viejo) == "INACTIVE"
    assert await conn.fetchval(
        "SELECT count(*) FROM public.vehicle_driver_assignments "
        "WHERE asset_id=$1 AND status='ACTIVE'", asset_id) == 1


async def test_la_vista_no_mira_el_nombre_del_conductor(conexion_revertida):
    """Guardia ESTRUCTURAL de la propiedad que compra todo el refactor.

    La version vieja de app.v_trip_fleet_resolution resolvia el conductor
    comparando `drivers.full_name` con el nombre del TMS, EN CADA LECTURA. Por
    eso corregir la tipografia de un nombre cambiaba quien aparece en un dia ya
    cerrado. Ahora la respuesta esta materializada y la vista solo la lee.

    Se comprueba sobre la DEFINICION y no sobre los datos a proposito: la
    version anterior de este test buscaba un viaje resuelto por `nombre`, y
    cuando el padron subio la cobertura al 100% dejo de haber ninguno — se
    salteaba solo, y un test que se saltea no protege nada."""
    definicion = await conexion_revertida.fetchval(
        "SELECT pg_get_viewdef('app.v_trip_fleet_resolution'::regclass, true)")
    assert "full_name" not in definicion, (
        "la vista volvio a comparar nombres: la historia vuelve a ser reescribible")
    assert "trip_fleet_links" in definicion, "la vista dejo de leer el hecho materializado"


async def test_un_dia_cerrado_no_cambia_cuando_cambian_los_maestros(conexion_revertida):
    """La misma propiedad, comprobada sobre datos reales: renombrar al
    conductor no mueve la resolucion de un viaje ya resuelto."""
    conn = conexion_revertida
    fila = await conn.fetchrow(
        """
        SELECT trip_id, resolved_driver_id FROM app.v_trip_fleet_resolution
        WHERE resolved_driver_id IS NOT NULL LIMIT 1
        """
    )
    assert fila is not None, "sin viajes resueltos el test no prueba nada"

    await conn.execute(
        "UPDATE public.drivers SET full_name = full_name || ' XX' WHERE id = $1",
        fila["resolved_driver_id"])

    assert await conn.fetchval(
        "SELECT resolved_driver_id FROM app.v_trip_fleet_resolution WHERE trip_id = $1",
        fila["trip_id"]) == fila["resolved_driver_id"]


async def test_resolver_es_idempotente(conexion_revertida):
    """Correrlo dos veces no cambia el reparto por regla."""
    conn = conexion_revertida
    una = await conn.fetchval(
        "SELECT by_rule::text FROM app.resolve_trip_fleet("
        "  array(SELECT id FROM app.trips WHERE planning_date >= current_date - 7))")
    dos = await conn.fetchval(
        "SELECT by_rule::text FROM app.resolve_trip_fleet("
        "  array(SELECT id FROM app.trips WHERE planning_date >= current_date - 7))")
    assert una == dos


async def test_el_resolvedor_no_pisa_una_correccion_manual(conexion_revertida):
    """Precedencia 1: lo que dijo una persona es terminal."""
    conn = conexion_revertida
    trip_id = await conn.fetchval(
        "SELECT trip_id FROM app.trip_fleet_links WHERE link_source='manual' LIMIT 1")
    if trip_id is None:
        pytest.skip("no hay vinculos manuales")
    antes = await conn.fetchval(
        "SELECT driver_id FROM app.trip_fleet_links WHERE trip_id = $1", trip_id)

    await conn.execute("SELECT * FROM app.resolve_trip_fleet(array[$1]::uuid[])", trip_id)

    assert await conn.fetchval(
        "SELECT driver_id FROM app.trip_fleet_links WHERE trip_id = $1", trip_id) == antes
    assert await conn.fetchval(
        "SELECT link_source FROM app.trip_fleet_links WHERE trip_id = $1", trip_id) == "manual"
