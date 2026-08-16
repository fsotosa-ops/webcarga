"""Tramo 3 de Certificación, ejercitado contra Postgres de verdad.

QUÉ HACE DISTINTO ESTE ARCHIVO. El resto de la suite mockea el pool con
`AsyncMock`: el mock nunca contradice al SQL, así que un test verde sólo
prueba que el texto de la consulta es el esperado, no que Postgres la acepte
ni que devuelva lo que creemos. Los tests del Tramo 3 quedaron todos de ese
lado, y lo crítico —el predicado D13, la definición del tipo de gestión, la
coincidencia entre los triggers de siembra y el servicio Python— se verificó a
mano, una vez, con evidencia fechada que nadie vuelve a correr. Acá se ejecuta.

CÓMO SE PROTEGE LA BASE. Es la única base que hay, o sea producción. Cada
test recibe la fixture `conexion_revertida`: una conexión ya adentro de una
transacción que el fixture revierte en un `finally`. El test no ve la
transacción y no puede confirmarla. Los datos son sintéticos y los crea el
propio test adentro de esa transacción — nunca se busca una fila real por su
id, porque eso ata el test al dato de producción del día que se escribió.

CÓMO CORRERLOS.
    venv/bin/python -m pytest tests/ -q                       # todo
    venv/bin/python -m pytest tests/ -q -m integracion -rs    # sólo estos
    venv/bin/python -m pytest tests/ -q -m "not integracion"  # sin tocar la base

Sin credenciales o sin red se saltean solos, y la cabecera de la corrida lo
dice (`pytest_report_header` en tests/conftest.py).
"""
from __future__ import annotations

import re
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

import pytest

from app.routers.requirements import recalc
from app.services.requirement_conditions import (
    SQL_ENTIDADES_QUE_APLICAN,
    calcular_diferencias,
)
from tests.conftest import USER

pytestmark = pytest.mark.integracion

# Todo lo que este archivo inserta lleva esta marca en su nombre. No es la
# forma de limpiar —de eso se encarga el ROLLBACK— sino la forma de RECONOCER
# una fuga si alguna vez la hubiera.
PREFIJO = "ZZ-TEST-INTEGRACION"


# ── Andamiaje ─────────────────────────────────────────────────────────────


class PoolDeUnaConexion:
    """Presenta la conexión del fixture como si fuera el pool de asyncpg.

    El código de producción hace `async with pool.acquire() as conn` y adentro
    abre su propia transacción. Sobre una conexión que YA está en transacción,
    asyncpg resuelve ese `conn.transaction()` como un SAVEPOINT: el trabajo
    sigue colgando de la transacción externa y se va entero con el ROLLBACK
    del fixture. Es lo que permite ejecutar el servicio y el endpoint reales
    sin que puedan escribir en firme."""

    def __init__(self, conn):
        self._conn = conn

    def acquire(self):
        conn = self._conn

        @asynccontextmanager
        async def _prestada():
            yield conn

        return _prestada()


def _sufijo() -> str:
    return uuid4().hex[:10]


async def _taxonomia(conn, dominio: str, etiqueta: str):
    """Una fila de catálogo sintética. Sirve para que los requisitos de prueba
    no matcheen ni un solo vehículo real: nadie tiene este tipo."""
    return await conn.fetchval(
        "INSERT INTO app.status_taxonomies (domain, label, bg_color, text_color, active) "
        "VALUES ($1, $2, '#eeeeee', '#111111', true) RETURNING id",
        dominio, etiqueta,
    )


async def _id_taxonomia_por_etiqueta(conn, etiqueta: str):
    """El id de un tipo de operación buscado por su ETIQUETA, no hardcodeado.

    `public.carrier_management_types()` mapea la etiqueta del catálogo al
    código (`'Tractoreo'` -> `'TRACTOREO'`), así que la etiqueta es parte del
    contrato: si alguien renombra la fila —pasó dos veces en dos días— la
    función deja de derivar la gestión de la flota en silencio y estos tests
    tienen que ser los que griten."""
    fila = await conn.fetchval(
        "SELECT id FROM app.status_taxonomies "
        "WHERE domain = 'WEBCARGA_OPERATION_TYPE' AND label = $1",
        etiqueta,
    )
    assert fila is not None, (
        f"no existe la etiqueta '{etiqueta}' en WEBCARGA_OPERATION_TYPE: "
        "public.carrier_management_types() la mapea por texto, asi que "
        "renombrarla deja de derivar el tipo de gestion de la flota"
    )
    return fila


