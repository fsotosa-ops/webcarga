"""HU-02 (Cierre del Día, Fase 3) — pre-cierre automático (Tipo A/Tipo B).

Cada test controla la secuencia exacta de conn.fetch/fetchrow/fetchval vía
side_effect, siguiendo el orden real de queries en run_pre_cierre: plate
scan (Tipo A#1 + Tipo B patente) -> driver scan (Tipo A#2 + Tipo B
conductor) -> client scan (Tipo A#3) -> onboarding scan (Tipo B) -> sin
tipo de operación scan (Tipo B) -> conductor sin empresa scan (Tipo B,
2026-08-27). Los sub-tests que no ejercitan un scan le pasan listas vacías
para mantener la secuencia predecible."""
from datetime import date
from unittest.mock import AsyncMock

import pytest

from app.services.pre_cierre import run_pre_cierre
from tests.conftest import wire_transactional_conn

DAY = date(2026, 8, 2)


def _pool_with(conn: AsyncMock) -> AsyncMock:
    pool = AsyncMock()
    wire_transactional_conn(pool, conn)
    return pool


@pytest.mark.asyncio
async def test_tipo_a1_reasigna_empresa_cuando_tms_reporta_una_empresa_real_distinta():
    conn = AsyncMock()
    conn.fetchrow.side_effect = [
        {"id": "asset1"},  # asset
        {"carrier_id": "c_old", "business_name": "Empresa Vieja", "is_manual_override": False},  # assignment
    ]
    conn.fetch.side_effect = [
        [{"plate": "ABCD12", "carrier_names": ["Transportes Moneda Ltda."]}],
        [{"id": "c_new", "business_name": "Transportes Moneda Ltda."}],  # candidates
        [],  # driver scan
        [],  # client scan
        [],  # onboarding scan
        [],  # sin tipo de operación scan
        [],  # conductor sin empresa scan
    ]
    pool = _pool_with(conn)

    result = await run_pre_cierre(pool, DAY)

    assert result["auto_resolved"] == [{
        "type": "PATENTE_EMPRESA", "tractor_plate": "ABCD12",
        "old_carrier_name": "Empresa Vieja", "new_carrier_name": "Transportes Moneda Ltda.",
        "message": (
            "Se actualizó la empresa asociada a la patente ABCD12 de "
            "'Empresa Vieja' a 'Transportes Moneda Ltda.'. Revisar que los documentos "
            "asociados (permiso de circulación, contrato de conductor) estén vigentes "
            "para la nueva empresa."
        ),
    }]
    assert result["escalations"]["PATENTE_NO_REGISTRADA"] == []
    assert result["escalations"]["EMPRESA_NO_RECONOCIDA"] == []


@pytest.mark.asyncio
async def test_ignora_webcarga_como_señal_de_empresa():
    """Hallazgo real 2026-08-02: transporter_name_tms es una variante de
    'WEBCARGA' en ~99.6% de los viajes reales — nunca debe disparar una
    reasignación."""
    conn = AsyncMock()
    conn.fetch.side_effect = [
        [{"plate": "ABCD12", "carrier_names": ["WEBCARGA SPA"]}],
        [],  # driver scan
        [],  # client scan
        [],  # onboarding scan
        [],  # sin tipo de operación scan
        [],  # conductor sin empresa scan
    ]
    conn.fetchrow.side_effect = [
        {"id": "asset1"},
        {"carrier_id": "c1", "business_name": "Empresa X", "is_manual_override": False},
    ]
    pool = _pool_with(conn)

    result = await run_pre_cierre(pool, DAY)

    assert result["auto_resolved"] == []
    assert all(v == [] for v in result["escalations"].values())


@pytest.mark.asyncio
async def test_no_actua_si_los_viajes_del_dia_discrepan_entre_si():
    """Señal ambigua dentro del mismo día (2 empresas distintas reportadas
    para la misma patente) — no se auto-resuelve, queda para MISMATCH."""
    conn = AsyncMock()
    conn.fetch.side_effect = [
        [{"plate": "ABCD12", "carrier_names": ["Empresa A", "Empresa B"]}],
        [], [], [], [],
        [],  # conductor sin empresa scan
    ]
    conn.fetchrow.side_effect = [
        {"id": "asset1"},
        {"carrier_id": "c1", "business_name": "Empresa Vieja", "is_manual_override": False},
    ]
    pool = _pool_with(conn)

    result = await run_pre_cierre(pool, DAY)

    assert result["auto_resolved"] == []


