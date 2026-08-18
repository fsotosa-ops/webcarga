"""El paso "Viajes" del Cierre.

La unica escritura de WebCarga sobre un viaje es "no asignado por WebCarga",
con motivo (regla 2 de Pablo). El trip_status del TMS no se toca nunca.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta

import pytest

from tests.conftest import PoolDeUnaConexion, _usuario_real

pytestmark = pytest.mark.integracion

# asyncpg tipa $1 como `date` en cuanto el SQL lo castea con `::date`: exige
# un objeto date de Python, no un string (asyncpg.exceptions.DataError si se
# le pasa "2026-08-18" a secas). Mismo patron que _parse_business_date en
# daily_closures.py.
FECHA_NEGOCIO = date.fromisoformat("2026-08-18")

# `RUTA` (group_id 'en_ruta' en app.trip_statuses) — cualquier estado no
# terminal sirve para probar el predicado; este es el mismo que domina el
# grupo "abandonado" en produccion.
ESTADO_NO_TERMINAL = "RUTA"


async def _crear_viaje(
    conexion,
    *,
    planning_date,
    is_active,
    is_assigned,
    dias_sin_novedad=0,
    trip_status=ESTADO_NO_TERMINAL,
):
    """Inserta un viaje sintetico en app.trips, dentro de la transaccion
    revertida de `conexion_revertida` — nunca sobrevive al test.

    `app.trips` no tiene mas restricciones que la PK y el FK opcional de
    unassigned_reason_id (verificado contra la base real, pg_constraint), asi
    que alcanza con las columnas que el predicado lee. `status_reported_at`
    se calcula desde `dias_sin_novedad` para controlar exactamente la
    antiguedad que cada caso necesita."""
    trip_id = uuid.uuid4()
    status_reported_at = datetime.utcnow() - timedelta(days=dias_sin_novedad)
    await conexion.execute(
        """
        INSERT INTO app.trips
            (id, planning_date, client_name, source_system_trip_id, trip_status,
             status_reported_at, is_active, is_assigned)
        VALUES ($1, $2, 'TEST-CIERRE', $3, $4, $5, $6, $7)
        """,
        trip_id, planning_date, str(trip_id), trip_status, status_reported_at,
        is_active, is_assigned,
    )
    return trip_id


async def test_el_dominio_de_motivos_existe_y_tiene_codigo_estable(conexion_revertida):
    """Sin al menos una fila, status_taxonomies.py:30 responde 422
    'domain desconocido' y el selector de motivos no carga."""
    filas = await conexion_revertida.fetch(
        "SELECT code, label FROM app.status_taxonomies "
        "WHERE domain = 'TRIP_UNASSIGNED_REASON' AND active ORDER BY sort_order")

    assert len(filas) >= 4, "el dominio quedo vacio: el selector va a dar 422"
    codigos = {f["code"] for f in filas}
    assert None not in codigos, "un motivo sin code se rompe al renombrar la etiqueta"
    assert {"SIN_CAMION", "SIN_PROVEEDOR", "NO_DA_TARIFA", "MANDANTE_DECLINO"} <= codigos


async def test_cada_grupo_clasifica_al_viaje_que_le_corresponde(conexion_revertida):
    """Reemplaza dos tests que no probaban lo que decian: un SELECT con un
    solo CASE por fila sobre una tabla con PK jamas repite un trip_id (eso
    solo lo rompe un fan-out de JOIN, y aca no hay ninguno) — comprobar
    "disjuntos" asi era tautologico. Y depender de que produccion tenga
    abandonados hoy se cae el dia que operaciones los resuelve a todos, que
    es justamente el resultado bueno.

    Se prueba el predicado de verdad: un viaje sintetico por grupo, cada uno
    con los valores minimos que decide su clasificacion, y se verifica que
    cada uno aterriza en el grupo que le corresponde — ni en otro, ni en
    ninguno."""
    from app.services.cierre_viajes import SQL_GRUPOS_CIERRE

    id_hoy = await _crear_viaje(
        conexion_revertida, planning_date=FECHA_NEGOCIO,
        is_active=True, is_assigned=False)
    id_rezago = await _crear_viaje(
        conexion_revertida, planning_date=FECHA_NEGOCIO - timedelta(days=3),
        is_active=True, is_assigned=False)
    id_en_curso = await _crear_viaje(
        conexion_revertida, planning_date=FECHA_NEGOCIO - timedelta(days=3),
        is_active=True, is_assigned=True)
    id_abandonado = await _crear_viaje(
        conexion_revertida, planning_date=FECHA_NEGOCIO - timedelta(days=30),
        is_active=False, is_assigned=False, dias_sin_novedad=10)

    filas = await conexion_revertida.fetch(SQL_GRUPOS_CIERRE, FECHA_NEGOCIO)
    grupo_por_id = {f["trip_id"]: f["grupo"] for f in filas}

    esperado = {
        id_hoy: "hoy",
        id_rezago: "rezago",
        id_en_curso: "en_curso",
        id_abandonado: "abandonado",
    }
    for trip_id, grupo_esperado in esperado.items():
        assert trip_id in grupo_por_id, f"el viaje sintetico de {grupo_esperado} no aparecio en ningun grupo"
        assert grupo_por_id[trip_id] == grupo_esperado, (
            f"el viaje sintetico de {grupo_esperado} aterrizo en {grupo_por_id[trip_id]}")

    # Disjuntos, ahora si probado con datos que realmente cubren los cuatro
    # casos: cada id sintetico aparece una sola vez en el resultado completo.
    ids_en_resultado = [f["trip_id"] for f in filas]
    assert len(ids_en_resultado) == len(set(ids_en_resultado)), "hay viajes en mas de un grupo"


async def test_un_viaje_declarado_sale_del_grupo_abandonado(conexion_revertida):
    """Critico 1 (revision de rama, 2026-08-18): cerrar un viaje escribe
    is_active=false. Sin excluir unassigned_reason_id, ese viaje reaparece en
    el mismo instante en 'abandonado' -grupo de solo lectura, sin casilla,
    sin accion- etiquetado como abandonado por el TMS cuando en realidad lo
    cerro WebCarga. Medido contra produccion: 13 de los 17 viajes de Rezago
    ya superan los 7 dias sin novedad, asi que esto no es un caso raro."""
    from app.services.cierre_viajes import SQL_GRUPOS_CIERRE

    trip_id = await _crear_viaje(
        conexion_revertida, planning_date=FECHA_NEGOCIO - timedelta(days=30),
        is_active=False, is_assigned=False, dias_sin_novedad=10)

    filas = await conexion_revertida.fetch(SQL_GRUPOS_CIERRE, FECHA_NEGOCIO)
    grupo_por_id = {f["trip_id"]: f["grupo"] for f in filas}
    assert grupo_por_id.get(trip_id) == "abandonado", (
        "precondicion: el viaje sintetico tiene que arrancar en abandonado")

    motivo = await conexion_revertida.fetchval(
        "SELECT id FROM app.status_taxonomies WHERE domain='TRIP_UNASSIGNED_REASON' LIMIT 1")
    await conexion_revertida.execute(
        "UPDATE app.trips SET unassigned_reason_id = $1 WHERE id = $2", motivo, trip_id)

    filas = await conexion_revertida.fetch(SQL_GRUPOS_CIERRE, FECHA_NEGOCIO)
    grupo_por_id = {f["trip_id"]: f["grupo"] for f in filas}
    assert trip_id not in grupo_por_id, (
        "un viaje declarado por WebCarga reaparecio como abandonado por el TMS")


async def test_viaje_sin_planning_date_puede_ser_abandonado(conexion_revertida):
    """Bug real: la CTE excluia toda fila con planning_date IS NULL antes de
    que la rama `abandonado` pudiera verla, aunque esa rama no necesita
    fecha. Hoy hay 1 viaje asi en produccion (Sin Registros, sin fecha) — no
    entraba a ningun grupo y nadie se enteraba, que es exactamente lo que
    este servicio existe para evitar."""
    from app.services.cierre_viajes import SQL_GRUPOS_CIERRE

    id_sin_fecha = await _crear_viaje(
        conexion_revertida, planning_date=None,
        is_active=False, is_assigned=False, dias_sin_novedad=10)

    filas = await conexion_revertida.fetch(SQL_GRUPOS_CIERRE, FECHA_NEGOCIO)
    fila = next((f for f in filas if f["trip_id"] == id_sin_fecha), None)

    assert fila is not None, "el viaje sin planning_date no aparecio en ningun grupo"
    assert fila["grupo"] == "abandonado"
    assert fila["planning_date"] is None


async def test_los_viajes_futuros_no_entran(conexion_revertida):
    """Un viaje planificado para manana no es rezago ni espera nada (3 de
    IANSA el 16/08). No hay nada que declarar sobre el."""
    from app.services.cierre_viajes import SQL_GRUPOS_CIERRE

    filas = await conexion_revertida.fetch(SQL_GRUPOS_CIERRE, FECHA_NEGOCIO)
    # planning_date IS NULL es valido para "abandonado" desde la correccion
    # de arriba — no es un viaje futuro, es un viaje sin fecha.
    assert all(
        f["planning_date"] is None or f["planning_date"] <= FECHA_NEGOCIO
        for f in filas)


async def test_el_endpoint_agrupa_y_dice_cuantos_bloquean(conexion_revertida):
    """Solo 'hoy' y 'rezago' bloquean: son cargas que nos ofrecieron y no
    contestamos. 'en_curso' y 'abandonado' se muestran para que no
    desaparezcan (regla 5), pero no impiden cerrar el dia.

    Los datos son sinteticos, creados dentro de esta misma transaccion
    revertida (ver docstring de `conexion_revertida`): el test no puede
    empezar a fallar el dia que operaciones resuelva todos los pendientes
    reales de hoy. Ademas de la clasificacion, verifica la forma de la
    respuesta (tipos, join a status_taxonomies) que el test de servicio no
    cubre porque llama al endpoint, no al SQL crudo."""
    from app.routers.trips import cierre_viajes

    motivo = await conexion_revertida.fetchrow(
        "SELECT id, label FROM app.status_taxonomies "
        "WHERE domain = 'TRIP_UNASSIGNED_REASON' AND code = 'SIN_CAMION'")
    assert motivo is not None, "el motivo SIN_CAMION no existe: revisar el catalogo"

    id_hoy = await _crear_viaje(
        conexion_revertida, planning_date=FECHA_NEGOCIO,
        is_active=True, is_assigned=False)
    await conexion_revertida.execute(
        "UPDATE app.trips SET unassigned_reason_id = $1 WHERE id = $2",
        motivo["id"], id_hoy)
    id_rezago = await _crear_viaje(
        conexion_revertida, planning_date=FECHA_NEGOCIO - timedelta(days=3),
        is_active=True, is_assigned=False)
    id_en_curso = await _crear_viaje(
        conexion_revertida, planning_date=FECHA_NEGOCIO - timedelta(days=3),
        is_active=True, is_assigned=True)
    id_abandonado = await _crear_viaje(
        conexion_revertida, planning_date=FECHA_NEGOCIO - timedelta(days=30),
        is_active=False, is_assigned=False, dias_sin_novedad=10)

    resp = await cierre_viajes(fecha="2026-08-18",
                               pool=PoolDeUnaConexion(conexion_revertida), _=None)

    assert set(resp["grupos"]) == {"hoy", "rezago", "en_curso", "abandonado"}
    assert resp["bloquean"] == len(resp["grupos"]["hoy"]) + len(resp["grupos"]["rezago"])

    grupo_por_id = {
        item["trip_id"]: grupo
        for grupo, items in resp["grupos"].items()
        for item in items
    }
    esperado = {
        id_hoy: "hoy",
        id_rezago: "rezago",
        id_en_curso: "en_curso",
        id_abandonado: "abandonado",
    }
    for trip_id, grupo_esperado in esperado.items():
        assert grupo_por_id.get(str(trip_id)) == grupo_esperado, (
            f"el viaje sintetico de {grupo_esperado} no aterrizo en ese grupo")

    item_hoy = next(v for v in resp["grupos"]["hoy"] if v["trip_id"] == str(id_hoy))
    assert item_hoy["client_name"] == "TEST-CIERRE"
    assert item_hoy["planning_date"] == FECHA_NEGOCIO.isoformat()
    assert isinstance(item_hoy["dias_sin_novedad"], float)
    assert item_hoy["unassigned_reason_id"] == str(motivo["id"])
    assert item_hoy["unassigned_reason_label"] == motivo["label"]

    item_abandonado = next(
        v for v in resp["grupos"]["abandonado"] if v["trip_id"] == str(id_abandonado))
    assert item_abandonado["unassigned_reason_id"] is None
    assert item_abandonado["unassigned_reason_label"] is None


async def test_el_endpoint_no_pierde_el_orden_por_fecha(conexion_revertida):
    """Menor 9 (revision de rama, 2026-08-18): `SQL_GRUPOS_CIERRE` termina en
    `ORDER BY grupo, planning_date DESC`, pero el endpoint envuelve esa CTE
    en un `SELECT ... LEFT JOIN` sin `ORDER BY` propio — Postgres no
    garantiza que el orden del CTE sobreviva a la consulta externa. Dos
    viajes sinteticos en 'rezago' con fechas distintas: el mas reciente
    tiene que aparecer primero."""
    from app.routers.trips import cierre_viajes

    id_viejo = await _crear_viaje(
        conexion_revertida, planning_date=FECHA_NEGOCIO - timedelta(days=10),
        is_active=True, is_assigned=False)
    id_reciente = await _crear_viaje(
        conexion_revertida, planning_date=FECHA_NEGOCIO - timedelta(days=1),
        is_active=True, is_assigned=False)

    resp = await cierre_viajes(fecha="2026-08-18",
                               pool=PoolDeUnaConexion(conexion_revertida), _=None)

    ids_rezago = [v["trip_id"] for v in resp["grupos"]["rezago"]]
    assert ids_rezago.index(str(id_reciente)) < ids_rezago.index(str(id_viejo)), (
        "el mas reciente deberia listarse primero (planning_date DESC)")


async def test_una_fecha_invalida_es_422(conexion_revertida):
    from fastapi import HTTPException
    from app.routers.trips import cierre_viajes

    with pytest.raises(HTTPException) as e:
        await cierre_viajes(fecha="ayer", pool=PoolDeUnaConexion(conexion_revertida), _=None)
    assert e.value.status_code == 422


async def test_cerrar_un_viaje_exige_motivo(conexion_revertida):
    """Sin motivo el cierre no declara nada. "Este es el acusete de
    operaciones" (Pablo): el valor esta en el porque, no en el apagado."""
    from fastapi import HTTPException
    from app.routers.trips import bulk_close_trips
    from app.schemas.trip import TripBulkCloseBody

    conn = conexion_revertida
    trip_id = str(await conn.fetchval("SELECT id FROM app.trips LIMIT 1"))

    with pytest.raises(HTTPException) as e:
        await bulk_close_trips(
            TripBulkCloseBody(trip_ids=[trip_id], unassigned_reason_id=None),
            PoolDeUnaConexion(conn), await _usuario_real(conn))
    assert e.value.status_code == 422


