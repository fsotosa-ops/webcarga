"""Lectura de Seguros: un solo lugar (Seguros, Entrega 1, 15/10).

Los estados de póliza, cuota y empresa los calcula la base en dos vistas
(`app.insurance_status`, `app.carrier_insurance_summary`; migración
20261020090000). Aquí solo se consultan: ningún router vuelve a escribir la
regla de "vencida" ni la de "peor estado de la empresa"."""
from __future__ import annotations

from ..utils.identity import rut_matches_sql
from .audit import log_change

# La entidad de auditoría de todo lo de una póliza (la póliza y sus cuotas):
# antes era CARRIER, a veces con el id de la póliza, y el rastro no llevaba a nada.
AUDIT_ENTITY = "INSURANCE_POLICY"

POLICY_STATES = ("EXPIRED", "EXPIRING", "VALID", "NO_DATES", "CANCELLED", "RENEWED")
# Filtros de la lista de Pólizas que no son un estado de la póliza.
POLICY_FILTERS = POLICY_STATES + ("UNPAID", "NO_FILE")
CARRIER_STATES = ("EXPIRED", "EXPIRING", "VALID", "NO_DATES", "NO_POLICY")
INSTALLMENT_FILTERS = ("OVERDUE", "DUE_30", "PAID", "ALL")


# ── Pólizas: una fila por póliza, con sus cifras de cuotas ────────────────────

_POLICIES_CTE = """
pol AS (
    SELECT s.policy_id AS id, s.carrier_id, c.business_name AS carrier_name, c.tax_id AS carrier_tax_id,
           s.insurance_company, s.policy_number, s.valid_from, s.valid_to, s.has_file,
           s.policy_state, s.expires_in_days,
           count(s.installment_id)                                                   AS installments_total,
           count(*) FILTER (WHERE s.installment_state = 'PAID')                      AS paid_installments,
           count(*) FILTER (WHERE s.installment_state IN ('OVERDUE', 'PENDING'))     AS unpaid_installments,
           count(*) FILTER (WHERE s.installment_state = 'OVERDUE')                   AS overdue_installments,
           min(s.due_date) FILTER (WHERE s.installment_state IN ('OVERDUE', 'PENDING')) AS next_due_date,
           bool_or(coalesce(s.outside_validity, false))                              AS has_outside_validity
    FROM app.insurance_status s
    JOIN public.carriers c ON c.id = s.carrier_id
    GROUP BY s.policy_id, s.carrier_id, c.business_name, c.tax_id, s.insurance_company, s.policy_number,
             s.valid_from, s.valid_to, s.has_file, s.policy_state, s.expires_in_days
)"""

_POLICY_FILTER_SQL = {
    **{s: f"policy_state = '{s}'" for s in POLICY_STATES},
    "UNPAID": "overdue_installments > 0",
    "NO_FILE": "NOT has_file AND policy_state <> 'CANCELLED'",
}

_POLICY_ORDER = """
    CASE policy_state WHEN 'EXPIRED' THEN 1 WHEN 'NO_DATES' THEN 2 WHEN 'EXPIRING' THEN 3
                      WHEN 'VALID' THEN 4 WHEN 'RENEWED' THEN 6 ELSE 5 END,
    overdue_installments DESC, carrier_name, insurance_company"""


def _search(q: str, params: list, name_col: str, rut_col: str, extra: tuple[str, ...] = ()) -> str:
    params.append(q)
    n = f"${len(params)}"
    cols = " OR ".join([f"{name_col} ILIKE '%' || {n} || '%'", rut_matches_sql(rut_col, n),
                        *(f"{c} ILIKE '%' || {n} || '%'" for c in extra)])
    return f"({cols})"


async def list_policies(pool, *, state: str = "", q: str = "", carrier_id: str | None = None,
                        page: int = 1, limit: int = 50) -> dict:
    params: list = []
    where: list[str] = []
    if carrier_id:
        params.append(carrier_id)
        where.append(f"carrier_id = ${len(params)}")
    if q:
        where.append(_search(q, params, "carrier_name", "carrier_tax_id", ("insurance_company", "policy_number")))
    base_where = ("WHERE " + " AND ".join(where)) if where else ""
    filtro = _POLICY_FILTER_SQL.get(state)
    rows_where = " AND ".join(x for x in (base_where.removeprefix("WHERE ") if base_where else "", filtro) if x)
    rows_where = f"WHERE {rows_where}" if rows_where else ""
    n = len(params)
    rows = await pool.fetch(
        f"WITH {_POLICIES_CTE} SELECT * FROM pol {rows_where} ORDER BY {_POLICY_ORDER} "
        f"LIMIT ${n + 1} OFFSET ${n + 2}",
        *params, limit, (page - 1) * limit,
    )
    facets = await pool.fetchrow(
        f"WITH {_POLICIES_CTE} SELECT count(*) AS total, "
        + ", ".join(f"count(*) FILTER (WHERE {sql}) AS \"{k}\"" for k, sql in _POLICY_FILTER_SQL.items())
        + f" FROM pol {base_where}",
        *params,
    )
    facets = dict(facets)
    return {"group_by": "policy", "data": [dict(r) for r in rows],
            "count": facets.get(state, facets["total"]) if state else facets["total"],
            "page": page, "limit": limit, "facets": facets}


