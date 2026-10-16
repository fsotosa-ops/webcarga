"""public.shippers — catálogo de clientes/shippers reales. GET es de solo
lectura desde H2.6 (selector del generador de carga en Configuración); POST
se suma en la Ronda 26 (Fase 2) para que TripAssignDialog pueda crear un
shipper nuevo al vuelo cuando el operador tipea un cliente que no existe
todavía — antes client_name era texto libre sin ningún vínculo real.

Directorio › Clientes (Configuración, Parte 3) suma los conteos de cada cliente,
su detalle y su edición. Los nombres del TMS de un cliente no se repiten acá:
salen de GET /tms-clients?shipper_id=."""
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict

from ..authz import Permission, require
from ..db import get_pool
from ..services.audit import log_change

router = APIRouter(prefix="/shippers", tags=["shippers"])

# Una fila por cliente con lo que la lista y la ficha muestran. Los viajes son
# los planificados en los últimos 30 días, en fecha de Chile.
_SQL_CLIENTES = """
SELECT sh.id, sh.name, sh.status,
       (SELECT count(*) FROM app.tms_client_shippers m WHERE m.shipper_id = sh.id) AS tms_names,
       lug.locations, lug.origins,
       (SELECT count(*) FROM public.carrier_shippers cs
         WHERE cs.shipper_id = sh.id AND cs.status = 'ACTIVE') AS carriers,
       (SELECT count(*) FROM app.trips t
         WHERE t.shipper_id = sh.id AND t.planning_date > public.hoy_chile() - 30) AS trips_30d
FROM public.shippers sh
CROSS JOIN LATERAL (
    SELECT count(*) AS locations, count(*) FILTER (WHERE l.is_origin) AS origins
    FROM public.locations l
    WHERE l.entity_type = 'SHIPPER' AND l.entity_id = sh.id AND l.operational_status = 'ACTIVE'
) lug
"""


class ShipperCreateBody(BaseModel):
    name: str


class ShipperPatchBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = None
    status: Literal["ACTIVE", "INACTIVE"] | None = None


def _nombre_limpio(name: str) -> str:
    limpio = name.strip()
    if not limpio:
        raise HTTPException(422, "El nombre no puede estar vacío")
    return limpio


def _es_nombre_repetido(e: Exception) -> bool:
    return "shippers_name_key" in str(e) or "shippers_name_ci_key" in str(e)


def _nombre_repetido(name: str) -> HTTPException:
    return HTTPException(409, f"Ya existe un cliente llamado '{name}' (sin importar mayúsculas)")


async def _detalle(conn, shipper_id: str):
    return await conn.fetchrow(_SQL_CLIENTES + " WHERE sh.id = $1::uuid", shipper_id)


@router.get("")
async def list_shippers(
    q: str = Query(""),
    status: Literal["", "ACTIVE", "INACTIVE"] = Query(""),
    pool=Depends(get_pool),
    _=Depends(require(Permission.COMMERCIAL_READ)),
):
    params, clauses = [], []
    if q.strip():
        params.append(q.strip())
        clauses.append(f"sh.name ILIKE '%' || ${len(params)} || '%'")
    if status:
        params.append(status)
        clauses.append(f"sh.status = ${len(params)}")
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = await pool.fetch(_SQL_CLIENTES + where + " ORDER BY sh.name", *params)
    return [dict(r) for r in rows]


@router.get("/{shipper_id}")
async def get_shipper(shipper_id: UUID, pool=Depends(get_pool), _=Depends(require(Permission.COMMERCIAL_READ))):
    fila = await _detalle(pool, str(shipper_id))
    if not fila:
        raise HTTPException(404, "Cliente no encontrado")
    return dict(fila)


@router.patch("/{shipper_id}")
async def patch_shipper(
    shipper_id: UUID,
    body: ShipperPatchBody,
    pool=Depends(get_pool),
    user=Depends(require(Permission.COMMERCIAL_EDIT)),
):
    """Desactivar no borra lugares ni vínculos: el cliente deja de ofrecerse
    para vincular (tms_clients exige status ACTIVE) y su ficha sigue abriendo."""
    sid = str(shipper_id)
    cambios = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if "name" in cambios:
        cambios["name"] = _nombre_limpio(cambios["name"])
    async with pool.acquire() as conn:
        async with conn.transaction():
            actual = await conn.fetchrow(
                "SELECT name, status FROM public.shippers WHERE id = $1::uuid FOR UPDATE", sid)
            if not actual:
                raise HTTPException(404, "Cliente no encontrado")
            for campo, valor in cambios.items():
                if actual[campo] == valor:
                    continue
                try:
                    # `campo` sale del modelo con extra="forbid": solo name o status.
                    await conn.execute(f"UPDATE public.shippers SET {campo} = $2 WHERE id = $1::uuid", sid, valor)
                except Exception as e:
                    if _es_nombre_repetido(e):
                        raise _nombre_repetido(valor)
                    raise
                await log_change(conn, actor=user["sub"], entity_type="SHIPPER", entity_id=sid,
                                 action="update", field=campo, old_value=actual[campo], new_value=valor)
            return dict(await _detalle(conn, sid))


@router.post("", status_code=201)
async def create_shipper(
    body: ShipperCreateBody,
    pool=Depends(get_pool),
    _=Depends(require(Permission.COMMERCIAL_EDIT)),
):
    name = _nombre_limpio(body.name)
    try:
        row = await pool.fetchrow(
            "INSERT INTO public.shippers (name, status) VALUES ($1, 'ACTIVE') RETURNING id, name, status",
            name,
        )
    except Exception as e:
        if _es_nombre_repetido(e):
            raise _nombre_repetido(name)
        raise
    return dict(row)
