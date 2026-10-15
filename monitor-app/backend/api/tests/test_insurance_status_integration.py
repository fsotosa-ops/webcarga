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


async def test_las_lecturas_de_seguros_corren_contra_la_base(conexion_revertida):
    """El SQL de services/insurance.py, ejecutado con parámetros (no literales)."""
    from app.services import insurance

    conn = conexion_revertida
    today = await _today(conn)
    carrier = await _carrier(conn)
    policy = await _policy(conn, carrier, valid_from=today - timedelta(days=60), valid_to=today - timedelta(days=1))
    for n, delta in ((1, -40), (2, -10)):
        await conn.execute(
            "INSERT INTO public.insurance_installments (policy_id, installment_number, total_installments, amount_uf, due_date) "
            "VALUES ($1, $2, 2, 3.1, $3)", policy, n, today + timedelta(days=delta),
        )

    pol = await insurance.list_policies(conn, q="Seguros Test", state="EXPIRED")
    assert [r["id"] for r in pol["data"]] == [policy]
    assert pol["data"][0]["overdue_installments"] == 2 and pol["facets"]["UNPAID"] >= 1

    emp = await insurance.list_carriers(conn, q="76000000", state="EXPIRED")
    assert [r["carrier_id"] for r in emp["data"]] == [carrier]
    assert emp["data"][0]["insurance_alert"] == "EXPIRED"

    cuo = await insurance.list_installments(conn, q="Seguros Test", state="OVERDUE")
    assert len(cuo["data"]) == 2 and cuo["facets"]["OVERDUE"] == 2

    legacy = await insurance.carrier_policies(conn, carrier)
    assert legacy[0]["policy_health"] == "EXPIRED" and legacy[0]["total_installments"] == 2

    overview = await insurance.legacy_insurance_overview(conn, q="Seguros Test", health="", operational_status=["ACTIVE"], page=1, limit=10)
    assert overview["data"][0]["worst_policy_health"] == "EXPIRED"

    cuotas = await insurance.policy_installments(conn, policy)
    assert [c["payment_status"] for c in cuotas] == ["OVERDUE", "OVERDUE"]


async def _policy_with_installments(conn, n=3):
    today = await _today(conn)
    carrier = await _carrier(conn)
    policy = await _policy(conn, carrier, valid_from=today - timedelta(days=90), valid_to=today + timedelta(days=270))
    ids = [await conn.fetchval(
        "INSERT INTO public.insurance_installments (policy_id, installment_number, total_installments, amount_uf, due_date) "
        "VALUES ($1, $2, $3, 2, $4) RETURNING id", policy, i + 1, n, today - timedelta(days=30 * (n - i)),
    ) for i in range(n)]
    return policy, ids, today


async def test_S3_pagar_en_lote_guarda_el_hecho_y_audita_contra_la_poliza(conexion_revertida):
    from app.services import insurance

    conn = conexion_revertida
    policy, ids, today = await _policy_with_installments(conn)
    actor = "11111111-1111-1111-1111-111111111111"

    result = await insurance.pay_installments(conn, ids[:2] + [ids[0]], paid_on=today, actor=actor)

    assert sorted(result["paid"]) == sorted(ids[:2])
    # La repetida no se paga dos veces: lo dice, y no pisa la fecha ni quién.
    assert [e["id"] for e in result["errors"]] == [ids[0]]
    rows = {r["id"]: r for r in await conn.fetch(
        "SELECT id, paid, paid_on, paid_by::text FROM public.insurance_installments WHERE id = ANY($1::uuid[])", ids)}
    assert rows[ids[0]]["paid"] and rows[ids[0]]["paid_on"] == today and rows[ids[0]]["paid_by"] == actor
    assert not rows[ids[2]]["paid"]
    audit = await conn.fetch(
        "SELECT entity_type, entity_id FROM public.audit_log WHERE field = 'paid' AND entity_id = $1", policy)
    assert len(audit) == 2 and {a["entity_type"] for a in audit} == {"INSURANCE_POLICY"}