# ── Empresas: el peor estado de sus pólizas (incluye las activas sin póliza) ──

_CARRIERS_CTE = """
emp AS (
    SELECT c.id AS carrier_id, c.business_name AS carrier_name, c.tax_id AS carrier_tax_id, c.operational_status,
           coalesce(s.policies, 0) AS policies,
           coalesce(s.worst_state, 'NO_POLICY') AS worst_state,
           coalesce(s.unpaid_installments, 0) AS unpaid_installments,
           coalesce(s.overdue_installments, 0) AS overdue_installments,
           s.next_due_date, s.insurance_alert
    FROM public.carriers c
    LEFT JOIN app.carrier_insurance_summary s ON s.carrier_id = c.id
    WHERE c.operational_status = 'ACTIVE' OR s.carrier_id IS NOT NULL
)"""

_CARRIER_ORDER = """
    CASE worst_state WHEN 'EXPIRED' THEN 1 WHEN 'NO_POLICY' THEN 2 WHEN 'NO_DATES' THEN 3
                     WHEN 'EXPIRING' THEN 4 ELSE 5 END,
    overdue_installments DESC, carrier_name"""


async def list_carriers(pool, *, state: str = "", q: str = "", page: int = 1, limit: int = 50) -> dict:
    params: list = []
    where = [_search(q, params, "carrier_name", "carrier_tax_id")] if q else []
    base_where = ("WHERE " + " AND ".join(where)) if where else ""
    rows_where = base_where
    if state in CARRIER_STATES:
        params.append(state)
        rows_where = ("WHERE " + " AND ".join([*where, f"worst_state = ${len(params)}"]))
    n = len(params)
    rows = await pool.fetch(
        f"WITH {_CARRIERS_CTE} SELECT * FROM emp {rows_where} ORDER BY {_CARRIER_ORDER} "
        f"LIMIT ${n + 1} OFFSET ${n + 2}",
        *params, limit, (page - 1) * limit,
    )
    search_params = params[: len(where)]
    facets = dict(await pool.fetchrow(
        f"WITH {_CARRIERS_CTE} SELECT count(*) AS total, "
        + ", ".join(f"count(*) FILTER (WHERE worst_state = '{s}') AS \"{s}\"" for s in CARRIER_STATES)
        + f" FROM emp {base_where}",
        *search_params,
    ))
    return {"group_by": "carrier", "data": [dict(r) for r in rows],
            "count": facets.get(state, facets["total"]) if state else facets["total"],
            "page": page, "limit": limit, "facets": facets}


# ── Cuotas: la cola de pagos ───────────────────────────────────────────────────

_INSTALLMENT_FILTER_SQL = {
    "OVERDUE": "installment_state = 'OVERDUE'",
    "DUE_30": "installment_state = 'PENDING' AND due_in_days <= 30",
    "PAID": "installment_state = 'PAID'",
    "ALL": "true",
}

_INSTALLMENTS_CTE = """
cuo AS (
    SELECT s.installment_id AS id, s.policy_id, s.carrier_id, c.business_name AS carrier_name,
           c.tax_id AS carrier_tax_id, s.insurance_company, s.policy_number,
           s.installment_number, s.installments_total, s.due_date, s.due_in_days, s.amount_uf,
           s.installment_state, s.paid, s.paid_on, s.paid_by, s.outside_validity
    FROM app.insurance_status s
    JOIN public.carriers c ON c.id = s.carrier_id
    WHERE s.installment_id IS NOT NULL AND s.policy_state <> 'CANCELLED'
)"""


