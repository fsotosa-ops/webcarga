"""Seguros E2: renovar y extender vigencia (los dos habilitados; a validar con Pablo).

En la base real, 6 de las 7 empresas "Vencida" tenían además una póliza vigente:
renovaciones cargadas como pólizas nuevas. La renovada no cuenta para el estado
de la empresa; sus cuotas impagas sí.
"""
from __future__ import annotations

from datetime import timedelta

from tests.test_insurance_status_integration import _carrier, _policy, _policy_state, _today

ACTOR = "11111111-1111-1111-1111-111111111111"


async def test_S16_la_renovada_no_hace_vencida_a_la_empresa_pero_sus_deudas_cuentan(conexion_revertida):
    from app.services import insurance

    conn = conexion_revertida
    today = await _today(conn)
    carrier = await _carrier(conn)
    vieja = await _policy(conn, carrier, valid_from=today - timedelta(days=400), valid_to=today - timedelta(days=30))
    await conn.execute(
        "INSERT INTO public.insurance_installments (policy_id, installment_number, amount_uf, due_date) "
        "VALUES ($1, 1, 2, $2)", vieja, today - timedelta(days=60))
    nueva = await _policy(conn, carrier, valid_from=today - timedelta(days=30), valid_to=today + timedelta(days=335))

    assert (await conn.fetchval("SELECT worst_state FROM app.carrier_insurance_summary WHERE carrier_id = $1", carrier)) == "EXPIRED"
    await insurance.link_renewal(conn, vieja, nueva, actor=ACTOR)

    assert await _policy_state(conn, vieja) == "RENEWED"
    fila = await conn.fetchrow(
        "SELECT worst_state, insurance_alert, overdue_installments, policies FROM app.carrier_insurance_summary WHERE carrier_id = $1",
        carrier)
    assert fila["worst_state"] == "VALID" and fila["insurance_alert"] is None
    assert fila["overdue_installments"] == 1 and fila["policies"] == 1


async def test_renovar_crea_la_sucesora_con_los_datos_de_la_anterior(conexion_revertida):
    from app.services import insurance

    conn = conexion_revertida
    today = await _today(conn)
    carrier = await _carrier(conn)
    vieja = await _policy(conn, carrier, valid_from=today - timedelta(days=360), valid_to=today + timedelta(days=5))
    nueva = await insurance.renew_policy(conn, vieja, valid_from=today + timedelta(days=5),
                                         valid_to=today + timedelta(days=370), policy_number="P-2", actor=ACTOR)
    fila = await conn.fetchrow("SELECT carrier_id, insurance_company, policy_number, renews_policy_id FROM public.insurance_policies WHERE id = $1", nueva)
    assert (fila["carrier_id"], fila["insurance_company"], fila["policy_number"], fila["renews_policy_id"]) == (carrier, "Aseguradora Test", "P-2", vieja)
    assert await _policy_state(conn, vieja) == "RENEWED"


async def test_una_poliza_no_se_renueva_dos_veces(conexion_revertida):
    import pytest
    from app.services import insurance

    conn = conexion_revertida
    today = await _today(conn)
    carrier = await _carrier(conn)
    vieja = await _policy(conn, carrier, valid_from=today - timedelta(days=360), valid_to=today)
    a = await _policy(conn, carrier, valid_from=today, valid_to=today + timedelta(days=365))
    b = await _policy(conn, carrier, valid_from=today, valid_to=today + timedelta(days=365))
    await insurance.link_renewal(conn, vieja, a, actor=ACTOR)
    with pytest.raises(ValueError):
        await insurance.link_renewal(conn, vieja, b, actor=ACTOR)


async def test_candidatas_a_renovacion_son_las_que_empiezan_cerca_del_fin(conexion_revertida):
    from app.services import insurance

    conn = conexion_revertida
    today = await _today(conn)
    carrier = await _carrier(conn)
    vieja = await _policy(conn, carrier, valid_from=today - timedelta(days=400), valid_to=today - timedelta(days=30))
    cerca = await _policy(conn, carrier, valid_from=today - timedelta(days=30), valid_to=today + timedelta(days=335))
    await _policy(conn, carrier, valid_from=today - timedelta(days=200), valid_to=today + timedelta(days=165))
    assert [c["id"] for c in await insurance.renewal_candidates(conn, vieja)] == [cerca]


async def test_S17_extender_guarda_el_cambio_con_su_endoso(conexion_revertida):
    from app.services import insurance

    conn = conexion_revertida
    today = await _today(conn)
    carrier = await _carrier(conn)
    p = await _policy(conn, carrier, valid_from=today - timedelta(days=360), valid_to=today - timedelta(days=1))
    assert await _policy_state(conn, p) == "EXPIRED"

    await insurance.extend_policy(conn, p, valid_to=today + timedelta(days=20), endorsement_number="END-7",
                                  endorsement_date=today, actor=ACTOR)

    assert await _policy_state(conn, p) == "EXPIRING"
    cambio = await conn.fetchrow(
        "SELECT previous_valid_to, new_valid_to, endorsement_number, changed_by::text FROM public.policy_term_changes WHERE policy_id = $1", p)
    assert (cambio["previous_valid_to"], cambio["new_valid_to"], cambio["endorsement_number"], cambio["changed_by"]) \
        == (today - timedelta(days=1), today + timedelta(days=20), "END-7", ACTOR)


async def test_S18_agregar_cuotas_las_numera_a_continuacion_y_respeta_la_vigencia(conexion_revertida):
    import pytest
    from app.services import insurance

    conn = conexion_revertida
    today = await _today(conn)
    carrier = await _carrier(conn)
    p = await _policy(conn, carrier, valid_from=today, valid_to=today + timedelta(days=150))
    await conn.execute(
        "INSERT INTO public.insurance_installments (policy_id, installment_number, amount_uf, due_date) "
        "VALUES ($1, 1, 2, $2)", p, today + timedelta(days=10))

    await insurance.append_installments(conn, p, count=2, amount_uf=3, first_due_date=today + timedelta(days=40), actor=ACTOR)
    numeros = [c["installment_number"] for c in await insurance.policy_installments(conn, p)]
    assert numeros == [1, 2, 3]

    with pytest.raises(ValueError, match="vigencia"):
        await insurance.append_installments(conn, p, count=6, amount_uf=3, first_due_date=today + timedelta(days=100), actor=ACTOR)