async def _empresa(conn, *, gestion_declarada=None):
    suf = _sufijo()
    return await conn.fetchval(
        "INSERT INTO public.carriers (business_name, tax_id, management_types) "
        "VALUES ($1, $2, $3) RETURNING id",
        f"{PREFIJO} {suf}", f"{PREFIJO}-{suf}", gestion_declarada,
    )


async def _vehiculo(conn, *, tipo_flota=None, tipo_operacion=None):
    suf = _sufijo()
    return await conn.fetchval(
        "INSERT INTO public.assets "
        "(license_plate, asset_type, fleet_service_type_id, webcarga_operation_type_id) "
        "VALUES ($1, 'TRACTOCAMION', $2, $3) RETURNING id",
        f"ZZ{suf[:6].upper()}", tipo_flota, tipo_operacion,
    )


async def _asignar(conn, vehiculo, empresa, estado="ACTIVE"):
    await conn.execute(
        "INSERT INTO public.asset_assignments (asset_id, carrier_id, status) "
        "VALUES ($1, $2, $3)",
        vehiculo, empresa, estado,
    )


async def _cliente(conn):
    return await conn.fetchval(
        "INSERT INTO public.shippers (name) VALUES ($1) RETURNING id",
        f"{PREFIJO} {_sufijo()}",
    )


async def _requisito(conn, *, entidad, gestion=None, tipos_flota=None, cliente=None):
    """Un requisito nuevo. Al insertarlo dispara `reconcile_new_requirement()`:
    esa siembra es justamente lo que varios de estos tests miden."""
    return await conn.fetchval(
        """
        INSERT INTO public.compliance_requirements
            (target_entity, requirement_code, name, requirement_level,
             shipper_id, applies_to_management_types, applies_to_fleet_service_type_ids)
        VALUES ($1, $2, $3, 'LEGAL_MANDATORY', $4, $5, $6)
        RETURNING id
        """,
        entidad, f"ZZ_{_sufijo().upper()}", f"{PREFIJO} requisito",
        cliente, gestion, tipos_flota,
    )


async def _registro(conn, requisito, entidad_id):
    return await conn.fetchrow(
        "SELECT * FROM public.compliance_records "
        "WHERE requirement_id = $1 AND entity_id = $2",
        requisito, entidad_id,
    )


async def _sembrados(conn, requisito) -> set[str]:
    filas = await conn.fetch(
        "SELECT entity_id::text AS id FROM public.compliance_records "
        "WHERE requirement_id = $1 AND is_current",
        requisito,
    )
    return {f["id"] for f in filas}


async def _aplican_segun_el_servicio(conn, entidad: str, requisito) -> set[str]:
    """El MISMO SQL que usa la vista previa, ejecutado contra Postgres."""
    filas = await conn.fetch(
        f"SELECT id::text AS id FROM ({SQL_ENTIDADES_QUE_APLICAN[entidad]}) AS aplican",
        requisito,
    )
    return {f["id"] for f in filas}


# ── 1. El predicado D13 ───────────────────────────────────────────────────
#
# La regla de seguridad del tramo: el recálculo nunca apaga un registro que
# tenga archivo, edición manual, o un estado distinto de MISSING. Apagarlo lo
# saca de todas las pantallas (todas filtran is_current), que para quien mira
# es lo mismo que haber perdido el documento.