@pytest.mark.asyncio
async def test_no_actua_sobre_asignacion_con_override_manual():
    conn = AsyncMock()
    conn.fetch.side_effect = [
        [{"plate": "ABCD12", "carrier_names": ["Transportes Moneda Ltda."]}],
        [], [], [], [],
        [],  # conductor sin empresa scan
    ]
    conn.fetchrow.side_effect = [
        {"id": "asset1"},
        {"carrier_id": "c1", "business_name": "Empresa Vieja", "is_manual_override": True},
    ]
    pool = _pool_with(conn)

    result = await run_pre_cierre(pool, DAY)

    assert result["auto_resolved"] == []


@pytest.mark.asyncio
async def test_tipo_b_patente_no_registrada_cuando_el_asset_no_existe():
    conn = AsyncMock()
    conn.fetch.side_effect = [
        [{"plate": "XXXX99", "carrier_names": [None]}],
        [], [], [], [],
        [],  # conductor sin empresa scan
    ]
    conn.fetchrow.side_effect = [None]
    pool = _pool_with(conn)

    result = await run_pre_cierre(pool, DAY)

    assert result["escalations"]["PATENTE_NO_REGISTRADA"] == [
        {"tractor_plate": "XXXX99", "reason": "La patente no existe en public.assets"}
    ]


@pytest.mark.asyncio
async def test_tipo_b_patente_no_registrada_cuando_no_tiene_asignacion_activa():
    conn = AsyncMock()
    conn.fetch.side_effect = [
        [{"plate": "ABCD12", "carrier_names": [None]}],
        [], [], [], [],
        [],  # conductor sin empresa scan
    ]
    conn.fetchrow.side_effect = [{"id": "asset1"}, None]
    pool = _pool_with(conn)

    result = await run_pre_cierre(pool, DAY)

    assert result["escalations"]["PATENTE_NO_REGISTRADA"] == [
        {"tractor_plate": "ABCD12", "reason": "La patente existe pero no tiene empresa asignada"}
    ]


@pytest.mark.asyncio
async def test_tipo_b_empresa_no_reconocida_cuando_el_nombre_tms_no_matchea_ningun_carrier():
    conn = AsyncMock()
    conn.fetch.side_effect = [
        [{"plate": "ABCD12", "carrier_names": ["Transportes Fantasma SPA"]}],
        [],  # candidates: ninguno matchea
        [], [], [], [],
        [],  # conductor sin empresa scan
    ]
    conn.fetchrow.side_effect = [
        {"id": "asset1"},
        {"carrier_id": "c1", "business_name": "Empresa Vieja", "is_manual_override": False},
    ]
    pool = _pool_with(conn)

    result = await run_pre_cierre(pool, DAY)

    assert result["escalations"]["EMPRESA_NO_RECONOCIDA"] == [{
        "tractor_plate": "ABCD12", "tms_carrier_name": "Transportes Fantasma SPA",
        "directory_carrier_name": "Empresa Vieja",
        # El id va con la escalación para que el panel del Cierre enlace
        # derecho a la ficha donde se corrige, y no al índice del directorio.
        "directory_carrier_id": "c1",
    }]
    assert result["auto_resolved"] == []


@pytest.mark.asyncio
async def test_tipo_a2_actualiza_nombre_del_conductor_por_rut():
    conn = AsyncMock()
    conn.fetch.side_effect = [
        [],  # plate scan
        [{"rut": "11111111-1", "es_canonico": True, "names": ["Juan Perez Gomez"]}],
        [], [], [],
        [],  # conductor sin empresa scan
    ]
    conn.fetchrow.side_effect = [
        {"id": "d1", "full_name": "Juan Perez", "is_manual_override": False},
    ]
    pool = _pool_with(conn)

    result = await run_pre_cierre(pool, DAY)

    assert result["auto_resolved"] == [{
        "type": "CONDUCTOR_DATOS", "driver_rut": "11111111-1",
        "old_value": "Juan Perez", "new_value": "Juan Perez Gomez",
        "message": "Se actualizó el nombre del conductor 11111111-1 de 'Juan Perez' a 'Juan Perez Gomez'.",
    }]