async def test_bulk_close_rechaza_motivo_de_otro_dominio(conexion_revertida):
    """Importante 3: `app.trips.unassigned_reason_id` tiene dos escritores
    con catalogos distintos. GestionPanel.tsx (vivo) escribe ids de
    DRIVER_REASON ("Medico", "Vacaciones", "No se presento"); bulk-close
    solo debe aceptar TRIP_UNASSIGNED_REASON. Sin esta validacion, el filtro
    "No asignado por WebCarga" mostraria viajes cuyo motivo es "Vacaciones"."""
    from fastapi import HTTPException
    from app.routers.trips import bulk_close_trips
    from app.schemas.trip import TripBulkCloseBody

    conn = conexion_revertida
    trip_id = str(await conn.fetchval("SELECT id FROM app.trips LIMIT 1"))
    motivo_driver = await conn.fetchval(
        "SELECT id FROM app.status_taxonomies WHERE domain='DRIVER_REASON' LIMIT 1")
    assert motivo_driver is not None, "precondicion: DRIVER_REASON tiene que tener datos"

    with pytest.raises(HTTPException) as e:
        await bulk_close_trips(
            TripBulkCloseBody(trip_ids=[trip_id], unassigned_reason_id=str(motivo_driver)),
            PoolDeUnaConexion(conn), await _usuario_real(conn))
    assert e.value.status_code == 422

    despues = await conn.fetchrow(
        "SELECT unassigned_reason_id FROM app.trips WHERE id = $1", trip_id)
    assert despues["unassigned_reason_id"] is None, "no debia escribir nada antes de validar"