async def _universo_d13(conn):
    """Cinco vehículos con un requisito que ya no les corresponde, uno por
    cada casuística del predicado. Devuelve (requisito, {caso: id_registro})."""
    tipo_viejo = await _taxonomia(conn, "FLEET_SERVICE_TYPE", f"{PREFIJO} viejo")
    tipo_nuevo = await _taxonomia(conn, "FLEET_SERVICE_TYPE", f"{PREFIJO} nuevo")

    # Nace exigiendo el tipo viejo: ningún vehículo real lo tiene, así que la
    # siembra automática no toca nada de producción.
    requisito = await _requisito(conn, entidad="ASSET", tipos_flota=[tipo_viejo])

    vehiculos = {caso: await _vehiculo(conn, tipo_flota=tipo_viejo)
                 for caso in ("limpio", "con_archivo", "con_override",
                              "con_estado", "sin_estado")}

    # Cada vehículo nuevo ya trae su registro MISSING (trg_reconcile_new_asset).
    await conn.execute(
        "UPDATE public.compliance_records SET file_url = 'https://ejemplo.invalido/zz.pdf' "
        "WHERE requirement_id = $1 AND entity_id = $2",
        requisito, vehiculos["con_archivo"])
    await conn.execute(
        "UPDATE public.compliance_records SET is_manual_override = true "
        "WHERE requirement_id = $1 AND entity_id = $2",
        requisito, vehiculos["con_override"])
    await conn.execute(
        "UPDATE public.compliance_records SET status = 'APPROVED' "
        "WHERE requirement_id = $1 AND entity_id = $2",
        requisito, vehiculos["con_estado"])
    # status es NULLABLE. `IS DISTINCT FROM 'MISSING'` lo deja del lado
    # bloqueado; un `<> 'MISSING'` daría NULL y lo dejaría del lado que se
    # apaga. Es exactamente la diferencia que el test de texto no podía ver.
    await conn.execute(
        "UPDATE public.compliance_records SET status = NULL "
        "WHERE requirement_id = $1 AND entity_id = $2",
        requisito, vehiculos["sin_estado"])

    # Y ahora la regla cambia: el requisito pasa a exigirse a otro tipo. Los
    # cinco dejan de corresponder.
    await conn.execute(
        "UPDATE public.compliance_requirements "
        "SET applies_to_fleet_service_type_ids = $2 WHERE id = $1",
        requisito, [tipo_nuevo])

    registros = {}
    for caso, vehiculo in vehiculos.items():
        registros[caso] = str((await _registro(conn, requisito, vehiculo))["id"])
    return requisito, registros


async def test_d13_solo_se_apaga_el_registro_sin_nada_que_perder(conexion_revertida):
    """Los cuatro que tienen algo que perder quedan bloqueados; el que está
    vacío es el único que se puede apagar.

    Esto ejecuta el SQL, no lo lee: si el OR se vuelve AND, si a un término le
    aparece un NOT, o si `IS DISTINCT FROM` se degrada a `<>`, el reparto
    cambia y el test muere."""
    conn = conexion_revertida
    requisito, registros = await _universo_d13(conn)

    diferencias = await calcular_diferencias(PoolDeUnaConexion(conn), str(requisito))

    assert diferencias["target_entity"] == "ASSET"
    assert diferencias["crear"] == [], (
        "ningun vehiculo tiene el tipo nuevo: no hay nada que sembrar"
    )
    assert set(diferencias["quitar"]) == {registros["limpio"]}
    assert set(diferencias["bloqueados"]) == {
        registros["con_archivo"], registros["con_override"],
        registros["con_estado"], registros["sin_estado"],
    }


async def test_el_recalculo_apaga_solo_lo_que_la_vista_previa_prometio(conexion_revertida):
    """El endpoint completo, contra la base. Su UPDATE revalida D13 con el
    predicado espejo (`IS NOT DISTINCT FROM`), porque la vista previa se
    calculó fuera de su transacción. Los dos lados tienen que tratar igual al
    NULL: si no, la pantalla promete un apagado que el UPDATE no hace.

    Además comprueba lo que hace el apagado: `is_current = false` y NADA más.
    El documento, el estado y la vigencia siguen ahí — apagar dejó de ser
    destruir."""
    conn = conexion_revertida
    requisito, registros = await _universo_d13(conn)
    antes = {caso: dict(await conn.fetchrow(
        "SELECT * FROM public.compliance_records WHERE id = $1::uuid", ident))
        for caso, ident in registros.items()}

    resultado = await recalc(str(requisito), pool=PoolDeUnaConexion(conn), user=USER)

    assert resultado == {"creados": 0, "quitados": 1, "bloqueados": 4}

    apagado = await conn.fetchrow(
        "SELECT is_current FROM public.compliance_records WHERE id = $1::uuid",
        registros["limpio"])
    assert apagado["is_current"] is False

    for caso in ("con_archivo", "con_override", "con_estado", "sin_estado"):
        ahora = dict(await conn.fetchrow(
            "SELECT * FROM public.compliance_records WHERE id = $1::uuid",
            registros[caso]))
        assert ahora["is_current"] is True, f"{caso} se apago pese a estar bloqueado"
        assert ahora == antes[caso], f"{caso} cambio en algun campo"