@pytest.mark.asyncio
async def test_tipo_b_conductor_no_registrado():
    conn = AsyncMock()
    conn.fetch.side_effect = [
        [],
        [{"rut": "22222222-2", "es_canonico": True, "names": ["Pedro Soto"]}],
        [], [], [],
        [],  # conductor sin empresa scan
    ]
    conn.fetchrow.side_effect = [None]
    pool = _pool_with(conn)

    result = await run_pre_cierre(pool, DAY)

    assert result["escalations"]["CONDUCTOR_NO_REGISTRADO"] == [
        {"driver_rut": "22222222-2", "driver_name_tms": "Pedro Soto"},
    ]


@pytest.mark.asyncio
async def test_el_nombre_del_tms_viaja_con_la_escalacion_para_poder_dar_de_alta():
    """Sin el nombre, la única salida del panel del Cierre era un enlace a otro
    módulo — el "círculo bloqueante" de la minuta del 25/08. Con él, el alta se
    ofrece ahí mismo y con el nombre ya escrito."""
    conn = AsyncMock()
    conn.fetch.side_effect = [
        [],
        [{"rut": "33333333-3", "es_canonico": True, "names": ["Pedro Soto", "Pedro Soto"]}],
        [], [], [],
        [],  # conductor sin empresa scan
    ]
    conn.fetchrow.side_effect = [None]
    pool = _pool_with(conn)

    result = await run_pre_cierre(pool, DAY)

    assert result["escalations"]["CONDUCTOR_NO_REGISTRADO"][0]["driver_name_tms"] == "Pedro Soto"


@pytest.mark.asyncio
async def test_si_el_tms_da_dos_nombres_para_el_mismo_rut_no_se_propone_ninguno():
    """Elegir uno de los dos sería inventar. El panel pide el nombre a mano."""
    conn = AsyncMock()
    conn.fetch.side_effect = [
        [],
        [{"rut": "44444444-4", "es_canonico": True, "names": ["Pedro Soto", "Pedro Sotomayor"]}],
        [], [], [],
        [],  # conductor sin empresa scan
    ]
    conn.fetchrow.side_effect = [None]
    pool = _pool_with(conn)

    result = await run_pre_cierre(pool, DAY)

    assert result["escalations"]["CONDUCTOR_NO_REGISTRADO"][0]["driver_name_tms"] is None


@pytest.mark.asyncio
async def test_un_rut_que_no_canoniza_se_escala_con_su_motivo():
    """Distinto de "no está en el directorio", y por eso no se busca.

    Cuando `public.canonical_rut()` devuelve NULL, el TMS mandó algo que no es
    un RUT. Buscarlo en `public.drivers` no puede dar nada, y el coordinador
    necesita ver EXACTAMENTE lo que llegó para poder reclamarlo aguas arriba."""
    conn = AsyncMock()
    conn.fetch.side_effect = [
        [],
        [{"rut": "SIN RUT", "es_canonico": False, "names": ["Pedro Soto"]}],
        [], [], [],
        [],  # conductor sin empresa scan
    ]
    pool = _pool_with(conn)

    result = await run_pre_cierre(pool, DAY)

    assert result["escalations"]["CONDUCTOR_NO_REGISTRADO"] == [{
        "driver_rut": "SIN RUT",
        "reason": "El TMS informó un RUT que no es válido",
    }]
    # No se buscó al conductor: no hay nada que buscar.
    assert conn.fetchrow.await_count == 0


