"""Auditoría + protección de ediciones manuales (plan §G / H1.6 / H2.5).

Todo endpoint de escritura que modifique una fila de una tabla que Mage
puebla en bulk debe usar `record_manual_edit()` en la MISMA transacción que
el UPDATE/INSERT de negocio — nunca solo el UPDATE de negocio por sí solo:
sin `is_manual_override=true`, el próximo sync de Mage pisa el cambio en la
próxima corrida (ver AGENTLOG.md, Checkpoint M/H1).

Para altas nuevas (INSERT) donde todavía no hay una fila "protegible" (ej.
onboarding de un carrier) o para acciones que no corresponden a una tabla
de este set, usar `log_change()` solo.
"""
import json
from uuid import UUID

import asyncpg

# Whitelist explícito de tablas con columnas is_manual_override/overridden_by/
# overridden_at (migración h1_manual_override_columns) — nunca interpolar un
# nombre de tabla que venga del request.
OVERRIDABLE_TABLES = {
    "carriers", "drivers", "assets", "contacts", "compliance_records",
    "driver_assignments", "asset_assignments", "carrier_shippers",
    "insurance_policies", "policy_coverages", "policy_assets",
    "insurance_installments",
}


async def log_change(
    conn: asyncpg.Connection,
    *,
    actor: UUID | str | None,
    entity_type: str,
    entity_id: UUID | str,
    action: str,
    field: str | None = None,
    old_value=None,
    new_value=None,
    source: str = "api",
) -> None:
    await conn.execute(
        """
        INSERT INTO public.audit_log (actor, entity_type, entity_id, action, field, old_value, new_value, source)
        VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6::jsonb, $7::jsonb, $8)
        """,
        str(actor) if actor else None, entity_type, str(entity_id), action, field,
        # `default=str` porque los valores auditados ya no son sólo texto y
        # números: al auditar columnas uuid (assets.fleet_service_type_id,
        # webcarga_operation_type_id) asyncpg devuelve uuid.UUID, que json no
        # sabe serializar y hacía reventar la transacción entera con un 500.
        # Vale igual para date/datetime, que es el próximo tipo que va a caer.
        json.dumps(old_value, default=str) if old_value is not None else None,
        json.dumps(new_value, default=str) if new_value is not None else None,
        source,
    )


async def record_manual_edit(
    conn: asyncpg.Connection,
    *,
    table: str,
    where: dict,
    actor: UUID | str,
    entity_type: str,
    entity_id: UUID | str,
    action: str,
    field: str | None = None,
    old_value=None,
    new_value=None,
    source: str = "api",
) -> None:
    """Marca `table` (filtrada por `where`) como is_manual_override=true y
    registra el cambio en public.audit_log. `where` es un dict columna->valor
    (soporta PK compuesta, ej. policy_coverages: {"policy_id": ..., "coverage_type_id": ...}).
    Debe llamarse dentro del mismo `conn.transaction()` que el UPDATE de negocio.
    """
    if table not in OVERRIDABLE_TABLES:
        raise ValueError(f"Tabla no habilitada para override manual: {table}")
    if not where:
        raise ValueError("record_manual_edit requiere al menos una condición en `where`")

    where_cols = list(where.keys())
    where_clause = " AND ".join(f"{col} = ${i + 2}" for i, col in enumerate(where_cols))
    await conn.execute(
        f"""
        UPDATE public.{table}
        SET is_manual_override = true, overridden_by = $1, overridden_at = now()
        WHERE {where_clause}
        """,
        str(actor), *where.values(),
    )
    await log_change(
        conn, actor=actor, entity_type=entity_type, entity_id=entity_id,
        action=action, field=field, old_value=old_value, new_value=new_value,
        source=source,
    )
