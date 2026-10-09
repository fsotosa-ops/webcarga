# app/authz/effective.py
"""Permisos efectivos de una persona: la unión de los permisos de sus roles.

`grants_all` (Propietario) → todo el catálogo vigente. Una sola consulta,
cacheada 60 s como el rol de antes; se invalida al cambiar las asignaciones
(services/access_admin.py), así un rol quitado deja de valer de inmediato.
"""
from __future__ import annotations

import json

from ..cache import cache_delete, cache_get, cache_set

_SQL = """
SELECT p.active,
       COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles,
       CASE WHEN bool_or(r.grants_all)
            THEN (SELECT array_agg(code ORDER BY code) FROM app.permissions)
            ELSE COALESCE(array_agg(DISTINCT rp.permission_code)
                          FILTER (WHERE rp.permission_code IS NOT NULL), '{}')
       END AS permissions
FROM public.profiles p
LEFT JOIN app.user_roles ur ON ur.user_id = p.id
LEFT JOIN app.roles r ON r.id = ur.role_id
LEFT JOIN app.role_permissions rp ON rp.role_id = r.id
WHERE p.id = $1
GROUP BY p.id, p.active
"""


def _clave(user_id: str) -> str:
    return f"acceso:{user_id}"


async def load_access(pool, user_id: str) -> dict | None:
    cached = await cache_get(_clave(user_id))
    if cached:
        return json.loads(cached)
    fila = await pool.fetchrow(_SQL, user_id)
    acceso = None if fila is None else {
        "active": fila["active"], "roles": sorted(fila["roles"]), "permissions": sorted(fila["permissions"])}
    await cache_set(_clave(user_id), json.dumps(acceso), ex=60)
    return acceso


async def invalidate_access(user_id: str) -> None:
    await cache_delete(_clave(user_id))
