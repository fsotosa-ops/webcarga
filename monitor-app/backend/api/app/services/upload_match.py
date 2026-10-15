"""La revisión de una carga en lote: a qué registro va cada archivo (Entrega D, 15/10).

Una sola forma de subir documentos, con el contexto que haya:
- desde Pendientes, el tipo (`requirement_id`);
- desde la ficha de una empresa, la empresa (`carrier_id`);
- desde Por asignar, nada.

El contexto acota el reconocedor único (`document_matcher.match_document`), y lo
propuesto se traduce a los registros que se DEBEN (mismo alcance y definición que
Pendientes): nada se propone sobre un documento vigente. Un archivo de alguien al
día queda sin asignar y va a Por asignar, donde rige la regla de la renovación.
No escribe nada: subir es otro paso.
"""
from __future__ import annotations

import json

from .document_matcher import (
    RequirementAlias, classify_match, match_document, prefer_identifiers, reason_of, resolve_collisions,
)
from .fleet_compliance import pending_base_ctes
from .matcher_io import cargar_catalogo, cargar_universo
from .vencimientos import PENDING_STATES
from .vigencia import regla_base_json_sql

# Los registros que se deben, con lo necesario para nombrarlos. `$3`/`$4` acotan
# por tipo y por empresa cuando el contexto los da.
_OWED_SQL = f"""
WITH {pending_base_ctes('$1')}
SELECT r.id::text AS record_id, r.entity_type, r.entity_id::text AS entity_id,
       r.requirement_id::text AS requirement_id,
       COALESCE(r.subject_name, c.business_name) AS subject_label, c.business_name AS carrier_name
FROM resolved r
JOIN public.carriers c ON c.id = r.resolved_carrier_id
WHERE r.in_scope AND r.document_state = ANY($2::text[])
  AND ($3::uuid IS NULL OR r.requirement_id = $3::uuid)
  AND ($4::uuid IS NULL OR r.resolved_carrier_id = $4::uuid)
"""

_REQUIREMENTS_SQL = f"""
SELECT req.id::text AS id, req.name AS label, req.requirement_code, req.target_entity, req.expiration_policy,
       {regla_base_json_sql('req')} AS vigencia
FROM public.compliance_requirements req
WHERE req.id = ANY($1::uuid[])
"""

_STATUS = {"AUTO": "matched", "SUGGESTED": "matched", "AMBIGUOUS": "ambiguous", "UNMATCHED": "unmatched"}


async def match_files(conn, file_names: list[str], *, requirement_id: str | None = None,
                      carrier_id: str | None = None) -> dict:
    declared = None
    if requirement_id:
        req = await conn.fetchrow(
            "SELECT id::text, target_entity, name FROM public.compliance_requirements WHERE id = $1::uuid",
            requirement_id)
        declared = RequirementAlias(req["id"], req["target_entity"], req["name"]) if req else None
    catalog = await cargar_catalogo(conn)
    universe = await cargar_universo(conn, carrier_id)
    owed = {(r["entity_type"], r["entity_id"], r["requirement_id"]): dict(r)
            for r in await conn.fetch(_OWED_SQL, "falta", list(PENDING_STATES), requirement_id, carrier_id)}

    def key(c):
        return (c.entity_type, c.entity_id, c.requirement_id)

    files, tops = [], []
    for name in file_names:
        found = match_document(file_name=name, catalog=catalog, universe=universe, declared_requirement=declared)
        # Acotar DESPUÉS del motor a quienes deben, y recién ahí preferir identificadores:
        # el RUT de alguien que no lo debe no puede borrar a quien sí.
        cands = prefer_identifiers([c for c in found if key(c) in owed])
        status = _STATUS[classify_match(cands)]
        top = cands[0] if status == "matched" else None
        tops.append(top)
        rec = owed[key(top)] if top else None
        files.append({
            "file_name": name, "status": status,
            "record_id": rec["record_id"] if rec else None,
            "requirement_id": top.requirement_id if top else None,
            "subject_label": rec["subject_label"] if rec else None,
            "carrier_name": rec["carrier_name"] if rec else None,
            "reason": reason_of(top) if top else None,
            "confidence": top.confidence if top else None,
            "candidates": [{**_candidate(owed[key(c)]), "confidence": c.confidence} for c in cands[:5]],
            "collision": None, "collision_subject_label": None,
        })

    # Varios archivos al mismo registro: queda solo el estrictamente más fuerte (P23).
    for i, kind in resolve_collisions(tops).items():
        label = owed[key(tops[i])]["subject_label"]
        files[i].update(status="ambiguous", record_id=None, requirement_id=None, subject_label=None,
                        carrier_name=None, reason=None, confidence=None,
                        collision=kind, collision_subject_label=label)

    ids = sorted({c["requirement_id"] for f in files for c in f["candidates"]} | ({requirement_id} if requirement_id else set()))
    requirements = {}
    for r in await conn.fetch(_REQUIREMENTS_SQL, ids):
        row = dict(r)
        # jsonb llega como texto: el pool no registra un codec para jsonb.
        row["vigencia"] = json.loads(row["vigencia"]) if row["vigencia"] is not None else None
        requirements[row.pop("id")] = row
    return {"files": files, "requirements": requirements}


def _candidate(rec: dict) -> dict:
    return {"record_id": rec["record_id"], "requirement_id": rec["requirement_id"],
            "subject_label": rec["subject_label"], "carrier_name": rec["carrier_name"]}