async def test_el_recalculo_revalida_d13_aunque_la_vista_previa_venga_mentida(
    conexion_revertida, monkeypatch,
):
    """La vista previa se calcula FUERA de la transacción del apagado, así que
    entre una y otro alguien puede haber subido un archivo. El UPDATE no
    confía en los ids que le pasaron: vuelve a comprobar D13.

    Acá se le miente al endpoint a propósito —se le entrega una vista previa
    que manda apagar los cinco registros, bloqueados incluidos— y se comprueba
    que apaga uno solo. Sin esta prueba, sacarle cualquiera de los tres
    términos al WHERE del UPDATE pasa inadvertido: en una corrida normal la
    vista previa nunca le pasa un bloqueado."""
    conn = conexion_revertida
    requisito, registros = await _universo_d13(conn)
    intactos = {caso: dict(await conn.fetchrow(
        "SELECT * FROM public.compliance_records WHERE id = $1::uuid", ident))
        for caso, ident in registros.items() if caso != "limpio"}

    async def _vista_previa_mentida(pool, requirement_id):
        return {"crear": [], "quitar": list(registros.values()),
                "bloqueados": [], "target_entity": "ASSET"}

    monkeypatch.setattr(
        "app.routers.requirements.calcular_diferencias", _vista_previa_mentida)

    resultado = await recalc(str(requisito), pool=PoolDeUnaConexion(conn), user=USER)

    assert resultado["quitados"] == 1, (
        "el UPDATE apago registros que D13 protege: dejo de revalidar"
    )
    for caso, fila in intactos.items():
        ahora = dict(await conn.fetchrow(
            "SELECT * FROM public.compliance_records WHERE id = $1::uuid",
            registros[caso]))
        assert ahora == fila, f"{caso} se toco pese a estar bloqueado por D13"


# ── 2. public.carrier_management_types() ──────────────────────────────────
#
# La definición única del tipo de gestión: la flota manda cuando existe, lo
# declarado cubre el hueco. Los tests que ya existían fijan el TEXTO de la
# función; vaciarle el cuerpo los deja a todos en verde. Estos la EJECUTAN.


async def test_la_gestion_sale_de_la_flota_cuando_la_empresa_tiene_flota(conexion_revertida):
    conn = conexion_revertida
    tractoreo = await _id_taxonomia_por_etiqueta(conn, "Tractoreo")
    empresa = await _empresa(conn, gestion_declarada=None)
    await _asignar(conn, await _vehiculo(conn, tipo_operacion=tractoreo), empresa)

    assert await conn.fetchval(
        "SELECT public.carrier_management_types($1)", empresa) == ["TRACTOREO"]


async def test_la_gestion_declarada_cubre_el_hueco_cuando_no_hay_flota(conexion_revertida):
    """Una empresa recién creada todavía no tiene vehículos: lo declarado en
    el alta es el único dato que existe en ese momento."""
    conn = conexion_revertida
    empresa = await _empresa(conn, gestion_declarada=["EQUIPO_COMPLETO"])

    assert await conn.fetchval(
        "SELECT public.carrier_management_types($1)", empresa) == ["EQUIPO_COMPLETO"]


async def test_con_las_dos_manda_la_flota(conexion_revertida):
    """El COALESCE en su orden: la flota primero. Si alguien lo invierte, esta
    empresa pasa a declarar EQUIPO_COMPLETO teniendo una flota de tractoreo."""
    conn = conexion_revertida
    tractoreo = await _id_taxonomia_por_etiqueta(conn, "Tractoreo")
    empresa = await _empresa(conn, gestion_declarada=["EQUIPO_COMPLETO"])
    await _asignar(conn, await _vehiculo(conn, tipo_operacion=tractoreo), empresa)

    assert await conn.fetchval(
        "SELECT public.carrier_management_types($1)", empresa) == ["TRACTOREO"]