async def test_bulk_close_motivo_inexistente_es_422_no_500(conexion_revertida):
    """Importante 6: antes de esta correccion, `pool.fetchval()` devolvia
    None para un id inexistente, la nota y el audit_log quedaban con "None",
    y recien despues el UPDATE fallaba por FK con un 500. Tiene que ser un
    422 de negocio ANTES de escribir nada."""
    import uuid

    from fastapi import HTTPException
    from app.routers.trips import bulk_close_trips
    from app.schemas.trip import TripBulkCloseBody

    conn = conexion_revertida
    trip_id = str(await conn.fetchval("SELECT id FROM app.trips LIMIT 1"))
    id_inexistente = str(uuid.uuid4())

    with pytest.raises(HTTPException) as e:
        await bulk_close_trips(
            TripBulkCloseBody(trip_ids=[trip_id], unassigned_reason_id=id_inexistente),
            PoolDeUnaConexion(conn), await _usuario_real(conn))
    assert e.value.status_code == 422

    despues = await conn.fetchrow(
        "SELECT unassigned_reason_id FROM app.trips WHERE id = $1", trip_id)
    assert despues["unassigned_reason_id"] is None, "no debia escribir nada antes de validar"


async def test_el_estado_del_tms_no_se_toca(conexion_revertida):
    """Regla 1 de Pablo. El viaje conserva su ASIGNADO y en el historial se lee
    "No asignado por WebCarga - <motivo>" AL LADO, no encima."""
    from app.routers.trips import bulk_close_trips
    from app.schemas.trip import TripBulkCloseBody

    conn = conexion_revertida
    fila = await conn.fetchrow("SELECT id, trip_status FROM app.trips LIMIT 1")
    motivo = await conn.fetchval(
        "SELECT id FROM app.status_taxonomies WHERE domain='TRIP_UNASSIGNED_REASON' LIMIT 1")

    await bulk_close_trips(
        TripBulkCloseBody(trip_ids=[str(fila["id"])], unassigned_reason_id=str(motivo)),
        PoolDeUnaConexion(conn), await _usuario_real(conn))

    despues = await conn.fetchrow(
        "SELECT trip_status, is_active, unassigned_reason_id, manually_edited_fields "
        "FROM app.trips WHERE id = $1", fila["id"])
    assert despues["trip_status"] == fila["trip_status"], "se piso el estado del TMS"
    assert despues["is_active"] is False
    assert str(despues["unassigned_reason_id"]) == str(motivo)
    # Menor 7 (revision de rama, 2026-08-18): el comentario original decia
    # que sin esto "la proxima corrida de dbt borra el motivo" — es falso.
    # El trigger app.protect_manual_overrides solo mira is_active, is_working,
    # is_assigned, manual_status, is_first_leg (no unassigned_reason_id); la
    # proteccion real viene de merge_exclude_columns en el modelo dbt, que ya
    # incluye la columna (ver docs/superpowers/specs/2026-08-16-cierre-de-viajes-design.md:394).
    # Este assert sigue siendo correcto -bulk_close_trips debe marcar el campo
    # en manually_edited_fields, consistente con is_active/is_working- solo
    # que por otra razon: documentar la edicion manual, no protegerla del trigger.
    assert "unassigned_reason_id" in despues["manually_edited_fields"], \
        "bulk_close_trips deberia marcar unassigned_reason_id como editado a mano"


