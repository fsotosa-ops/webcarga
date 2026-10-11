"""Configuración › Clientes del TMS (spec 2026-10-11 §4): a qué cliente del
directorio corresponde cada cliente de cada TMS. dbt la lee para
app.trips.shipper_id; un cambio se aplica a los viajes, incluidos los viejos, en
la próxima corrida (escotilla OR 7 del modelo trips)."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..authz import Permission, require
from ..db import get_pool

router = APIRouter(prefix="/tms-clients", tags=["tms-clients"])

# La lista sale de los viajes: un cliente nuevo del TMS aparece solo, sin vincular.
_SQL_LISTA = """
SELECT t.source_client_id::text AS source_client_id,
       min(t.source_system) AS source_system,
       -- El texto tal como lo manda el TMS: es lo que se muestra, no se compara.
       COALESCE(min(m.source_client), min(t.client_name)) AS source_client,
       count(*) AS trips,
       m.shipper_id::text AS shipper_id,
       sh.name AS shipper_name
FROM app.trips t
LEFT JOIN app.tms_client_shippers m ON m.source_client_id = t.source_client_id
LEFT JOIN public.shippers sh ON sh.id = m.shipper_id
WHERE t.source_client_id IS NOT NULL
GROUP BY t.source_client_id, m.shipper_id, sh.name
ORDER BY (m.shipper_id IS NULL) DESC, min(t.source_system), min(t.client_name)
"""


class VinculoBody(BaseModel):
    shipper_id: str


@router.get("")
async def listar(pool=Depends(get_pool), _=Depends(require(Permission.COMMERCIAL_READ))):
    return [dict(r) for r in await pool.fetch(_SQL_LISTA)]


@router.put("/{source_client_id}")
async def vincular(source_client_id: str, body: VinculoBody, pool=Depends(get_pool),
                   user=Depends(require(Permission.COMMERCIAL_EDIT))):
    shipper_id = body.shipper_id
    async with pool.acquire() as conn:
        cliente = await conn.fetchrow(
            "SELECT id FROM public.shippers WHERE id = $1::uuid AND status = 'ACTIVE'", shipper_id)
        if not cliente:
            raise HTTPException(422, "El cliente elegido no está en el directorio")
        origen = await conn.fetchrow(
            "SELECT min(source_system) AS source_system, min(client_name) AS source_client "
            "FROM app.trips WHERE source_client_id = $1::uuid", source_client_id)
        if not origen or origen["source_system"] is None:
            raise HTTPException(404, "Ese cliente del TMS no tiene viajes")
        fila = await conn.fetchrow(
            """
            INSERT INTO app.tms_client_shippers (source_client_id, source_system, source_client, shipper_id, created_by)
            VALUES ($1::uuid, $2, $3, $4::uuid, $5::uuid)
            ON CONFLICT (source_client_id) DO UPDATE SET shipper_id = EXCLUDED.shipper_id
            RETURNING source_client_id::text AS source_client_id, shipper_id::text AS shipper_id
            """,
            source_client_id, origen["source_system"], origen["source_client"], shipper_id, user["sub"])
    return dict(fila)