async def list_installments(pool, *, state: str = "OVERDUE", q: str = "", page: int = 1, limit: int = 100) -> dict:
    params: list = []
    where = [_search(q, params, "carrier_name", "carrier_tax_id", ("insurance_company", "policy_number"))] if q else []
    base_where = ("WHERE " + " AND ".join(where)) if where else ""
    rows_where = "WHERE " + " AND ".join([*where, _INSTALLMENT_FILTER_SQL.get(state, "true")])
    order = "due_date DESC" if state == "PAID" else "due_date ASC"
    n = len(params)
    rows = await pool.fetch(
        f"WITH {_INSTALLMENTS_CTE} SELECT * FROM cuo {rows_where} ORDER BY {order}, carrier_name, installment_number "
        f"LIMIT ${n + 1} OFFSET ${n + 2}",
        *params, limit, (page - 1) * limit,
    )
    facets = dict(await pool.fetchrow(
        f"WITH {_INSTALLMENTS_CTE} SELECT "
        + ", ".join(f"count(*) FILTER (WHERE {sql}) AS \"{k}\"" for k, sql in _INSTALLMENT_FILTER_SQL.items())
        + f" FROM cuo {base_where}",
        *params,
    ))
    return {"data": [dict(r) for r in rows], "count": facets.get(state, 0),
            "page": page, "limit": limit, "facets": facets}


async def policy_installments(conn, policy_id: str) -> list[dict]:
    rows = await conn.fetch(
        "SELECT installment_id AS id, installment_number, installments_total, amount_uf, due_date, due_in_days, "
        "installment_state, paid, paid_on, paid_by, outside_validity "
        "FROM app.insurance_status WHERE policy_id = $1 AND installment_id IS NOT NULL ORDER BY installment_number",
        policy_id,
    )
    return [dict(r) for r in rows]


async def policy_state(conn, policy_id: str) -> dict | None:
    row = await conn.fetchrow(
        "SELECT DISTINCT policy_state, expires_in_days FROM app.insurance_status WHERE policy_id = $1", policy_id,
    )
    return dict(row) if row else None


async def carrier_policies(pool, carrier_id: str) -> list[dict]:
    """Las pólizas de una empresa (pestaña Seguros de la ficha): la misma lista de Pólizas."""
    return (await list_policies(pool, carrier_id=carrier_id, limit=200))["data"]


# ── Escrituras: el pago es un hecho (si, cuándo, quién) ───────────────────────

async def pay_installments(conn, ids: list[str], *, paid_on, actor: str) -> dict:
    """Marca pagadas las cuotas impagas de `ids`. Las ya pagadas (o repetidas)
    vuelven en `errors` sin pisar su fecha ni quién. Una auditoría por cuota,
    contra su póliza."""
    paid, errors, seen = [], [], set()
    for installment_id in ids:
        if installment_id in seen:
            errors.append({"id": installment_id, "error": "Repetida en el pedido"})
            continue
        seen.add(installment_id)
        row = await conn.fetchrow(
            "UPDATE public.insurance_installments SET paid = true, paid_on = $2, paid_by = $3::uuid, updated_at = now() "
            "WHERE id = $1 AND NOT paid RETURNING policy_id",
            installment_id, paid_on, actor,
        )
        if row is None:
            exists = await conn.fetchval("SELECT paid FROM public.insurance_installments WHERE id = $1", installment_id)
            errors.append({"id": installment_id,
                           "error": "No existe" if exists is None else "Ya estaba pagada"})
            continue
        await log_change(conn, actor=actor, entity_type=AUDIT_ENTITY, entity_id=row["policy_id"],
                         action="update", field="paid", old_value=None,
                         new_value={"installment_id": str(installment_id), "paid_on": paid_on})
        paid.append(installment_id)
    return {"paid": paid, "errors": errors}


async def unpay_installments(conn, ids: list[str], *, actor: str) -> dict:
    """Deshace un pago registrado por error: vuelve a impaga, sin fecha ni quién."""
    unpaid, errors = [], []
    for installment_id in ids:
        # El pago que se deshace queda en la auditoría: cuándo y quién (revisión final E1).
        row = await conn.fetchrow(
            "WITH antes AS (SELECT id, paid_on, paid_by FROM public.insurance_installments WHERE id = $1 AND paid FOR UPDATE) "
            "UPDATE public.insurance_installments i SET paid = false, paid_on = NULL, paid_by = NULL, updated_at = now() "
            "FROM antes WHERE i.id = antes.id RETURNING i.policy_id, antes.paid_on, antes.paid_by",
            installment_id,
        )
        if row is None:
            errors.append({"id": installment_id, "error": "No estaba pagada"})
            continue
        await log_change(conn, actor=actor, entity_type=AUDIT_ENTITY, entity_id=row["policy_id"],
                         action="update", field="paid",
                         old_value={"installment_id": str(installment_id), "paid_on": row["paid_on"],
                                    "paid_by": str(row["paid_by"]) if row["paid_by"] else None},
                         new_value=None)
        unpaid.append(installment_id)
    return {"unpaid": unpaid, "errors": errors}