async def test_la_declaracion_queda_en_audit_log(conexion_revertida):
    """Spec §6.3: una declaracion de negocio que se cruza con facturacion no
    puede depender solo de la bitacora best-effort (`_log_system_note` se
    traga errores con `except: pass`). Tiene que quedar tambien en
    public.audit_log, vía `log_change`."""
    from app.routers.trips import bulk_close_trips
    from app.schemas.trip import TripBulkCloseBody

    conn = conexion_revertida
    trip_id = await conn.fetchval("SELECT id FROM app.trips LIMIT 1")
    motivo_fila = await conn.fetchrow(
        "SELECT id, label FROM app.status_taxonomies "
        "WHERE domain='TRIP_UNASSIGNED_REASON' LIMIT 1")

    await bulk_close_trips(
        TripBulkCloseBody(trip_ids=[str(trip_id)], unassigned_reason_id=str(motivo_fila["id"])),
        PoolDeUnaConexion(conn), await _usuario_real(conn))

    fila_auditoria = await conn.fetchrow(
        "SELECT entity_type, entity_id, action, field, new_value FROM public.audit_log "
        "WHERE entity_type = 'TRIP' AND entity_id = $1::uuid "
        "ORDER BY occurred_at DESC LIMIT 1", str(trip_id))
    assert fila_auditoria is not None, "la declaracion no quedo en audit_log"
    assert fila_auditoria["action"] == "no_asignado_por_webcarga"
    assert fila_auditoria["field"] == "unassigned_reason_id"