async def test_sin_flota_y_sin_declarar_no_hay_gestion(conexion_revertida):
    """NULL, no un arreglo vacío: `NULL && ARRAY['TRACTOREO']` da NULL y el
    WHERE lo trata como falso, que es lo correcto — una empresa sin gestión
    conocida no entra en una condición de gestión."""
    conn = conexion_revertida
    empresa = await _empresa(conn)

    assert await conn.fetchval(
        "SELECT public.carrier_management_types($1)", empresa) is None


async def test_un_vehiculo_desasignado_no_define_la_gestion(conexion_revertida):
    """Sólo cuenta la flota ACTIVE. Si el filtro se cae, una empresa arrastra
    para siempre el tipo de gestión de un vehículo que ya no maneja."""
    conn = conexion_revertida
    tractoreo = await _id_taxonomia_por_etiqueta(conn, "Tractoreo")
    empresa = await _empresa(conn)
    await _asignar(conn, await _vehiculo(conn, tipo_operacion=tractoreo),
                   empresa, estado="INACTIVE")

    assert await conn.fetchval(
        "SELECT public.carrier_management_types($1)", empresa) is None


# ── 3. La regresión del vínculo empresa-cliente ───────────────────────────


async def test_reactivar_un_vinculo_reenciende_el_registro_sin_perder_el_documento(
    conexion_revertida,
):
    """Desactivar un vínculo empresa-cliente apaga sus registros; reactivarlo
    los tiene que volver a encender.

    Antes del `ON CONFLICT` esto reventaba con `23505 duplicate key`: el
    índice único (entity_id, requirement_id) es TOTAL, así que la fila apagada
    sigue ocupando el lugar y el `NOT EXISTS (... AND is_current)` no la ve.
    Volver a exigir el documento era imposible sin tocar la base a mano.

    Lo que se reenciende es SÓLO el interruptor: el trigger que apaga no mira
    D13 (sólo respeta is_manual_override), así que un registro apagado puede
    tener documento cargado y resucitarlo pisándoselo sería destruir trabajo
    real."""
    conn = conexion_revertida
    cliente = await _cliente(conn)
    empresa = await _empresa(conn)
    vinculo = await conn.fetchval(
        "INSERT INTO public.carrier_shippers (carrier_id, shipper_id, status) "
        "VALUES ($1, $2, 'ACTIVE') RETURNING id",
        empresa, cliente)
    requisito = await _requisito(conn, entidad="CARRIER", cliente=cliente)

    # El requisito nace después del vínculo, así que lo siembra
    # reconcile_new_requirement() por su rama de cliente puntual.
    original = await _registro(conn, requisito, empresa)
    assert original is not None and original["is_current"] is True

    # Alguien carga el documento.
    await conn.execute(
        "UPDATE public.compliance_records SET file_url = 'https://ejemplo.invalido/zz.pdf', "
        "status = 'APPROVED', expiration_date = DATE '2030-01-01' WHERE id = $1",
        original["id"])
    cargado = dict(await conn.fetchrow(
        "SELECT * FROM public.compliance_records WHERE id = $1", original["id"]))

    # Se desactiva el vínculo: el registro se apaga aunque tenga documento.
    await conn.execute(
        "UPDATE public.carrier_shippers SET status = 'INACTIVE' WHERE id = $1", vinculo)
    apagado = dict(await conn.fetchrow(
        "SELECT * FROM public.compliance_records WHERE id = $1", original["id"]))
    assert apagado["is_current"] is False
    assert apagado["file_url"] == cargado["file_url"], (
        "apagar no debe tocar el documento"
    )

    # Y se vuelve a activar. Acá es donde antes saltaba el 23505.
    await conn.execute(
        "UPDATE public.carrier_shippers SET status = 'ACTIVE' WHERE id = $1", vinculo)

    resucitado = dict(await conn.fetchrow(
        "SELECT * FROM public.compliance_records WHERE id = $1", original["id"]))
    assert resucitado["is_current"] is True, "el registro no se volvio a encender"
    assert resucitado == {**apagado, "is_current": True}, (
        "reencender toco algo mas que el interruptor: el documento, el estado, "
        "la vigencia y updated_at se conservan"
    )
    assert await conn.fetchval(
        "SELECT count(*) FROM public.compliance_records "
        "WHERE requirement_id = $1 AND entity_id = $2", requisito, empresa) == 1, (
        "se creo una fila nueva en vez de reencender la que ya estaba"
    )


