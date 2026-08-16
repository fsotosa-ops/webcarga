from fastapi import APIRouter, Depends, HTTPException, Query

from ..auth import require_admin
from ..cache import invalidate_trips_meta_cache
from ..db import get_pool
from ..schemas.status_taxonomy import StatusTaxonomyBody, StatusTaxonomyPatch, VALID_DOMAINS

router = APIRouter(prefix="/config/taxonomies", tags=["config"])

_FIELDS = 'id::text, domain, label, bg_color, text_color, group_id AS "group", sort_order, active'


@router.get("")
async def list_taxonomies(domain: str = Query(...), pool=Depends(get_pool)):
    if domain not in VALID_DOMAINS:
        raise HTTPException(422, f"domain debe ser uno de {VALID_DOMAINS}")
    rows = await pool.fetch(
        f"SELECT {_FIELDS} FROM app.status_taxonomies WHERE domain = $1 AND active = true ORDER BY sort_order, created_at",
        domain,
    )
    return [dict(r) for r in rows]


@router.post("")
async def create_taxonomy(body: StatusTaxonomyBody, pool=Depends(get_pool), _=Depends(require_admin)):
    row = await pool.fetchrow(
        f"""INSERT INTO app.status_taxonomies (domain, label, bg_color, text_color, sort_order, group_id)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING {_FIELDS}""",
        body.domain, body.label, body.bg_color, body.text_color, body.sort_order, body.group_id,
    )
    await invalidate_trips_meta_cache()
    return dict(row)


@router.patch("/{taxonomy_id}")
async def patch_taxonomy(
    taxonomy_id: str, body: StatusTaxonomyPatch, pool=Depends(get_pool), _=Depends(require_admin),
):
    existing = await pool.fetchrow("SELECT id FROM app.status_taxonomies WHERE id = $1", taxonomy_id)
    if not existing:
        raise HTTPException(404, "No encontrado")

    data = body.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(422, "Ningún campo enviado")

    sets, vals = [], [taxonomy_id]
    for field, value in data.items():
        vals.append(value)
        sets.append(f"{field} = ${len(vals)}")
    sets.append("updated_at = NOW()")

    await pool.execute(f"UPDATE app.status_taxonomies SET {', '.join(sets)} WHERE id = $1", *vals)
    row = await pool.fetchrow(f"SELECT {_FIELDS} FROM app.status_taxonomies WHERE id = $1", taxonomy_id)
    await invalidate_trips_meta_cache()
    return dict(row)


@router.delete("/{taxonomy_id}")
async def deactivate_taxonomy(taxonomy_id: str, pool=Depends(get_pool), _=Depends(require_admin)):
    result = await pool.execute(
        "UPDATE app.status_taxonomies SET active = false, updated_at = NOW() WHERE id = $1", taxonomy_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(404, "No encontrado")
    await invalidate_trips_meta_cache()
    # Cuántas condiciones de documento siguen apuntando a este valor. El
    # borrado es lógico, así que la regla NO se rompe — pero la casilla
    # desaparece de la pantalla y la condición se ve como "0 marcas" sin serlo.
    # Se cuentan también las condiciones inactivas: la pantalla de Condiciones
    # las lista igual (GET /compliance-requirements no filtra por is_active),
    # así que quien vaya a revisar las va a encontrar.
    en_uso = await pool.fetchval(
        """
        SELECT count(*) FROM public.compliance_requirements
         WHERE $1::uuid = ANY(applies_to_fleet_service_type_ids)
        """,
        taxonomy_id,
    )
    return {"desactivado": True, "en_uso_por": en_uso or 0}
