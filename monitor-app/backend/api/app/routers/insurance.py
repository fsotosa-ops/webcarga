"""Módulo Seguros — nuevo, independiente del módulo Empresas pero sincronizado
por RUT. Canónico para pólizas/cuotas/pagos: app.insurance_policies /
app.insurance_installments (poblados desde bronze.raw_insurance_vehicles por
el pipeline Mage — fuera de alcance de esta fase). Plan §3 / §1.5.
"""
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

from ..auth import get_current_user, get_supabase, require_admin, require_editor
from ..db import get_pool
from ..schemas.insurance import InstallmentPatchBody, PolicyPatchBody
from ..utils.stored_files import list_owner_files, upload_owner_file

router = APIRouter(prefix="/insurance", tags=["insurance"])


def _iso(v):
    if v is None:
        return None
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return v


def _num(v):
    return float(v) if v is not None else None


def _serialize_installment(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "policy_id": str(row["policy_id"]),
        "installment_number": row["installment_number"],
        "total_installments": row["total_installments"],
        "amount_uf": _num(row["amount_uf"]),
        "due_date": _iso(row["due_date"]),
        "status": row["status"],
        "paid_at": _iso(row["paid_at"]),
        "payment_url": row["payment_url"],
        "manual_override": row["manual_override"],
        "updated_at": _iso(row["updated_at"]),
    }


def _serialize_policy(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "transporter_id": str(row["transporter_id"]) if row["transporter_id"] else None,
        "rut": row["rut"],
        "contractor_name": row["contractor_name"],
        "client_group": row["client_group"],
        "company": row["company"],
        "policy_number": row["policy_number"],
        "endorsement": row["endorsement"],
        "coverage": row["coverage"],
        "plate": row["plate"],
        "policy_type": row["policy_type"],
        "valid_from": _iso(row["valid_from"]),
        "valid_to": _iso(row["valid_to"]),
        "payment_url": row["payment_url"],
        "file_url": row["file_url"],
        "storage_path": row["storage_path"],
        "updated_at": _iso(row["updated_at"]),
    }


# ── SUMMARY ───────────────────────────────────────────────────────

@router.get("/summary")
async def insurance_summary(
    q: str = Query(""),
    pool=Depends(get_pool),
    _=Depends(get_current_user),
):
    rows = await pool.fetch(
        """
        WITH inst AS (
            SELECT
                ii.policy_id, ii.status, ii.due_date, ii.amount_uf,
                (ii.status = 'vencida'
                 OR (ii.status = 'pendiente' AND ii.due_date < CURRENT_DATE)) AS is_overdue
            FROM app.insurance_installments ii
        ),
        rollup AS (
            SELECT
                ip.rut,
                count(DISTINCT ip.id)                                                 AS policies_count,
                min(i.due_date) FILTER (WHERE i.status = 'pendiente' AND NOT i.is_overdue) AS next_due_date,
                count(*) FILTER (WHERE i.is_overdue)                                  AS overdue_count,
                count(*) FILTER (WHERE i.status = 'pagada')                           AS paid_count,
                count(*)                                                              AS total_installments
            FROM app.insurance_policies ip
            LEFT JOIN inst i ON i.policy_id = ip.id
            GROUP BY ip.rut
        ),
        next_amount AS (
            SELECT DISTINCT ON (ip.rut) ip.rut, ii.amount_uf
            FROM app.insurance_policies ip
            JOIN app.insurance_installments ii ON ii.policy_id = ip.id
            WHERE ii.status = 'pendiente' AND ii.due_date >= CURRENT_DATE
            ORDER BY ip.rut, ii.due_date ASC
        )
        SELECT
            r.rut,
            COALESCE(t.business_name, (
                SELECT contractor_name FROM app.insurance_policies WHERE rut = r.rut LIMIT 1
            ))                                            AS business_name,
            t.id                                           AS transporter_id,
            r.policies_count,
            r.next_due_date,
            na.amount_uf                                   AS next_due_amount_uf,
            r.overdue_count,
            ROUND(100.0 * r.paid_count / NULLIF(r.total_installments, 0), 2) AS paid_pct,
            (r.overdue_count = 0)                           AS insurance_ok
        FROM rollup r
        LEFT JOIN app.transporters t ON t.rut = r.rut
        LEFT JOIN next_amount na ON na.rut = r.rut
        WHERE ($1 = '' OR t.business_name ILIKE '%' || $1 || '%' OR r.rut ILIKE '%' || $1 || '%')
        ORDER BY t.business_name ASC NULLS LAST, r.rut
        """,
        q,
    )

    data = []
    for r in rows:
        next_due = None
        if r["next_due_date"] is not None:
            next_due = {"date": _iso(r["next_due_date"]), "amount_uf": _num(r["next_due_amount_uf"])}
        data.append({
            "rut": r["rut"],
            "business_name": r["business_name"],
            "transporter_id": str(r["transporter_id"]) if r["transporter_id"] else None,
            "policies_count": r["policies_count"],
            "next_due": next_due,
            "overdue_count": r["overdue_count"],
            "paid_pct": _num(r["paid_pct"]),
            "insurance_ok": r["insurance_ok"],
        })
    return {"data": data}


# ── POR EMPRESA ───────────────────────────────────────────────────