async def test_deshacer_un_pago_lo_deja_impago_y_audita(conexion_revertida):
    from app.services import insurance

    conn = conexion_revertida
    policy, ids, today = await _policy_with_installments(conn, n=1)
    actor = "11111111-1111-1111-1111-111111111111"
    await insurance.pay_installments(conn, ids, paid_on=today, actor=actor)

    result = await insurance.unpay_installments(conn, ids, actor=actor)

    assert result["unpaid"] == ids
    row = await conn.fetchrow("SELECT paid, paid_on, paid_by FROM public.insurance_installments WHERE id = $1", ids[0])
    assert (row["paid"], row["paid_on"], row["paid_by"]) == (False, None, None)
    assert await conn.fetchval(
        "SELECT count(*) FROM public.audit_log WHERE field = 'paid' AND entity_id = $1 AND entity_type = 'INSURANCE_POLICY'",
        policy) == 2


async def test_cancelar_una_poliza_guarda_fecha_y_motivo(conexion_revertida):
    from app.services import insurance

    conn = conexion_revertida
    policy, _, _ = await _policy_with_installments(conn, n=1)
    await insurance.cancel_policy(conn, policy, reason="Se cambió de aseguradora",
                                  actor="11111111-1111-1111-1111-111111111111")
    assert await _policy_state(conn, policy) == "CANCELLED"
    assert await conn.fetchval("SELECT cancelled_reason FROM public.insurance_policies WHERE id = $1", policy) \
        == "Se cambió de aseguradora"


async def test_generar_el_plan_crea_las_cuotas_mensuales_dentro_de_la_vigencia(conexion_revertida):
    """El camino feliz de POST /policies/{id}/installments/generate, contra la base."""
    from app.routers.policies import _add_months
    from app.services import insurance

    conn = conexion_revertida
    today = await _today(conn)
    carrier = await _carrier(conn)
    policy = await _policy(conn, carrier, valid_from=today, valid_to=today + timedelta(days=400))
    fechas = [_add_months(today, i) for i in range(3)]
    assert insurance.schedule_outside_validity(fechas, today, today + timedelta(days=400)) == []
    assert insurance.schedule_outside_validity([today - timedelta(days=1)], today, None) == [today - timedelta(days=1)]
    for i, d in enumerate(fechas):
        await conn.execute(
            "INSERT INTO public.insurance_installments (policy_id, installment_number, total_installments, amount_uf, due_date) "
            "VALUES ($1, $2, 3, 2.5, $3)", policy, i + 1, d)
    cuotas = await insurance.policy_installments(conn, policy)
    assert [c["installment_number"] for c in cuotas] == [1, 2, 3]
    assert {c["installments_total"] for c in cuotas} == {3}
    assert not any(c["outside_validity"] for c in cuotas)


async def test_S6_dos_cuotas_vencidas_es_la_alerta_de_la_empresa_en_todas_partes(conexion_revertida):
    """La regla D2 vive en app.carrier_insurance_summary: la misma fila la leen
    /policies?group_by=carrier, /carriers/{id}/policies y /trips."""
    from app.services import insurance

    conn = conexion_revertida
    today = await _today(conn)
    carrier = await _carrier(conn)
    policy = await _policy(conn, carrier, valid_from=today - timedelta(days=100), valid_to=today + timedelta(days=200))
    for n in (1, 2):
        await conn.execute(
            "INSERT INTO public.insurance_installments (policy_id, installment_number, total_installments, amount_uf, due_date) "
            "VALUES ($1, $2, 2, 1, $3)", policy, n, today - timedelta(days=10 * n))

    alerta = await conn.fetchval("SELECT insurance_alert FROM app.carrier_insurance_summary WHERE carrier_id = $1", carrier)
    assert alerta == "OVERDUE_INSTALLMENTS"
    emp = await insurance.list_carriers(conn, q="76000000")
    assert emp["data"][0]["insurance_alert"] == "OVERDUE_INSTALLMENTS" and emp["data"][0]["worst_state"] == "VALID"
