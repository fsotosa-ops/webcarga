"""Asignar conductor desde el Monitor.

El vinculo manual es TERMINAL: app.resolve_trip_fleet() nunca lo pisa. Ver
docs/superpowers/specs/2026-08-17-modelo-resolucion-flota-design.md

Estos tests llaman a los ENDPOINTS reales, no insertan por SQL. La version
original del plan hacia lo segundo, y por eso habria pasado igual antes y
despues de la correccion: verificaba que Postgres sabe guardar una fila, no
que el endpoint la deja guardar. Cada test se corrio contra el codigo viejo
para verlo fallar antes de escribir la correccion.

Todo corre dentro de la transaccion revertida de `conexion_revertida`: nada
de esto queda escrito.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.routers.trips import assign_driver_bulk, assign_fleet_link, driver_candidates
from app.schemas.trip import AsignarConductorBody
from tests.conftest import PoolDeUnaConexion, _usuario_real

pytestmark = pytest.mark.integracion


async def _un_viaje(conn) -> str:
    """Un viaje cualquiera, sin vinculo previo, para no depender de datos."""
    trip_id = await conn.fetchval("SELECT id FROM app.trips LIMIT 1")
    await conn.execute("DELETE FROM app.trip_fleet_links WHERE trip_id = $1", trip_id)
    return str(trip_id)


async def _un_conductor(conn) -> str:
    return str(await conn.fetchval(
        "SELECT id FROM public.drivers WHERE tax_id IS NOT NULL LIMIT 1"))


# ── Task 1: la empresa deja de ser obligatoria ────────────────────────────


async def test_se_puede_vincular_un_conductor_sin_empresa(conexion_revertida):
    """La causa del reporte del viaje 2032999: el endpoint exigia carrier_id,
    asi que forzar el conductor no creaba ningun vinculo manual.

    Son dos preguntas con fuentes distintas: al conductor lo sabe el TMS; a la
    empresa NO —informa 'WEBCARGA SPA' en 933 de 1.050 viajes— y la sabe el
    registro de flota. Soldarlas obliga a contestar una para responder la otra.

    Contra el codigo viejo este test fallaba con HTTPException(422,
    'carrier_id requerido')."""
    conn = conexion_revertida
    trip_id = await _un_viaje(conn)
    driver_id = await _un_conductor(conn)

    await assign_fleet_link(
        trip_id, {"driver_id": driver_id}, PoolDeUnaConexion(conn), await _usuario_real(conn),
    )

    fila = await conn.fetchrow(
        "SELECT driver_id, carrier_id, link_source FROM app.trip_fleet_links "
        "WHERE trip_id = $1", trip_id)
    assert str(fila["driver_id"]) == driver_id
    assert fila["carrier_id"] is None, "no se pidio empresa y sin embargo quedo una"
    assert fila["link_source"] == "manual"


async def test_sigue_pudiendo_vincular_solo_la_empresa(conexion_revertida):
    """El camino viejo no se rompe: la empresa sola sigue siendo valida."""
    conn = conexion_revertida
    trip_id = await _un_viaje(conn)
    carrier_id = str(await conn.fetchval("SELECT id FROM public.carriers LIMIT 1"))

    await assign_fleet_link(
        trip_id, {"carrier_id": carrier_id}, PoolDeUnaConexion(conn), await _usuario_real(conn),
    )

    fila = await conn.fetchrow(
        "SELECT driver_id, carrier_id FROM app.trip_fleet_links WHERE trip_id = $1",
        trip_id)
    assert str(fila["carrier_id"]) == carrier_id
    assert fila["driver_id"] is None


async def test_un_vinculo_vacio_sigue_siendo_un_error(conexion_revertida):
    """Aflojar la exigencia no es quitarla: sin conductor NI empresa el
    vinculo no dice nada, y crearlo solo serviria para pisar la resolucion
    automatica con silencio."""
    conn = conexion_revertida
    trip_id = await _un_viaje(conn)

    with pytest.raises(HTTPException) as e:
        await assign_fleet_link(trip_id, {}, PoolDeUnaConexion(conn), await _usuario_real(conn))
    assert e.value.status_code == 422

    assert await conn.fetchval(
        "SELECT count(*) FROM app.trip_fleet_links WHERE trip_id = $1", trip_id) == 0


async def test_el_resolvedor_no_pisa_ese_vinculo(conexion_revertida):
    """Sin esto, la proxima corrida del pipeline borraria la correccion."""
    conn = conexion_revertida
    trip_id = await _un_viaje(conn)
    driver_id = await _un_conductor(conn)
    await assign_fleet_link(
        trip_id, {"driver_id": driver_id}, PoolDeUnaConexion(conn), await _usuario_real(conn))

    await conn.execute("SELECT * FROM app.resolve_trip_fleet(array[$1]::uuid[])", trip_id)

    fila = await conn.fetchrow(
        "SELECT driver_id, link_source FROM app.trip_fleet_links WHERE trip_id = $1",
        trip_id)
    assert str(fila["driver_id"]) == driver_id, "el resolvedor piso una correccion manual"
    assert fila["link_source"] == "manual"


# ── Task 2: candidatos por CONTENCION, no por similitud ───────────────────
#
# Medido sobre los 7 viajes de identidad SEGURA (driver_match_rule='tms_rut'):
# en los 7, todos los tokens del TMS estan en el nombre del roster. La
# similitud baja solo porque el TMS reporta MENOS palabras — 4 vs 2 da 0.400,
# 4 vs 3 da 0.700, 4 vs 4 da 1.000. Un umbral en 0.5 escondia 3 de esos 7.
# Por eso ordena la contencion y la similitud solo desempata.


async def _un_nombre_de_roster(conn, minimo_tokens: int = 4):
    """Un conductor real y sus tokens. Los nombres salen de la base y no se
    escriben en el test: no hay PII hardcodeada y no se rompe si cambia el
    padron."""
    return await conn.fetchrow(
        """
        SELECT d.id, d.full_name, public.name_tokens(d.full_name) AS tokens
        FROM public.drivers d
        WHERE d.full_name IS NOT NULL AND d.operational_status = 'ACTIVE'
          AND array_length(public.name_tokens(d.full_name), 1) >= $1
        ORDER BY d.id LIMIT 1
        """,
        minimo_tokens,
    )


async def test_los_contenidos_van_antes_que_los_meramente_parecidos(conexion_revertida):
    conn = conexion_revertida
    persona = await _un_nombre_de_roster(conn)
    nombre_tms = " ".join(reversed(persona["tokens"])).upper()

    resp = await driver_candidates(nombre=nombre_tms, limit=5,
                                    pool=PoolDeUnaConexion(conn), _=None)

    filas = resp["candidatos"]
    contenidos = [f for f in filas if f["contiene"]]
    assert contenidos, "el orden invertido escondio a la persona"
    assert str(persona["id"]) in [f["driver_id"] for f in contenidos]
    banderas = [f["contiene"] for f in filas]
    assert banderas == sorted(banderas, reverse=True)


async def test_un_nombre_incompleto_sigue_encontrando_a_la_persona(conexion_revertida):
    """El caso que la similitud sola pierde: el TMS reporta 2 de 4 palabras.

    Es exactamente lo que pasa en 3 de los 7 viajes identificados por RUT,
    donde la identidad NO esta en discusion y aun asi la similitud cae a
    0.400."""
    conn = conexion_revertida
    persona = await _un_nombre_de_roster(conn)
    nombre_tms = " ".join(persona["tokens"][:2]).upper()

    resp = await driver_candidates(nombre=nombre_tms, limit=5,
                                    pool=PoolDeUnaConexion(conn), _=None)

    filas = resp["candidatos"]
    encontrada = next((f for f in filas
                       if f["driver_id"] == str(persona["id"])), None)
    assert encontrada is not None, "un nombre incompleto perdio a la persona"
    assert encontrada["contiene"] is True
    assert encontrada["similitud"] < 0.8, (
        "si la similitud fuera alta este test no probaria nada: el punto es "
        "que la contencion la encuentra donde la similitud no llegaria")


async def test_cuando_nadie_contiene_el_nombre_no_hay_candidato_valido(conexion_revertida):
    """El caso del viaje 2032999: esa persona no existe en el roster. La UI
    tiene que ir a dar de alta, no ofrecer al mas parecido —que ahi es otra
    persona, con similitud 0,22."""
    resp = await driver_candidates(
        nombre="ZZQQ INEXISTENTE XKCD PERSONA", limit=5,
        pool=PoolDeUnaConexion(conexion_revertida), _=None)

    assert all(f["contiene"] is False for f in resp["candidatos"])


async def test_un_nombre_de_una_sola_palabra_no_devuelve_candidatos(conexion_revertida):
    """Con un token, la contencion matchearia a media base: cualquiera que
    tenga ese apellido. Un candidato asi no es una pista, es ruido."""
    resp = await driver_candidates(nombre="PEREZ", limit=5,
                                    pool=PoolDeUnaConexion(conexion_revertida), _=None)
    assert resp["candidatos"] == []


# ── Task 3: el lote ───────────────────────────────────────────────────────


async def _tres_viajes(conn) -> list[str]:
    return [str(r["id"]) for r in await conn.fetch("SELECT id FROM app.trips LIMIT 3")]


async def test_asigna_a_varios_viajes_de_una(conexion_revertida):
    """27 personas explican 208 viajes: 7,7 cada una. Resolver de a un viaje
    convierte una decision en ocho."""
    conn = conexion_revertida
    viajes = await _tres_viajes(conn)
    driver_id = await _un_conductor(conn)

    res = await assign_driver_bulk(
        AsignarConductorBody(driver_id=driver_id, trip_ids=viajes),
        PoolDeUnaConexion(conn), await _usuario_real(conn))

    assert res["asignados"] == 3
    assert await conn.fetchval(
        "SELECT count(*) FROM app.trip_fleet_links "
        "WHERE trip_id = ANY($1::uuid[]) AND driver_id = $2 AND link_source = 'manual'",
        viajes, driver_id) == 3


async def test_no_se_aplica_a_medias(conexion_revertida):
    """Si el lote falla, no queda ninguno aplicado.

    El plan original probaba esto con un trip_id inexistente, pero NO EXISTE
    ninguna foreign key que apunte a app.trips (verificado sobre
    pg_constraint), asi que ese insert no falla. La que si existe es
    trip_fleet_links_driver_id_fkey: un conductor inexistente es el disparador
    real, y ademas es el error plausible —un id que quedo viejo en la pantalla—
    no un trip_id inventado."""
    import uuid as _u
    conn = conexion_revertida
    viajes = await _tres_viajes(conn)
    await conn.execute("DELETE FROM app.trip_fleet_links WHERE trip_id = ANY($1::uuid[])", viajes)

    with pytest.raises(Exception):
        await assign_driver_bulk(
            AsignarConductorBody(driver_id=str(_u.uuid4()), trip_ids=viajes),
            PoolDeUnaConexion(conn), await _usuario_real(conn))

    assert await conn.fetchval(
        "SELECT count(*) FROM app.trip_fleet_links WHERE trip_id = ANY($1::uuid[])",
        viajes) == 0, "quedaron vinculos a medias"


async def test_conserva_la_empresa_y_el_tracto_que_ya_estaban_resueltos(conexion_revertida):
    """LA decision de diseno de esta tarea.

    Los vinculos 'auto' traen empresa en 1.457 de 1.521 filas y tracto en las
    1.521. Y un vinculo 'manual' es TERMINAL: resolve_trip_fleet() no lo vuelve
    a tocar. Si asignar el conductor pisara esos campos con NULL, la empresa y
    el tracto ya resueltos se perderian PARA SIEMPRE — se cambia la respuesta a
    una pregunta contestando otra."""
    conn = conexion_revertida
    trip_id = await _un_viaje(conn)
    carrier_id = await conn.fetchval("SELECT id FROM public.carriers LIMIT 1")
    tracto_id = await conn.fetchval("SELECT id FROM public.assets LIMIT 1")
    await conn.execute(
        "INSERT INTO app.trip_fleet_links (trip_id, carrier_id, tractor_asset_id, "
        "tractor_plate, link_source) VALUES ($1,$2,$3,'ABCD12','auto')",
        trip_id, carrier_id, tracto_id)
    driver_id = await _un_conductor(conn)

    await assign_driver_bulk(
        AsignarConductorBody(driver_id=driver_id, trip_ids=[trip_id]),
        PoolDeUnaConexion(conn), await _usuario_real(conn))

    fila = await conn.fetchrow(
        "SELECT driver_id, carrier_id, tractor_asset_id, tractor_plate, link_source "
        "FROM app.trip_fleet_links WHERE trip_id = $1", trip_id)
    assert str(fila["driver_id"]) == driver_id
    assert fila["carrier_id"] == carrier_id, "se perdio la empresa ya resuelta"
    assert fila["tractor_asset_id"] == tracto_id, "se perdio el tracto ya resuelto"
    assert fila["tractor_plate"] == "ABCD12"
    assert fila["link_source"] == "manual"


async def test_un_lote_vacio_es_un_error(conexion_revertida):
    with pytest.raises(Exception):
        await assign_driver_bulk(
            AsignarConductorBody(driver_id=await _un_conductor(conexion_revertida),
                                 trip_ids=[]),
            PoolDeUnaConexion(conexion_revertida), await _usuario_real(conexion_revertida))


async def test_tambien_encuentra_cuando_al_tms_le_SOBRA_un_nombre(conexion_revertida):
    """La direccion que la primera version del endpoint perdia.

    Al TMS le puede FALTAR un nombre (roster 4 tokens, TMS 2) o le puede
    SOBRAR (roster 3, TMS 4: reporta un segundo apellido que el roster no
    guarda). `app.resolve_trip_fleet()` mira las dos direcciones en su CTE
    `by_partial`; no hay razon para que la sugerencia al humano sea mas pobre
    que la resolucion automatica."""
    conn = conexion_revertida
    persona = await _un_nombre_de_roster(conn, minimo_tokens=3)
    # el TMS agrega un nombre que el roster no tiene
    nombre_tms = " ".join(list(persona["tokens"]) + ["zzqq"]).upper()

    resp = await driver_candidates(nombre=nombre_tms, limit=5,
                                    pool=PoolDeUnaConexion(conn), _=None)

    encontrada = next((f for f in resp["candidatos"] if f["driver_id"] == str(persona["id"])), None)
    assert encontrada is not None, "un nombre del TMS con un token de mas perdio a la persona"
    assert encontrada["contiene"] is True


# ── El silencio se llena; la eleccion humana no se toca ───────────────────
#
# El reclamo de Pablo sobre Edgar: identificaba al conductor a mano y el viaje
# volvia a aparecer sin empresa. NO se revertia nada — el vinculo manual es
# terminal y eso lo prueban los tests de arriba. Lo que pasaba es que al
# vincular solo al conductor, `carrier_id` nacia NULL, y como el vinculo manual
# queda EXCLUIDO de todo el calculo, ese NULL se congelaba para siempre.
#
# Medido antes del arreglo: 25 vinculos manuales, 14 sin empresa, y LOS 14 con
# un conductor que si la tiene.


async def _conductor_con_empresa(conn) -> tuple[str, str]:
    """Un conductor del padron con asignacion ACTIVE, y su empresa."""
    fila = await conn.fetchrow(
        "SELECT da.driver_id, da.carrier_id FROM public.driver_assignments da "
        "WHERE da.status = 'ACTIVE' LIMIT 1")
    return str(fila["driver_id"]), str(fila["carrier_id"])


async def test_el_vinculo_manual_sin_empresa_la_hereda_del_conductor(conexion_revertida):
    """Una inferencia LLENA UN SILENCIO. Es la misma regla que la capa 5 del
    propio resolvedor: el padron solo habla si el TMS no dijo nada."""
    conn = conexion_revertida
    trip_id = await _un_viaje(conn)
    driver_id, carrier_id = await _conductor_con_empresa(conn)

    # Se vincula SOLO al conductor: el endpoint inserta carrier_id NULL.
    await assign_fleet_link(
        trip_id, {"driver_id": driver_id}, PoolDeUnaConexion(conn), await _usuario_real(conn))

    # No hace falta esperar a la proxima corrida del pipeline: el UPDATE de
    # `app.trips` que hace el propio endpoint dispara el trigger que llama a
    # resolve_trip_fleet(), asi que el silencio se llena en el acto. Se llama
    # igual, explicito, para que el test valga tambien si ese trigger cambia.
    await conn.execute("SELECT * FROM app.resolve_trip_fleet(array[$1]::uuid[])", trip_id)

    fila = await conn.fetchrow(
        "SELECT carrier_id, link_source FROM app.trip_fleet_links WHERE trip_id = $1", trip_id)
    assert str(fila["carrier_id"]) == carrier_id, "el silencio siguio congelado"
    assert fila["link_source"] == "manual", "se degrado el vinculo manual a automatico"


async def test_una_empresa_elegida_a_mano_NO_se_pisa(conexion_revertida):
    """La otra mitad, y la que importa: llenar un silencio nunca puede
    convertirse en contradecir. Si alguien eligio una empresa distinta a la del
    padron, esa eleccion manda."""
    conn = conexion_revertida
    trip_id = await _un_viaje(conn)
    driver_id, carrier_del_padron = await _conductor_con_empresa(conn)
    otra = str(await conn.fetchval(
        "SELECT id FROM public.carriers WHERE id <> $1::uuid LIMIT 1", carrier_del_padron))
    # Sin esto el test podria pasar por vacio: si la empresa elegida fuera la
    # MISMA del padron, no habria contradiccion que proteger y la asercion de
    # abajo se cumpliria sola, con guarda o sin ella.
    assert otra != carrier_del_padron, "el test necesita DOS empresas distintas"

    await assign_fleet_link(
        trip_id, {"driver_id": driver_id, "carrier_id": otra},
        PoolDeUnaConexion(conn), await _usuario_real(conn))

    await conn.execute("SELECT * FROM app.resolve_trip_fleet(array[$1]::uuid[])", trip_id)

    quedo = await conn.fetchval(
        "SELECT carrier_id FROM app.trip_fleet_links WHERE trip_id = $1", trip_id)
    assert str(quedo) == otra, (
        f"se piso la empresa elegida a mano ({otra}) con la del padron ({carrier_del_padron})")
