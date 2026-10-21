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

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, field_validator

from ..authz import Permission, require, require_fields
from ..db import get_pool
from ..schemas.common import ManagementType, normalize_management_types
from ..services.audit import log_change

router = APIRouter(prefix="/shippers", tags=["shippers"])

# Una fila por cliente con lo que la lista y la ficha muestran. Los viajes son
# los planificados en los últimos 30 días, en fecha de Chile.
_SQL_CLIENTES = """
SELECT sh.id, sh.name, sh.status, sh.operation_types,
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
    -- Todos, activos e inactivos: es lo que lista la pestaña Lugares de la ficha.
    WHERE l.entity_type = 'SHIPPER' AND l.entity_id = sh.id
) lug
"""


class ShipperCreateBody(BaseModel):
    name: str


class ShipperPatchBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = None
    status: Literal["ACTIVE", "INACTIVE"] | None = None
    # Con qué tipos de operación trabaja (plan 2026-10-21). Con uno solo, es el tipo de
    # sus viajes (app.v_trip_fleet_resolution). `null` explícito = sin definir.
    operation_types: list[ManagementType] | None = None

    @field_validator("operation_types", mode="after")
    @classmethod
    def _normalize_operation_types(cls, v):
        return normalize_management_types(v)

    def sent(self) -> dict:
        """Lo que se mandó, incluido un `operation_types: null` (quitarlo)."""
        datos = self.model_dump(exclude_none=True)
        if "operation_types" in self.model_fields_set:
            datos["operation_types"] = self.operation_types
        return datos


# Permiso por campo: el nombre y el estado son de Comercial; los tipos de operación
# deciden el alcance de sus viajes en el Cierre, así que son de Operaciones.
SHIPPER_FIELD_PERMISSIONS: dict[str, Permission] = {
    "name": Permission.COMMERCIAL_EDIT,
    "status": Permission.COMMERCIAL_EDIT,
    "operation_types": Permission.OPERATIONS_CONFIGURE,
}

# Una sentencia por campo editable, escrita entera: ningún nombre de columna
# se arma con texto que venga del pedido.
_SQL_ACTUALIZAR = {
    "name":   "UPDATE public.shippers SET name = $2 WHERE id = $1::uuid",
    "status": "UPDATE public.shippers SET status = $2 WHERE id = $1::uuid",
    "operation_types": "UPDATE public.shippers SET operation_types = $2 WHERE id = $1::uuid",
}


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
async def list_shippers(pool=Depends(get_pool), _=Depends(require(Permission.COMMERCIAL_READ))):
    """Todos: los clientes son pocos y Directorio › Clientes filtra y cuenta en
    la pantalla, así las cifras de sus filtros son las de lo que se ve."""
    rows = await pool.fetch(_SQL_CLIENTES + " ORDER BY sh.name")
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
    # El permiso real es por campo (SHIPPER_FIELD_PERMISSIONS), como en conductores.
    user=Depends(require(Permission.COMMERCIAL_READ)),
):
    """Desactivar no borra lugares ni vínculos: el cliente deja de ofrecerse
    para vincular (tms_clients exige status ACTIVE) y su ficha sigue abriendo."""
    sid = str(shipper_id)
    cambios = body.sent()
    if not cambios:
        raise HTTPException(422, "Ningún campo enviado")
    require_fields(user, cambios, SHIPPER_FIELD_PERMISSIONS)
    if "name" in cambios:
        cambios["name"] = _nombre_limpio(cambios["name"])
    async with pool.acquire() as conn:
        async with conn.transaction():
            actual = await conn.fetchrow(
                "SELECT name, status, operation_types FROM public.shippers WHERE id = $1::uuid FOR UPDATE", sid)
            if not actual:
                raise HTTPException(404, "Cliente no encontrado")
            for campo, valor in cambios.items():
                if actual[campo] == valor:
                    continue
                try:
                    await conn.execute(_SQL_ACTUALIZAR[campo], sid, valor)
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