@router.get("/transporters/{tid}")
async def get_transporter_insurance(
    tid: str, pool=Depends(get_pool), _=Depends(get_current_user),
):
    t = await pool.fetchrow("SELECT rut FROM app.transporters WHERE id = $1", tid)
    if not t:
        raise HTTPException(404, "Empresa no encontrada")

    policy_rows = await pool.fetch(
        "SELECT * FROM app.insurance_policies WHERE transporter_id = $1 OR rut = $2 "
        "ORDER BY valid_to DESC NULLS LAST, company",
        tid, t["rut"],
    )
    policies = [_serialize_policy(dict(p)) for p in policy_rows]
    if policies:
        policy_ids = [p["id"] for p in policy_rows]
        inst_rows = await pool.fetch(
            "SELECT * FROM app.insurance_installments WHERE policy_id = ANY($1::uuid[]) "
            "ORDER BY installment_number ASC, due_date ASC",
            policy_ids,
        )
        by_policy: dict[str, list] = {}
        for row in inst_rows:
            by_policy.setdefault(str(row["policy_id"]), []).append(_serialize_installment(dict(row)))
        for p in policies:
            p["installments"] = by_policy.get(p["id"], [])

    return {"rut": t["rut"], "transporter_id": tid, "policies": policies}


@router.get("/policies/{pid}")
async def get_policy(pid: str, pool=Depends(get_pool), _=Depends(get_current_user)):
    row = await pool.fetchrow("SELECT * FROM app.insurance_policies WHERE id = $1", pid)
    if not row:
        raise HTTPException(404, "Póliza no encontrada")

    inst_rows = await pool.fetch(
        "SELECT * FROM app.insurance_installments WHERE policy_id = $1 "
        "ORDER BY installment_number ASC, due_date ASC",
        pid,
    )
    policy = _serialize_policy(dict(row))
    policy["installments"] = [_serialize_installment(dict(r)) for r in inst_rows]
    return policy


# ── PATCH ─────────────────────────────────────────────────────────

@router.patch("/installments/{iid}")
async def patch_installment(
    iid: str, body: InstallmentPatchBody,
    pool=Depends(get_pool), user=Depends(require_admin),
):
    current = await pool.fetchrow("SELECT updated_at FROM app.insurance_installments WHERE id = $1", iid)
    if not current:
        raise HTTPException(404, "Cuota no encontrada")

    if body.expected_updated_at is not None and current["updated_at"] != body.expected_updated_at:
        raise HTTPException(409, "La cuota fue modificada por otro usuario; recargue e intente de nuevo")

    data = body.model_dump(exclude_none=True, exclude={"expected_updated_at"})
    if not data:
        raise HTTPException(422, "Ningún campo enviado")

    row = await pool.fetchrow(
        """
        UPDATE app.insurance_installments SET
            status          = COALESCE($2, status),
            paid_at         = COALESCE($3, paid_at),
            payment_url     = COALESCE($4, payment_url),
            manual_override = true,
            updated_by      = $5::uuid,
            updated_at      = NOW()
        WHERE id = $1
        RETURNING *
        """,
        iid, data.get("status"), data.get("paid_at"), data.get("payment_url"), user["sub"],
    )
    return _serialize_installment(dict(row))


@router.patch("/policies/{pid}")
async def patch_policy(
    pid: str, body: PolicyPatchBody,
    pool=Depends(get_pool), user=Depends(require_editor),
):
    data = body.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(422, "Ningún campo enviado")

    row = await pool.fetchrow(
        """
        UPDATE app.insurance_policies SET
            payment_url = COALESCE($2, payment_url),
            file_url    = COALESCE($3, file_url),
            policy_type = COALESCE($4, policy_type),
            updated_at  = NOW()
        WHERE id = $1
        RETURNING *
        """,
        pid, data.get("payment_url"), data.get("file_url"), data.get("policy_type"),
    )
    if not row:
        raise HTTPException(404, "Póliza no encontrada")
    return _serialize_policy(dict(row))


# ── ARCHIVOS ──────────────────────────────────────────────────────

@router.post("/policies/{pid}/file")
async def upload_policy_file(
    pid: str, file: UploadFile = File(...),
    pool=Depends(get_pool), supabase=Depends(get_supabase), user=Depends(require_editor),
):
    exists = await pool.fetchval("SELECT id FROM app.insurance_policies WHERE id = $1", pid)
    if not exists:
        raise HTTPException(404, "Póliza no encontrada")

    stored = await upload_owner_file(
        pool, supabase, owner_type="insurance_policy", owner_id=pid,
        key_prefix=f"insurance/{pid}", file=file, uploaded_by=user["sub"],
    )
    await pool.execute(
        "UPDATE app.insurance_policies SET storage_path = $1, updated_at = NOW() WHERE id = $2",
        stored["storage_path"], pid,
    )
    return stored


@router.get("/policies/{pid}/files")
async def list_policy_files(
    pid: str, pool=Depends(get_pool), supabase=Depends(get_supabase), _=Depends(get_current_user),
):
    exists = await pool.fetchval("SELECT id FROM app.insurance_policies WHERE id = $1", pid)
    if not exists:
        raise HTTPException(404, "Póliza no encontrada")
    return await list_owner_files(pool, supabase, owner_type="insurance_policy", owner_id=pid)