# ── 4. El invariante del tramo: siembra y vista previa dicen lo mismo ─────
#
# Las cinco funciones de siembra deciden a quién se le exige un requisito al
# nacer; `SQL_ENTIDADES_QUE_APLICAN` decide lo mismo al recalcular. Son dos
# textos distintos para una sola regla. Si divergen, la vista previa miente
# sobre lo que "Aplicar" va a hacer — y "Aplicar" apaga en firme.
#
# La comparación se hace sobre el UNIVERSO COMPLETO (las 248 empresas reales
# más las sintéticas que cubren las cuatro casuísticas de gestión), no sobre
# un puñado de filas elegidas: es la única forma de que una divergencia de
# borde aparezca.


async def _universo_de_gestion(conn):
    """Cuatro empresas, una por casuística del tipo de gestión."""
    tractoreo = await _id_taxonomia_por_etiqueta(conn, "Tractoreo")
    completo = await _id_taxonomia_por_etiqueta(conn, "Equipo Completo")
    empresas = {
        "flota_tractoreo": await _empresa(conn),
        "declarada_completo": await _empresa(conn, gestion_declarada=["EQUIPO_COMPLETO"]),
        "flota_manda": await _empresa(conn, gestion_declarada=["EQUIPO_COMPLETO"]),
        "sin_gestion": await _empresa(conn),
    }
    await _asignar(conn, await _vehiculo(conn, tipo_operacion=tractoreo),
                   empresas["flota_tractoreo"])
    await _asignar(conn, await _vehiculo(conn, tipo_operacion=completo),
                   empresas["flota_manda"])
    return empresas


@pytest.mark.parametrize("gestion", [None, ["TRACTOREO"], ["EQUIPO_COMPLETO"],
                                     ["TRACTOREO", "EQUIPO_COMPLETO"]])
async def test_siembra_y_vista_previa_coinciden_para_empresas(conexion_revertida, gestion):
    """`reconcile_new_requirement()` rama CARRIER general vs. el servicio."""
    conn = conexion_revertida
    await _universo_de_gestion(conn)

    requisito = await _requisito(conn, entidad="CARRIER", gestion=gestion)

    sembrados = await _sembrados(conn, requisito)
    aplican = await _aplican_segun_el_servicio(conn, "CARRIER", requisito)
    assert sembrados == aplican, (
        "el trigger sembro un conjunto de empresas distinto del que la vista "
        "previa considera aplicables: la pantalla miente sobre lo que hace "
        "Aplicar"
    )
    assert sembrados, "el universo de prueba quedo vacio: la comparacion no probaria nada"


@pytest.mark.parametrize("gestion", [None, ["TRACTOREO"], ["EQUIPO_COMPLETO"]])
async def test_siembra_y_vista_previa_coinciden_para_requisitos_de_un_cliente(
    conexion_revertida, gestion,
):
    """La rama de cliente puntual, que es la que faltaba en el servicio y hacía
    que recalcular un requisito de cliente propusiera borrar TODOS sus
    registros legítimos.

    Se vinculan al cliente sintético empresas de las cuatro casuísticas, más
    una con el vínculo INACTIVE que no tiene que entrar por ningún lado."""
    conn = conexion_revertida
    cliente = await _cliente(conn)
    empresas = await _universo_de_gestion(conn)
    for empresa in empresas.values():
        await conn.execute(
            "INSERT INTO public.carrier_shippers (carrier_id, shipper_id, status) "
            "VALUES ($1, $2, 'ACTIVE')", empresa, cliente)
    desvinculada = await _empresa(conn, gestion_declarada=["TRACTOREO"])
    await conn.execute(
        "INSERT INTO public.carrier_shippers (carrier_id, shipper_id, status) "
        "VALUES ($1, $2, 'INACTIVE')", desvinculada, cliente)

    requisito = await _requisito(conn, entidad="CARRIER", cliente=cliente, gestion=gestion)

    sembrados = await _sembrados(conn, requisito)
    aplican = await _aplican_segun_el_servicio(conn, "CARRIER", requisito)
    assert sembrados == aplican
    assert str(desvinculada) not in aplican, (
        "una empresa con el vinculo INACTIVE entro igual"
    )
    assert sembrados