async def test_el_lote_no_queda_a_medias_si_audit_log_falla(conexion_revertida, monkeypatch):
    """El UPDATE es atomico para todo el lote, pero antes de esta correccion
    el loop que llama a log_change y _log_system_note corria FUERA de esa
    transaccion (N adquisiciones independientes del pool): si fallaba a
    mitad, quedaban viajes con is_active=false y motivo escrito pero sin
    traza en audit_log, el request devolvia 500 y el reintento duplicaba
    notas para los que ya habian pasado.

    Se fuerza el fallo con un monkeypatch sobre log_change (el segundo viaje
    del lote revienta) y se verifica que NINGUN viaje del lote quedo
    modificado: UPDATE y audit_log tienen que cumplirse los dos o ninguno."""
    from app.routers import trips as trips_router
    from app.routers.trips import bulk_close_trips
    from app.schemas.trip import TripBulkCloseBody

    conn = conexion_revertida
    id_1 = await _crear_viaje(
        conn, planning_date=FECHA_NEGOCIO, is_active=True, is_assigned=False)
    id_2 = await _crear_viaje(
        conn, planning_date=FECHA_NEGOCIO, is_active=True, is_assigned=False)
    trip_ids = [str(id_1), str(id_2)]
    motivo_id = await conn.fetchval(
        "SELECT id FROM app.status_taxonomies WHERE domain='TRIP_UNASSIGNED_REASON' LIMIT 1")

    original_log_change = trips_router.log_change
    llamadas = {"n": 0}

    async def log_change_que_revienta_en_el_segundo(*args, **kwargs):
        llamadas["n"] += 1
        if llamadas["n"] == 2:
            raise RuntimeError("fallo simulado en log_change")
        return await original_log_change(*args, **kwargs)

    monkeypatch.setattr(trips_router, "log_change", log_change_que_revienta_en_el_segundo)

    with pytest.raises(RuntimeError):
        await bulk_close_trips(
            TripBulkCloseBody(trip_ids=trip_ids, unassigned_reason_id=str(motivo_id)),
            PoolDeUnaConexion(conn), await _usuario_real(conn))

    assert llamadas["n"] == 2, "el fallo no ocurrio donde el test lo esperaba"

    filas = await conn.fetch(
        "SELECT id, is_active, unassigned_reason_id FROM app.trips WHERE id = ANY($1::uuid[])",
        trip_ids)
    assert len(filas) == 2
    for fila in filas:
        assert fila["is_active"] is True, (
            "el lote quedo a medias: el UPDATE no se revirtio pese a que "
            "log_change fallo para uno de los viajes")
        assert fila["unassigned_reason_id"] is None

    auditoria = await conn.fetch(
        "SELECT entity_id FROM public.audit_log WHERE entity_id = ANY($1::uuid[])", trip_ids)
    assert auditoria == [], "quedo una fila de audit_log de un lote que se tenia que revertir"


