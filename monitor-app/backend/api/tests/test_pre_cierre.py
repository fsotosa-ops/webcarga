"""HU-02 (Cierre del Día, Fase 3) — pre-cierre automático (Tipo A/Tipo B).

Cada test controla la secuencia exacta de conn.fetch/fetchrow/fetchval vía
side_effect, siguiendo el orden real de queries en run_pre_cierre: plate
scan (Tipo A#1 + Tipo B patente) -> driver scan (Tipo A#2 + Tipo B
conductor) -> client scan (Tipo A#3) -> onboarding scan (Tipo B) -> sin
tipo de operación scan (Tipo B). Los sub-tests que no ejercitan un scan le
pasan listas vacías para mantener la secuencia predecible."""
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
    }]
    assert result["auto_resolved"] == []


@pytest.mark.asyncio
async def test_tipo_a2_actualiza_nombre_del_conductor_por_rut():
    conn = AsyncMock()
    conn.fetch.side_effect = [
        [],  # plate scan
        [{"rut": "111111111", "names": ["Juan Perez Gomez"]}],
        [], [], [],
    ]
    conn.fetchrow.side_effect = [
        {"id": "d1", "full_name": "Juan Perez", "is_manual_override": False},
    ]
    pool = _pool_with(conn)

    result = await run_pre_cierre(pool, DAY)

    assert result["auto_resolved"] == [{
        "type": "CONDUCTOR_DATOS", "driver_rut": "111111111",
        "old_value": "Juan Perez", "new_value": "Juan Perez Gomez",
        "message": "Se actualizó el nombre del conductor 111111111 de 'Juan Perez' a 'Juan Perez Gomez'.",
    }]


@pytest.mark.asyncio
async def test_tipo_b_conductor_no_registrado():
    conn = AsyncMock()
    conn.fetch.side_effect = [
        [],
        [{"rut": "222222222", "names": ["Pedro Soto"]}],
        [], [], [],
    ]
    conn.fetchrow.side_effect = [None]
    pool = _pool_with(conn)

    result = await run_pre_cierre(pool, DAY)

    assert result["escalations"]["CONDUCTOR_NO_REGISTRADO"] == [{"driver_rut": "222222222"}]


@pytest.mark.asyncio
async def test_tipo_a3_agrega_cliente_a_carrier_shippers():
    conn = AsyncMock()
    conn.fetch.side_effect = [
        [{"plate": "ABCD12", "carrier_names": [None]}],  # resuelve carrier, sin señal de reasignación
        [],  # driver scan
        [{"plate": "ABCD12", "client_name": "Walmart"}],
        [],  # onboarding scan
        [],  # sin tipo de operación scan
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
    ]
    pool = _pool_with(conn)

    result = await run_pre_cierre(pool, DAY)

    assert result["escalations"]["EMPRESA_ONBOARDING"] == [
        {"carrier_id": "c1", "carrier_name": "Empresa Onboarding"}
    ]
    assert result["escalations"]["SIN_TIPO_OPERACION"] == [
        {"carrier_id": "c2", "carrier_name": "Empresa Sin Tipo"}
    ]