@pytest.mark.asyncio
async def test_tipo_a3_agrega_cliente_a_carrier_shippers():
    conn = AsyncMock()
    conn.fetch.side_effect = [
        [{"plate": "ABCD12", "carrier_names": [None]}],  # resuelve carrier, sin señal de reasignación
        [],  # driver scan
        [{"plate": "ABCD12", "client_name": "Walmart"}],
        [],  # onboarding scan
        [],  # sin tipo de operación scan
        [],  # conductor sin empresa scan
    ]
    conn.fetchrow.side_effect = [
        {"id": "asset1"},
        {"carrier_id": "c1", "business_name": "Empresa X", "is_manual_override": False},
        {"id": "s1", "name": "Walmart"},
    ]
    conn.fetchval.side_effect = [None, "Empresa X"]
    pool = _pool_with(conn)

    result = await run_pre_cierre(pool, DAY)

    assert result["auto_resolved"] == [{
        "type": "CLIENTE_EMPRESA", "carrier_name": "Empresa X", "client_name": "Walmart",
        "message": "Se agregó 'Walmart' a la lista de clientes de 'Empresa X'.",
    }]


@pytest.mark.asyncio
async def test_tipo_b_onboarding_y_sin_tipo_de_operacion():
    conn = AsyncMock()
    conn.fetch.side_effect = [
        [], [], [],
        [{"carrier_id": "c1", "business_name": "Empresa Onboarding"}],
        [{"carrier_id": "c2", "business_name": "Empresa Sin Tipo"}],
        [],  # conductor sin empresa scan
    ]
    pool = _pool_with(conn)

    result = await run_pre_cierre(pool, DAY)

    assert result["escalations"]["EMPRESA_ONBOARDING"] == [
        {"carrier_id": "c1", "carrier_name": "Empresa Onboarding"}
    ]
    assert result["escalations"]["SIN_TIPO_OPERACION"] == [
        {"carrier_id": "c2", "carrier_name": "Empresa Sin Tipo"}
    ]


# ── FIX 2026-08-18: las 5 consultas usaban `planning_date = $1` exacto
# mientras el resto del Cierre (daily_closures.py, equipment_closures.py,
# status_report.py) ya usaba el criterio multi-día. Como run_pre_cierre corre
# DENTRO de _recompute(), justo antes del cálculo que sí es multi-día, un
# viaje multi-día no disparaba ninguna corrección ni ninguna escalación: el
# pre-cierre miraba un universo más chico que la cuadratura que preparaba.
# El test mira el SQL realmente enviado, no una constante de módulo — acá las
# queries son inline. ──────────

_CRITERIO_MULTIDIA = "(t.planning_date = $1 OR (t.planning_date < $1 AND t.is_active))"


# ── Conductor con viaje y sin empresa: se PROPONE, no se escribe ────────────
# El caso Gerson Ferrada de la minuta del 25/08. El cierre recorre el padron
# (driver_assignments) y el viaje resuelve el conductor por lo que reporta el
# TMS; nada los reconciliaba. Lo que se fija aca son las TRES condiciones que
# hacen que esto sea una propuesta y no una escritura automatica.

def _fetch_con_sin_empresa(filas):
    """La secuencia de scans con la ULTIMA consulta —la de conductor sin
    empresa— devolviendo `filas`. Las otras cinco no se ejercitan."""
    return [[], [], [], [], [], filas]


@pytest.mark.asyncio
async def test_propone_la_empresa_del_tracto_al_conductor_que_no_tiene():
    conn = AsyncMock()
    conn.fetch.side_effect = _fetch_con_sin_empresa([{
        "driver_id": "d1", "full_name": "Gerson Ferrada Zapata",
        "carrier_id": "c1", "carrier_name": "Transportes Juan Ramirez Spa", "viajes": 25,
    }])
    pool = _pool_with(conn)

    result = await run_pre_cierre(pool, DAY)

    assert result["escalations"]["CONDUCTOR_SIN_EMPRESA"] == [{
        "driver_id": "d1", "driver_name": "Gerson Ferrada Zapata",
        "carrier_id": "c1", "carrier_name": "Transportes Juan Ramirez Spa", "viajes": 25,
    }]