async def test_siembra_y_vista_previa_coinciden_para_vehiculos(conexion_revertida):
    """`reconcile_new_requirement()` rama ASSET vs. el servicio, con y sin
    condición de subtipo de flota."""
    conn = conexion_revertida
    tipo = await _taxonomia(conn, "FLEET_SERVICE_TYPE", f"{PREFIJO} subtipo")
    con_tipo = await _vehiculo(conn, tipo_flota=tipo)
    sin_tipo = await _vehiculo(conn)

    acotado = await _requisito(conn, entidad="ASSET", tipos_flota=[tipo])
    assert await _sembrados(conn, acotado) == await _aplican_segun_el_servicio(
        conn, "ASSET", acotado) == {str(con_tipo)}

    general = await _requisito(conn, entidad="ASSET")
    sembrados = await _sembrados(conn, general)
    assert sembrados == await _aplican_segun_el_servicio(conn, "ASSET", general)
    assert {str(con_tipo), str(sin_tipo)} <= sembrados


async def test_siembra_y_vista_previa_coinciden_para_conductores(conexion_revertida):
    """Un conductor no tiene subtipo ni gestión propios: el requisito le
    aplica a todos. Vale igual comprobarlo — es la rama que nadie mira."""
    conn = conexion_revertida
    conductor = await conn.fetchval(
        "INSERT INTO public.drivers (full_name, tax_id) VALUES ($1, $2) RETURNING id",
        f"{PREFIJO} {_sufijo()}", f"{PREFIJO}-{_sufijo()}")

    requisito = await _requisito(conn, entidad="DRIVER")

    sembrados = await _sembrados(conn, requisito)
    assert sembrados == await _aplican_segun_el_servicio(conn, "DRIVER", requisito)
    assert str(conductor) in sembrados


async def test_un_requisito_apagado_no_le_aplica_a_nadie(conexion_revertida):
    """`is_active` es la puerta de las tres ramas. Con el requisito apagado, la
    vista previa tiene que dar cero aplicables — y por lo tanto proponer apagar
    todo lo que hoy está vigente, no lo contrario."""
    conn = conexion_revertida
    tipo = await _taxonomia(conn, "FLEET_SERVICE_TYPE", f"{PREFIJO} subtipo")
    vehiculo = await _vehiculo(conn, tipo_flota=tipo)
    requisito = await _requisito(conn, entidad="ASSET", tipos_flota=[tipo])
    assert await _aplican_segun_el_servicio(conn, "ASSET", requisito) == {str(vehiculo)}

    await conn.execute(
        "UPDATE public.compliance_requirements SET is_active = false WHERE id = $1",
        requisito)

    assert await _aplican_segun_el_servicio(conn, "ASSET", requisito) == set()
    diferencias = await calcular_diferencias(PoolDeUnaConexion(conn), str(requisito))
    assert str(vehiculo) not in diferencias["crear"]
    assert len(diferencias["quitar"]) == 1


# ── El guardia del propio archivo ─────────────────────────────────────────

MARCA_GUARDIA = "# ── El guardia del propio archivo"


def test_ningun_test_de_integracion_confirma_su_transaccion():
    """La regla es que nada de acá se escribe en firme. El fixture lo
    garantiza, pero un test podría burlarlo pidiendo su propia conexión o
    llamando a `commit()`. Que quede escrito y verificado, no sólo acordado."""
    fuente = Path(__file__).read_text(encoding="utf-8")
    # Del andamiaje hasta este mismo guardia: el guardia se excluye a sí mismo
    # porque su texto nombra lo que prohíbe.
    cuerpo = fuente[fuente.index("# ── Andamiaje"):fuente.index(MARCA_GUARDIA)]
    assert not re.search(r"\bcommit\b", cuerpo, re.IGNORECASE), (
        "aparecio un commit en los tests de integracion"
    )
    assert "asyncpg.connect" not in cuerpo, (
        "un test abrio su propia conexion: fuera de la transaccion revertida"
    )
    assert "conexion_revertida" in cuerpo, (
        "el guardia quedo mirando un pedazo vacio del archivo"
    )