async def cancel_policy(conn, policy_id: str, *, reason: str, actor: str) -> None:
    updated = await conn.fetchval(
        "UPDATE public.insurance_policies SET cancelled_at = now(), cancelled_reason = $2, updated_at = now() "
        "WHERE id = $1 AND cancelled_at IS NULL RETURNING id",
        policy_id, reason,
    )
    if updated is None:
        raise LookupError("La póliza no existe o ya estaba cancelada")
    await log_change(conn, actor=actor, entity_type=AUDIT_ENTITY, entity_id=policy_id,
                     action="update", field="cancelled_at", new_value={"reason": reason})


def schedule_outside_validity(due_dates: list, valid_from, valid_to) -> list:
    """Las fechas del calendario que caen fuera de la vigencia de la póliza."""
    return [d for d in due_dates if (valid_from and d < valid_from) or (valid_to and d > valid_to)]



# ── Renovar y extender (Seguros E2; los dos habilitados, a validar con Pablo) ──

async def link_renewal(conn, previous_id: str, successor_id: str, *, actor: str) -> None:
    """Enlaza una póliza ya cargada como sucesora de otra (las 6 renovaciones de
    la carga inicial): la anterior pasa a RENEWED. Siempre lo confirma una persona."""
    if previous_id == successor_id:
        raise ValueError("Una póliza no se renueva a sí misma")
    pares = await conn.fetch(
        "SELECT id, carrier_id, renews_policy_id FROM public.insurance_policies WHERE id = ANY($1::uuid[])",
        [previous_id, successor_id],
    )
    if len(pares) != 2:
        raise LookupError("Póliza no encontrada")
    if len({r["carrier_id"] for r in pares}) != 1:
        raise ValueError("Las dos pólizas tienen que ser de la misma empresa")
    if await conn.fetchval("SELECT 1 FROM public.insurance_policies WHERE renews_policy_id = $1", previous_id):
        raise ValueError("Esta póliza ya fue renovada por otra")
    if next(r for r in pares if str(r["id"]) == str(successor_id))["renews_policy_id"] is not None:
        raise ValueError("La póliza nueva ya renueva a otra")
    await conn.execute(
        "UPDATE public.insurance_policies SET renews_policy_id = $2, updated_at = now() WHERE id = $1",
        successor_id, previous_id,
    )
    await log_change(conn, actor=actor, entity_type=AUDIT_ENTITY, entity_id=previous_id,
                     action="update", field="renewed_by", new_value=str(successor_id))


async def renew_policy(conn, previous_id: str, *, valid_from, valid_to, policy_number: str | None,
                       actor: str, insurance_company: str | None = None) -> str:
    """Crea la póliza que renueva a otra, con sus datos precargados."""
    prev = await conn.fetchrow(
        "SELECT carrier_id, insurance_company, policy_number, has_endorsement, endorsement_number, external_portal_url "
        "FROM public.insurance_policies WHERE id = $1", previous_id,
    )
    if prev is None:
        raise LookupError("Póliza no encontrada")
    if await conn.fetchval("SELECT 1 FROM public.insurance_policies WHERE renews_policy_id = $1", previous_id):
        raise ValueError("Esta póliza ya fue renovada por otra")
    new_id = await conn.fetchval(
        "INSERT INTO public.insurance_policies (carrier_id, insurance_company, policy_number, valid_from, valid_to, "
        "external_portal_url, renews_policy_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
        prev["carrier_id"], insurance_company or prev["insurance_company"], policy_number, valid_from, valid_to,
        prev["external_portal_url"], previous_id,
    )
    await conn.execute(
        "INSERT INTO public.policy_coverages (policy_id, coverage_type_id) "
        "SELECT $1, coverage_type_id FROM public.policy_coverages WHERE policy_id = $2", new_id, previous_id,
    )
    await conn.execute(
        "INSERT INTO public.policy_assets (policy_id, asset_id) "
        "SELECT $1, asset_id FROM public.policy_assets WHERE policy_id = $2", new_id, previous_id,
    )
    await log_change(conn, actor=actor, entity_type=AUDIT_ENTITY, entity_id=new_id,
                     action="create", field="renews_policy_id", new_value=str(previous_id))
    return new_id


