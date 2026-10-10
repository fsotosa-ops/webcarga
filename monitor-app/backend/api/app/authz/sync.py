# app/authz/sync.py
"""Alinea la base con el catálogo del código (app/authz/permissions.py).

Corre al arrancar la API, en una transacción y con un advisory lock: varias
instancias de Cloud Run pueden arrancar a la vez. Idempotente.

- app.permissions: upsert de todo el catálogo. Un permiso que ya no está en el
  código y ningún rol usa se borra; si un rol personalizado lo usa, se conserva
  y se devuelve (se loguea; test_authz_catalogo/CI lo atrapa antes).
- Roles de sistema: nombre, descripción y composición exactamente como el código.
"""
from __future__ import annotations

import logging

from .permissions import PERMISSION_META, SYSTEM_ROLES

log = logging.getLogger(__name__)
_LOCK = 8_202_610  # identificador del advisory lock de esta sincronización


async def sync_catalog(conn) -> list[str]:
    async with conn.transaction():
        await conn.execute("SELECT pg_advisory_xact_lock($1)", _LOCK)
        await conn.executemany(
            """INSERT INTO app.permissions (code, area, description, privileged)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (code) DO UPDATE SET area = EXCLUDED.area,
                 description = EXCLUDED.description, privileged = EXCLUDED.privileged""",
            [(p.value, m.area, m.description, m.privileged) for p, m in PERMISSION_META.items()],
        )
        vigentes = [p.value for p in PERMISSION_META]
        huerfanos = [r["code"] for r in await conn.fetch(
            """SELECT DISTINCT rp.permission_code AS code FROM app.role_permissions rp
               JOIN app.roles r ON r.id = rp.role_id
               WHERE NOT r.is_system AND rp.permission_code <> ALL($1::text[])
               ORDER BY 1""", vigentes)]
        await conn.execute(
            """DELETE FROM app.permissions p WHERE p.code <> ALL($1::text[])
               AND NOT EXISTS (SELECT 1 FROM app.role_permissions rp
                               JOIN app.roles r ON r.id = rp.role_id
                               WHERE rp.permission_code = p.code AND NOT r.is_system)""", vigentes)
        # Un rol personalizado con el código de uno de sistema no se adopta:
        # sus personas recibirían permisos que nadie les dio. Con el prefijo
        # custom_ no debería pasar; si pasa, que la API no arranque.
        ocupados = [r["code"] for r in await conn.fetch(
            "SELECT code FROM app.roles WHERE NOT is_system AND code = ANY($1::text[])",
            [r.code for r in SYSTEM_ROLES])]
        if ocupados:
            raise RuntimeError(f"Roles personalizados con código de sistema: {', '.join(ocupados)}")
        for rol in SYSTEM_ROLES:
            rid = await conn.fetchval(
                """INSERT INTO app.roles (code, name, description, is_system, grants_all)
                   VALUES ($1, $2, $3, true, $4)
                   ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name,
                     description = EXCLUDED.description, is_system = true, grants_all = EXCLUDED.grants_all
                   RETURNING id""", rol.code, rol.name, rol.description, rol.grants_all)
            await conn.execute("DELETE FROM app.role_permissions WHERE role_id = $1", rid)
            await conn.executemany(
                "INSERT INTO app.role_permissions (role_id, permission_code) VALUES ($1, $2)",
                [(rid, p.value) for p in rol.permissions])
    if huerfanos:
        log.warning("Permisos retirados del código y todavía asignados a roles personalizados: %s", huerfanos)
    return huerfanos
