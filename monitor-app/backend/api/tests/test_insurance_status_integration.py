"""El estado de pólizas y cuotas se calcula al leer (Seguros, Entrega 1, 15/10).

Antes vivía en una vista materializada que solo se refrescaba cuando alguien
escribía: una póliza que vencía ayer seguía "al día" si nadie tocaba Seguros.
Estos tests crean su empresa, su póliza y sus cuotas dentro de la transacción
revertida, y miran `app.insurance_status` sin escribir nada después.
"""
from __future__ import annotations

from datetime import date, timedelta


async def _carrier(conn) -> str:
    return await conn.fetchval(
        "INSERT INTO public.carriers (business_name, tax_id, operational_status) "
        "VALUES ('Seguros Test SpA', '76000000-0', 'ACTIVE') RETURNING id"
    )


async def _policy(conn, carrier_id, *, valid_from, valid_to, cancelled=False) -> str:
    return await conn.fetchval(
        "INSERT INTO public.insurance_policies (carrier_id, insurance_company, policy_number, valid_from, valid_to, cancelled_at) "
        "VALUES ($1, 'Aseguradora Test', 'P-1', $2, $3, CASE WHEN $4 THEN now() END) RETURNING id",
        carrier_id, valid_from, valid_to, cancelled,
    )


async def _today(conn) -> date:
    return await conn.fetchval("SELECT (now() AT TIME ZONE 'America/Santiago')::date")


async def _policy_state(conn, policy_id) -> str:
    return await conn.fetchval(
        "SELECT DISTINCT policy_state FROM app.insurance_status WHERE policy_id = $1", policy_id,
    )


async def test_S1_policy_state_is_computed_on_read(conexion_revertida):
    conn = conexion_revertida
    today = await _today(conn)
    carrier = await _carrier(conn)

    expired = await _policy(conn, carrier, valid_from=today - timedelta(days=365), valid_to=today - timedelta(days=1))
    expiring = await _policy(conn, carrier, valid_from=today - timedelta(days=300), valid_to=today + timedelta(days=10))
    valid = await _policy(conn, carrier, valid_from=today - timedelta(days=10), valid_to=today + timedelta(days=200))
    cancelled = await _policy(conn, carrier, valid_from=today - timedelta(days=10), valid_to=today + timedelta(days=200), cancelled=True)
    no_dates = await _policy(conn, carrier, valid_from=None, valid_to=None)

    assert await _policy_state(conn, expired) == "EXPIRED"
    assert await _policy_state(conn, expiring) == "EXPIRING"
    assert await _policy_state(conn, valid) == "VALID"
    assert await _policy_state(conn, cancelled) == "CANCELLED"
    assert await _policy_state(conn, no_dates) == "NO_DATES"
    # Sin vista materializada: no hay nada que refrescar.
    assert await conn.fetchval("SELECT to_regclass('app.carrier_insurance_status')") is None


async def test_S2_installment_state_is_computed_on_read(conexion_revertida):
    conn = conexion_revertida
    today = await _today(conn)
    carrier = await _carrier(conn)
    policy = await _policy(conn, carrier, valid_from=today - timedelta(days=60), valid_to=today + timedelta(days=300))

    async def installment(number, due, *, paid=False, paid_on=None):
        return await conn.fetchval(
            "INSERT INTO public.insurance_installments (policy_id, installment_number, total_installments, amount_uf, due_date, paid, paid_on) "
            "VALUES ($1, $2, 4, 2.5, $3, $4, $5) RETURNING id",
            policy, number, due, paid, paid_on,
        )

    overdue = await installment(1, today - timedelta(days=5))
    paid_no_date = await installment(2, today - timedelta(days=3), paid=True)
    pending = await installment(3, today + timedelta(days=20))
    outside = await installment(4, today - timedelta(days=90))

    rows = {r["installment_id"]: r for r in await conn.fetch(
        "SELECT installment_id, installment_state, outside_validity, installments_total, paid_on "
        "FROM app.insurance_status WHERE policy_id = $1", policy,
    )}
    assert rows[overdue]["installment_state"] == "OVERDUE"
    assert rows[paid_no_date]["installment_state"] == "PAID"
    assert rows[paid_no_date]["paid_on"] is None
    assert rows[pending]["installment_state"] == "PENDING"
    assert rows[outside]["outside_validity"] is True
    assert rows[pending]["outside_validity"] is False
    # El total sale de contar las cuotas, no de la columna copiada.
    assert {r["installments_total"] for r in rows.values()} == {4}
