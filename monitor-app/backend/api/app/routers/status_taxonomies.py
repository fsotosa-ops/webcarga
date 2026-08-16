from fastapi import APIRouter, Depends, HTTPException, Query

from ..auth import require_admin
from ..cache import invalidate_trips_meta_cache
from ..db import get_pool
from ..schemas.status_taxonomy import StatusTaxonomyBody, StatusTaxonomyPatch
from ..services.reordenamiento import TAXONOMIAS, MovimientoBody, mover_una_posicion
from ..services.revisiones import SECCION_DE_TAXONOMIA, registrar_revision

router = APIRouter(prefix="/config/taxonomies", tags=["config"])

# `code` viaja pero NO se crea ni se edita desde la app: es el identificador
# estable con el que OTRAS tablas apuntan a un valor del catalogo
# (carriers.management_types, compliance_requirements.applies_to_management_types),
# y darle un codigo a un vocabulario es una decision de esquema, no un campo de
# formulario. Ver 20260816090000_status_taxonomies_code.sql.
_FIELDS = (
    'id::text, domain, code, label, bg_color, text_color, '
    'group_id AS "group", sort_order, active'
)

# El mismo orden contra el que se mueve (TAXONOMIAS.orden). Si divergieran, la
# lista que se ve y la lista contra la que se mueve serian dos.
_SQL_LISTA = (
    f"SELECT {_FIELDS} FROM app.status_taxonomies "
    f"WHERE domain = $1 AND active = true ORDER BY {TAXONOMIAS.orden}"
)


async def _exigir_dominio_conocido(domain: str, pool) -> None:
    """Un dominio existe si la tabla tiene filas con ese valor.

    Antes habia un set escrito a mano aca y un union en TypeScript, y bastaba
    con extender uno solo para que media pantalla devolviera 422 -- fue
    exactamente lo que paso con WEBCARGA_OPERATION_TYPE. Ahora la fuente de
    verdad es la tabla: para sumar un vocabulario nuevo se siembra su primera
    fila en una migracion, que es donde corresponde decidirlo."""
    existe = await pool.fetchval(
        "SELECT EXISTS (SELECT 1 FROM app.status_taxonomies WHERE domain = $1)", domain,
    )
    if not existe:
        conocidos = await pool.fetch(
            "SELECT DISTINCT domain FROM app.status_taxonomies ORDER BY domain"
        )
        nombres = ", ".join(r["domain"] for r in conocidos)
        raise HTTPException(422, f"domain desconocido: {domain}. Los que existen son: {nombres}")


@router.get("")
async def list_taxonomies(domain: str = Query(...), pool=Depends(get_pool)):
    await _exigir_dominio_conocido(domain, pool)
    return [dict(r) for r in await pool.fetch(_SQL_LISTA, domain)]


@router.post("")
async def create_taxonomy(body: StatusTaxonomyBody, pool=Depends(get_pool), usuario=Depends(require_admin)):
    await _exigir_dominio_conocido(body.domain, pool)
    row = await pool.fetchrow(
        f"""INSERT INTO app.status_taxonomies (domain, label, bg_color, text_color, sort_order, group_id)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING {_FIELDS}""",
        body.domain, body.label, body.bg_color, body.text_color, body.sort_order, body.group_id,
    )
    await _registrar(pool, body.domain, row["id"], usuario)
    await invalidate_trips_meta_cache()
    return dict(row)


@router.patch("/{taxonomy_id}")
async def patch_taxonomy(
    taxonomy_id: str, body: StatusTaxonomyPatch, pool=Depends(get_pool),
    usuario=Depends(require_admin),
):
    existing = await pool.fetchrow(
        "SELECT id, domain FROM app.status_taxonomies WHERE id = $1", taxonomy_id)
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
    await _registrar(pool, existing["domain"], taxonomy_id, usuario)
    await invalidate_trips_meta_cache()
    return dict(row)


async def _registrar(pool, vocabulario: str, taxonomy_id, usuario) -> None:
    """GUARDAR CUENTA COMO REVISAR.

    Este endpoint es generico —sirve a los cinco vocabularios— y no sabe en que
    pantalla esta parado quien edita: lo unico que tiene es el `domain` de la
    fila, y de ahi sale la seccion. Un vocabulario que no este declarado como
    revisable simplemente no registra nada."""
    destino = SECCION_DE_TAXONOMIA.get(vocabulario)
    if not destino:
        return
    dominio, seccion = destino
    await registrar_revision(pool, dominio, seccion, str(taxonomy_id), usuario["sub"])


@router.post("/{taxonomy_id}/move")
async def move_taxonomy(
    taxonomy_id: str,
    body: MovimientoBody,
    pool=Depends(get_pool),
    _=Depends(require_admin),
):
    """Sube o baja un valor una posicion dentro de SU dominio, en una sola
    transaccion. Devuelve el dominio completo ya ordenado."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            await mover_una_posicion(conn, TAXONOMIAS, taxonomy_id, body.direction)
    dominio = await pool.fetchval(
        "SELECT domain FROM app.status_taxonomies WHERE id = $1::uuid", taxonomy_id
    )
    await invalidate_trips_meta_cache()
    return [dict(r) for r in await pool.fetch(_SQL_LISTA, dominio)]


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