@pytest.mark.asyncio
async def test_la_propuesta_no_escribe_nada():
    """Lo unico que la separa de una correccion Tipo A. Escribirla sola seria
    dejar que una inferencia decida sobre el padron sin que nadie la vea."""
    conn = AsyncMock()
    conn.fetch.side_effect = _fetch_con_sin_empresa([{
        "driver_id": "d1", "full_name": "Gerson Ferrada Zapata",
        "carrier_id": "c1", "carrier_name": "Transportes Juan Ramirez Spa", "viajes": 25,
    }])
    pool = _pool_with(conn)

    result = await run_pre_cierre(pool, DAY)

    assert conn.execute.await_count == 0
    # Y no se cuela como correccion automatica, que es lo que la pantalla
    # muestra como "ya lo resolvi solo".
    assert result["auto_resolved"] == []


@pytest.mark.asyncio
async def test_la_propuesta_no_bloquea_el_cierre():
    """No entra a _ESCALACIONES_QUE_BLOQUEAN: bloquear el dia con una
    propuesta cambiaria la operacion sin que nadie lo haya pedido."""
    from app.routers.daily_closures import _ESCALACIONES_QUE_BLOQUEAN

    assert "CONDUCTOR_SIN_EMPRESA" not in _ESCALACIONES_QUE_BLOQUEAN


@pytest.mark.asyncio
async def test_solo_propone_cuando_el_padron_esta_en_silencio_y_la_senal_es_unica():
    """Las dos condiciones viven en el SQL, asi que se fijan leyendolo: si
    alguien las saca, el test lo dice antes de que la propuesta empiece a
    contradecir el padron o a elegir entre dos empresas."""
    conn = AsyncMock()
    conn.fetch.side_effect = _fetch_con_sin_empresa([])
    pool = _pool_with(conn)

    await run_pre_cierre(pool, DAY)

    sql = conn.fetch.call_args_list[-1].args[0]
    # 1. Solo si el conductor NO tiene asignacion activa (silencio, nunca
    #    contradiccion).
    assert "NOT EXISTS" in sql and "driver_assignments" in sql
    assert "da.status = 'ACTIVE'" in sql
    # 2. Solo si todos sus viajes apuntan a la MISMA empresa.
    assert "HAVING count(DISTINCT vfr.resolved_carrier_id) = 1" in sql
    # 3. Y sobre empresas y conductores vigentes, no dados de baja.
    assert "d.operational_status = 'ACTIVE'" in sql
    assert "c.operational_status = 'ACTIVE'" in sql


@pytest.mark.asyncio
async def test_las_seis_consultas_usan_el_criterio_multidia():
    conn = AsyncMock()
    conn.fetch.side_effect = [[], [], [], [], [], []]
    pool = _pool_with(conn)

    await run_pre_cierre(pool, DAY)

    consultas = [c.args[0] for c in conn.fetch.call_args_list]
    assert len(consultas) == 6, "cambió la cantidad de scans de run_pre_cierre"
    for i, sql in enumerate(consultas):
        assert _CRITERIO_MULTIDIA in sql, f"el scan #{i + 1} volvió al criterio de un solo día"
        assert "planning_date = $1 AND" not in sql, f"el scan #{i + 1} quedó con el predicado viejo"


@pytest.mark.asyncio
async def test_no_excluye_sodimac_porque_esa_fuente_no_puede_aportar_señal():
    """Contrapunto deliberado de daily_closures, que SÍ la excluye.

    Acá sería código muerto: las consultas exigen `tractor_plate` o
    `driver_rut_tms`, y de los 54 viajes Sodimac de app.trips, 0 traen
    patente y 0 traen RUT (verificado contra producción, 2026-08-18). El
    scan de "conductor sin empresa" (2026-08-27) tampoco la alcanza: sale
    de `v_trip_fleet_resolution`, que resuelve por patente o por RUT.
    Si alguien agrega la exclusión "por consistencia", este test explica
    por qué no hace falta."""
    conn = AsyncMock()
    conn.fetch.side_effect = [[], [], [], [], [], []]
    pool = _pool_with(conn)

    await run_pre_cierre(pool, DAY)

    consultas = [c.args[0] for c in conn.fetch.call_args_list]
    exigen_patente_o_rut = [
        s for s in consultas
        if "tractor_plate" in s or "driver_rut_tms" in s
    ]
    assert len(exigen_patente_o_rut) == 5, (
        "alguna consulta dejó de exigir patente o RUT — si es así, ahora SÍ "
        "puede entrar Sodimac y hay que excluirla explícitamente"
    )
