"""Los documentos de una entidad, para el panel único (Cert 3, Entrega B 14/10).

Una consulta para empresa, conductor o equipo, con el estado de document_state_sql
(la única definición) y, por documento, si Operaciones ya lo pidió a Certificación.
El resumen sale de las mismas filas, así que la lista y los conteos no pueden diferir.
Los endpoints `…/compliance-records` de conductor y equipo devuelven estas mismas filas.
"""
from __future__ import annotations

from typing import Literal

from ..utils.document_storage import resolve_signed_url
from .fleet_compliance import compliance_record_columns_sql
from .vencimientos import por_vencer_predicate, vence_el_sql, vencido_predicate

EntityType = Literal["CARRIER", "DRIVER", "ASSET"]

_SQL = f"""
SELECT cr.id, cr.requirement_id, req.requirement_code, req.name, req.requirement_level,
       req.requires_file, req.expiration_policy,
       cr.status, cr.expiration_date, cr.file_url, cr.metadata,
       cr.is_manual_override, cr.updated_at,
       {vencido_predicate('cr')} AS is_expired,
       {por_vencer_predicate('cr')} AS is_expiring_soon,
       -- -infinity (falta la emisión o el período) no es una fecha.
       NULLIF({vence_el_sql('cr')}, '-infinity') AS vence_el,
       {compliance_record_columns_sql('cr')},
       cr.issue_date, cr.period_start,
       rq.id AS open_request_id
FROM public.compliance_records cr
JOIN public.compliance_requirements req ON req.id = cr.requirement_id
LEFT JOIN app.certification_requests rq
       ON rq.status = 'OPEN' AND rq.entity_type = cr.entity_type AND rq.entity_id = cr.entity_id
      AND rq.requirement_id = cr.requirement_id
WHERE cr.entity_id = $1 AND cr.entity_type = $2 AND cr.is_current = true
ORDER BY req.requirement_level, req.name
"""

_SUMMARY_KEYS = {"UP_TO_DATE": "up_to_date", "EXPIRING": "expiring", "OVERDUE": "overdue", "MISSING": "missing"}


async def entity_document_rows(db, supabase, entity_type: EntityType, entity_id: str) -> list[dict]:
    rows = [dict(r) for r in await db.fetch(_SQL, entity_id, entity_type)]
    for row in rows:
        row["file_url"] = resolve_signed_url(supabase, row["file_url"])
    return rows


async def entity_documents(db, supabase, entity_type: EntityType, entity_id: str) -> dict:
    rows = await entity_document_rows(db, supabase, entity_type, entity_id)
    summary = {k: 0 for k in _SUMMARY_KEYS.values()}
    for row in rows:
        key = _SUMMARY_KEYS.get(row["document_state"])
        if key:
            summary[key] += 1
    return {"rows": rows, "summary": summary}
