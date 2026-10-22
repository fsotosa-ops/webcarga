"""Quién cambió qué en Configuración (spec 2026-10-22-configuracion-orden-visual §3.3).

Cada guardado de un ajuste, una persona o un rol escribe una fila en public.audit_log
con `entity_type = 'config:<area>/<section>'`. Reemplaza a la "revisión" como
trazabilidad: un ajuste no tiene estado "revisado", tiene historia (Linear, Stripe,
GitHub, HubSpot).

`audit_log.entity_id` es uuid y muchos elementos tienen clave de texto
(`stale_report_hours`, `refrigerado`): el id es un md5 con forma de uuid del trío
área/sección/elemento, y la clave real viaja en `new_value.element_id`."""
from __future__ import annotations

import hashlib
import uuid

from .audit import log_change

ACCIONES = {"create", "update", "move", "delete"}


def entity_uuid(area: str, section: str, element_id: str) -> str:
    """El id estable de un elemento de Configuración en audit_log."""
    return str(uuid.UUID(hashlib.md5(f"{area}/{section}/{element_id}".encode()).hexdigest()))


def entity_type(area: str, section: str) -> str:
    return f"config:{area}/{section}"


async def registrar_cambio(
    pool_or_conn, *, actor: str | None, area: str, section: str, element_id: str,
    action: str, before: dict | None, after: dict | None,
) -> None:
    """Una fila en audit_log por un cambio de Configuración. `before` y `after` son
    solo los campos que cambian; nunca secretos (contraseñas, tokens, enlaces)."""
    if action not in ACCIONES:
        raise ValueError(f"acción desconocida: {action}")
    # El pool de asyncpg y una conexión tienen `.execute`: log_change sirve a los dos.
    await log_change(
        pool_or_conn, actor=actor, entity_type=entity_type(area, section),
        entity_id=entity_uuid(area, section, element_id), action=action,
        old_value=before, new_value={**(after or {}), "element_id": element_id}, source="config",
    )


# El último cambio de cada elemento de una sección.
SQL_ULTIMOS_CAMBIOS = """
SELECT DISTINCT ON (a.new_value->>'element_id')
       a.new_value->>'element_id' AS element_id,
       COALESCE(p.full_name, p.email) AS actor_name,
       a.occurred_at AS changed_at
  FROM public.audit_log a
  LEFT JOIN public.profiles p ON p.id = a.actor
 WHERE a.entity_type = $1
 ORDER BY a.new_value->>'element_id', a.occurred_at DESC, a.id DESC
"""


def diferencia(antes, despues: dict) -> tuple[dict, dict]:
    """Los campos de `despues` que cambian respecto de `antes`: (antes, después).
    `antes` es la fila leída antes de guardar (un Record o un dict)."""
    viejos, nuevos = {}, {}
    for campo, valor in despues.items():
        previo = antes[campo] if antes is not None and campo in antes.keys() else None
        if previo != valor:
            viejos[campo], nuevos[campo] = previo, valor
    return viejos, nuevos
