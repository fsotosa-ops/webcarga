"""El veredicto de Seguros de una empresa (Seguros por empresa, 17/10, criterio E1).

WebCarga monitorea si cada transportista está al día con sus pólizas. El veredicto se
calcula en la base (`app.carrier_insurance_summary`), una vez, y lo leen Seguros, la ficha
de empresa y el Monitor. Gana el primero que se cumple: Vencida, Sin póliza, Cuotas
vencidas, Sin fechas, Por vencer, Al día. Cada test crea su empresa dentro de la
transacción revertida.
"""
from __future__ import annotations

from datetime import timedelta
from itertools import count

from tests.test_insurance_status_integration import _policy, _today

_rut = count(1)


async def _empresa(conn, *, status: str = "ACTIVE") -> str:
    return await conn.fetchval(
        "INSERT INTO public.carriers (business_name, tax_id, operational_status) "
        "VALUES ('Veredicto Test SpA', $1, $2) RETURNING id",
        f"77{next(_rut):06d}-0", status,
    )


async def _cuota(conn, policy_id, n: int, due, *, amount=2.5, paid=False) -> None:
    await conn.execute(
        "INSERT INTO public.insurance_installments (policy_id, installment_number, amount_uf, due_date, paid) "
        "VALUES ($1, $2, $3, $4, $5)", policy_id, n, amount, due, paid)


async def _fila(conn, carrier_id):
    return await conn.fetchrow("SELECT * FROM app.carrier_insurance_summary WHERE carrier_id = $1", carrier_id)


async def test_E1_poliza_vencida_gana_aunque_tenga_cuotas_vencidas(conexion_revertida):
    conn = conexion_revertida
    hoy = await _today(conn)
    c = await _empresa(conn)
    p = await _policy(conn, c, valid_from=hoy - timedelta(days=400), valid_to=hoy - timedelta(days=10))
    await _cuota(conn, p, 1, hoy - timedelta(days=40))
    await _cuota(conn, p, 2, hoy - timedelta(days=20))
    fila = await _fila(conn, c)
    assert fila["insurance_verdict"] == "EXPIRED"
    assert fila["reason_insurer"] == "Aseguradora Test" and fila["reason_valid_to"] == hoy - timedelta(days=10)


async def test_E1_sin_polizas_es_sin_poliza(conexion_revertida):
    c = await _empresa(conexion_revertida)
    assert (await _fila(conexion_revertida, c))["insurance_verdict"] == "NO_POLICY"


async def test_E1_todas_canceladas_es_sin_poliza(conexion_revertida):
    conn = conexion_revertida
    hoy = await _today(conn)
    c = await _empresa(conn)
    await _policy(conn, c, valid_from=hoy - timedelta(days=30), valid_to=hoy + timedelta(days=300), cancelled=True)
    assert (await _fila(conn, c))["insurance_verdict"] == "NO_POLICY"


async def test_E1_solo_una_poliza_vencida_es_vencida_no_sin_poliza(conexion_revertida):
    conn = conexion_revertida
    hoy = await _today(conn)
    c = await _empresa(conn)
    await _policy(conn, c, valid_from=hoy - timedelta(days=400), valid_to=hoy - timedelta(days=5))
    fila = await _fila(conn, c)
    assert fila["insurance_verdict"] == "EXPIRED"
    assert fila["insurance_alert"] == "EXPIRED"  # el Monitor la sigue alertando


async def test_E1_una_cuota_vencida_es_aviso_y_dos_en_la_misma_poliza_es_grave(conexion_revertida):
    conn = conexion_revertida
    hoy = await _today(conn)
    c = await _empresa(conn)
    p = await _policy(conn, c, valid_from=hoy - timedelta(days=100), valid_to=hoy + timedelta(days=260))
    await _cuota(conn, p, 1, hoy - timedelta(days=25), amount=2.5)
    await _cuota(conn, p, 2, hoy + timedelta(days=5), amount=None)
    fila = await _fila(conn, c)
    assert fila["insurance_verdict"] == "OVERDUE" and fila["severe_overdue"] is False
    assert fila["oldest_overdue_date"] == hoy - timedelta(days=25)
    assert float(fila["unpaid_uf"]) == 2.5  # la cuota sin monto no suma
    await _cuota(conn, p, 3, hoy - timedelta(days=10))
    fila = await _fila(conn, c)
    assert fila["severe_overdue"] is True and fila["insurance_alert"] == "OVERDUE_INSTALLMENTS"


async def test_E1_sin_fecha_de_termino_es_sin_fechas(conexion_revertida):
    conn = conexion_revertida
    c = await _empresa(conn)
    await _policy(conn, c, valid_from=None, valid_to=None)
    assert (await _fila(conn, c))["insurance_verdict"] == "NO_DATES"


async def test_E1_vence_dentro_del_aviso_es_por_vencer_y_si_no_al_dia(conexion_revertida):
    conn = conexion_revertida
    hoy = await _today(conn)
    pronto, lejos = await _empresa(conn), await _empresa(conn)
    await _policy(conn, pronto, valid_from=hoy - timedelta(days=300), valid_to=hoy + timedelta(days=10))
    await _policy(conn, lejos, valid_from=hoy - timedelta(days=30), valid_to=hoy + timedelta(days=300))
    fila = await _fila(conn, pronto)
    assert fila["insurance_verdict"] == "EXPIRING" and fila["reason_valid_to"] == hoy + timedelta(days=10)
    assert (await _fila(conn, lejos))["insurance_verdict"] == "UP_TO_DATE"


async def test_E1_renovada_con_deuda_cuenta_como_cuotas_vencidas_no_como_vencida(conexion_revertida):
    from app.services import insurance

    conn = conexion_revertida
    hoy = await _today(conn)
    c = await _empresa(conn)
    vieja = await _policy(conn, c, valid_from=hoy - timedelta(days=400), valid_to=hoy - timedelta(days=30))
    await _cuota(conn, vieja, 1, hoy - timedelta(days=60))
    nueva = await _policy(conn, c, valid_from=hoy - timedelta(days=30), valid_to=hoy + timedelta(days=335))
    await insurance.link_renewal(conn, vieja, nueva, actor="11111111-1111-1111-1111-111111111111")
    fila = await _fila(conn, c)
    assert fila["insurance_verdict"] == "OVERDUE" and fila["overdue_installments"] == 1


async def test_E1_que_empresas_tienen_veredicto(conexion_revertida):
    conn = conexion_revertida
    hoy = await _today(conn)
    inactiva_sin = await _empresa(conn, status="INACTIVE")
    inactiva_con = await _empresa(conn, status="INACTIVE")
    await _policy(conn, inactiva_con, valid_from=hoy - timedelta(days=400), valid_to=hoy - timedelta(days=5))
    assert await _fila(conn, inactiva_sin) is None
    assert (await _fila(conn, inactiva_con))["insurance_verdict"] == "EXPIRED"