async def renewal_candidates(conn, policy_id: str) -> list[dict]:
    """Otras pólizas de la misma empresa que empiezan dentro de los 30 días del fin
    de esta y no renuevan ya a otra: la ficha propone el enlace, no lo hace."""
    rows = await conn.fetch(
        """
        SELECT o.id, o.insurance_company, o.policy_number, o.valid_from, o.valid_to
        FROM public.insurance_policies p
        JOIN public.insurance_policies o ON o.carrier_id = p.carrier_id AND o.id <> p.id
        WHERE p.id = $1 AND p.valid_to IS NOT NULL AND o.valid_from IS NOT NULL
          AND o.valid_from BETWEEN p.valid_to - 30 AND p.valid_to + 30
          AND o.renews_policy_id IS NULL AND o.cancelled_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM public.insurance_policies x WHERE x.renews_policy_id = p.id)
        ORDER BY abs(o.valid_from - p.valid_to), o.valid_from
        """,
        policy_id,
    )
    return [dict(r) for r in rows]


async def extend_policy(conn, policy_id: str, *, valid_to, endorsement_number: str | None, endorsement_date,
                        actor: str) -> None:
    """Prórroga por endoso: nueva fecha de término, guardada en el historial."""
    prev = await conn.fetchrow("SELECT valid_from, valid_to FROM public.insurance_policies WHERE id = $1 FOR UPDATE", policy_id)
    if prev is None:
        raise LookupError("Póliza no encontrada")
    if prev["valid_to"] is not None and valid_to <= prev["valid_to"]:
        raise ValueError("La nueva fecha de término tiene que ser posterior a la actual")
    if prev["valid_from"] is not None and valid_to <= prev["valid_from"]:
        raise ValueError("La nueva fecha de término tiene que ser posterior al inicio de la vigencia")
    await conn.execute("UPDATE public.insurance_policies SET valid_to = $2, updated_at = now() WHERE id = $1", policy_id, valid_to)
    await conn.execute(
        "INSERT INTO public.policy_term_changes (policy_id, previous_valid_to, new_valid_to, endorsement_number, "
        "endorsement_date, changed_by) VALUES ($1, $2, $3, $4, $5, $6::uuid)",
        policy_id, prev["valid_to"], valid_to, endorsement_number, endorsement_date, actor,
    )
    await log_change(conn, actor=actor, entity_type=AUDIT_ENTITY, entity_id=policy_id, action="update",
                     field="valid_to", old_value=prev["valid_to"],
                     new_value={"valid_to": valid_to, "endorsement_number": endorsement_number})


async def term_changes(conn, policy_id: str) -> list[dict]:
    rows = await conn.fetch(
        "SELECT previous_valid_to, new_valid_to, endorsement_number, endorsement_date, changed_at "
        "FROM public.policy_term_changes WHERE policy_id = $1 ORDER BY changed_at DESC", policy_id,
    )
    return [dict(r) for r in rows]


def _monthly(first, n):
    import calendar
    from datetime import date
    out = []
    for i in range(n):
        idx = first.month - 1 + i
        y, m = first.year + idx // 12, idx % 12 + 1
        out.append(date(y, m, min(first.day, calendar.monthrange(y, m)[1])))
    return out


async def append_installments(conn, policy_id: str, *, count: int, amount_uf, first_due_date, actor: str) -> list[dict]:
    """Cuotas nuevas a continuación de las existentes, todas dentro de la vigencia:
    el calendario de una póliza nueva (desde la cuota 1) o las cuotas de una
    extensión. Una sola forma de crear cuotas."""
    p = await conn.fetchrow("SELECT valid_from, valid_to FROM public.insurance_policies WHERE id = $1", policy_id)
    if p is None:
        raise LookupError("Póliza no encontrada")
    fechas = _monthly(first_due_date, count)
    fuera = schedule_outside_validity(fechas, p["valid_from"], p["valid_to"])
    if fuera:
        raise ValueError(f"{len(fuera)} cuota(s) caen fuera de la vigencia de la póliza "
                         f"(primera: {fuera[0].strftime('%d/%m/%Y')})")
    ultimo = await conn.fetchval(
        "SELECT coalesce(max(installment_number), 0) FROM public.insurance_installments WHERE policy_id = $1", policy_id)
    for i, d in enumerate(fechas):
        await conn.execute(
            "INSERT INTO public.insurance_installments (policy_id, installment_number, amount_uf, due_date) "
            "VALUES ($1, $2, $3, $4)", policy_id, ultimo + i + 1, amount_uf, d,
        )
    await log_change(conn, actor=actor, entity_type=AUDIT_ENTITY, entity_id=policy_id, action="create",
                     field="installments_appended", new_value=count)
    return await policy_installments(conn, policy_id)