# ── Task 5 (plan 2026-08-18-cierre-paso-viajes): el conteo al firmar, y el
# delta posterior al cierre. El dia NO se reabre: la firma sigue siendo
# verdadera sobre lo que existia cuando se firmo, y lo que llega despues
# (fecha retroactiva del TMS) se resuelve como un complemento aparte. ──────

async def test_el_cierre_guarda_cuantos_viajes_tenia_el_dia(conexion_revertida):
    """Sin este numero no hay con que comparar despues, y no se puede
    reconstruir: es el unico dato que fija que afirmo la firma."""
    filas = await conexion_revertida.fetch(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema='app' AND table_name='daily_closures'")
    assert "total_trips" in {f["column_name"] for f in filas}


async def test_un_dia_sin_firmar_no_reporta_delta(conexion_revertida):
    """Nada que comparar todavia: `posteriores_al_cierre` tiene que ser 0, no
    el total de viajes del dia."""
    from app.routers.daily_closures import get_daily_closure_status

    resp = await get_daily_closure_status(
        fecha="2026-08-18", pool=PoolDeUnaConexion(conexion_revertida), _=None)
    assert resp["cierre"]["total_trips_al_firmar"] is None
    assert resp["cierre"]["posteriores_al_cierre"] == 0


async def test_los_viajes_posteriores_al_cierre_se_cuentan_como_delta(conexion_revertida):
    """El caso real: el sistema del cliente crea viajes con fecha retroactiva
    ("los crean el dieciseis, pero con fechas del catorce"). El dia sigue
    cerrado -la firma no se invalida-, pero el conteo posterior tiene que
    reflejar cuantos viajes llegaron despues de la firma."""
    from app.routers.daily_closures import get_daily_closure_status

    fecha_cierre = date(2099, 1, 1)
    await _crear_viaje(conexion_revertida, planning_date=fecha_cierre, is_active=True, is_assigned=True)
    await _crear_viaje(conexion_revertida, planning_date=fecha_cierre, is_active=True, is_assigned=True)

    await conexion_revertida.execute(
        "INSERT INTO app.daily_closures "
        "(business_date, closed_by, total_drivers, resolved_count, override_count, total_trips) "
        "VALUES ($1, $2, 0, 0, 0, $3)",
        fecha_cierre, uuid.uuid4(), 2)

    # Llega un viaje despues de firmar (fecha retroactiva del TMS).
    await _crear_viaje(conexion_revertida, planning_date=fecha_cierre, is_active=True, is_assigned=True)

    resp = await get_daily_closure_status(
        fecha=fecha_cierre.isoformat(), pool=PoolDeUnaConexion(conexion_revertida), _=None)

    assert resp["cierre"]["total_trips_al_firmar"] == 2
    assert resp["cierre"]["posteriores_al_cierre"] == 1


# ── Task 8 (plan 2026-08-18-cierre-paso-viajes): volver a LEER la
# declaracion. Pablo: "yo despues filtrare en el historial todos los no
# asignados por WebCarga y voy a poder ver todos los viajes que alguna vez
# nos ofrecieron y no asignamos". Sin este filtro el dato se escribe y no
# se puede leer, que es la mitad del punto. ──────────────────────────────

async def test_se_puede_filtrar_lo_no_asignado_por_webcarga(conexion_revertida):
    # Pablo: "voy a poder ver todos los viajes que alguna vez nos ofrecieron y
    # no asignamos". Sin este filtro la declaracion se escribe y no se lee.
    from app.routers.trips import list_trips

    conn = conexion_revertida
    motivo = await conn.fetchval(
        "SELECT id FROM app.status_taxonomies WHERE domain='TRIP_UNASSIGNED_REASON' LIMIT 1")
    trip_id = await conn.fetchval("SELECT id FROM app.trips LIMIT 1")
    await conn.execute(
        "UPDATE app.trips SET unassigned_reason_id = $1 WHERE id = $2", motivo, trip_id)

    resp = await list_trips(no_asignado_webcarga=True,
                            pool=PoolDeUnaConexion(conn), _=None)

    ids = [str(t["id"]) for t in resp["data"]]
    assert str(trip_id) in ids
    assert all(t["unassigned_reason_id"] for t in resp["data"]), \
        "el filtro dejo pasar viajes sin motivo"


async def test_el_filtro_no_mira_is_active(conexion_revertida):
    """El punto es el HISTORIAL: viajes que nos ofrecieron y no asignamos,
    incluidos los que ya se apagaron hace meses. Filtrar por activos
    vaciaria la respuesta justo de lo que se quiere ver."""
    from app.routers.trips import list_trips

    conn = conexion_revertida
    motivo = await conn.fetchval(
        "SELECT id FROM app.status_taxonomies WHERE domain='TRIP_UNASSIGNED_REASON' LIMIT 1")
    id_apagado_hace_meses = await _crear_viaje(
        conn, planning_date=FECHA_NEGOCIO - timedelta(days=180),
        is_active=False, is_assigned=False)
    await conn.execute(
        "UPDATE app.trips SET unassigned_reason_id = $1 WHERE id = $2",
        motivo, id_apagado_hace_meses)

    resp = await list_trips(no_asignado_webcarga=True,
                            pool=PoolDeUnaConexion(conn), _=None)

    ids = [str(t["id"]) for t in resp["data"]]
    assert str(id_apagado_hace_meses) in ids, \
        "el filtro miro is_active y se comio un viaje apagado del historial"
