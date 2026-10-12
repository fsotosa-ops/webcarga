"""Apoyo de los tests de D1 "Una sola respuesta" (spec
2026-10-12-directory-d1-one-answer-design.md): los hechos de la flota de la
migración, y (desde la Task 5) las fábricas de sujetos ZZ-TEST-D1 que comparten
las tareas. No es un archivo de tests: pytest no lo colecta (no empieza con test_)."""
from __future__ import annotations

from datetime import date
from pathlib import Path
from uuid import uuid4

MIGRATION_D1 = (Path(__file__).resolve().parents[2]
                / "supabase/migrations/20261013090000_directory_one_answer.sql")
# Todo lo que viene después de esta línea son los CHECK de operational_status.
CHECKS_MARKER = "-- d1:checks"


def fleet_facts_sql() -> str:
    """La migración hasta la marca, sin incluirla: vista, carrier_of y
    carrier_management_types."""
    texto = MIGRATION_D1.read_text()
    corte = texto.find("\n" + CHECKS_MARKER + "\n")
    assert corte != -1, f"no encontré la línea {CHECKS_MARKER!r} en {MIGRATION_D1.name}"
    return texto[:corte]


async def apply_fleet_facts(conn) -> None:
    """Crea los hechos de la flota dentro de la transacción revertida del test.
    Sin los CHECK: un ADD CONSTRAINT toma un lock exclusivo sobre carriers,
    drivers y assets hasta el ROLLBACK, y la app no podría leerlas mientras dure
    el test. Una vez aplicada la migración (Task 10), esto recrea lo mismo y no
    cambia nada."""
    await conn.execute(fleet_facts_sql())


PREFIX = "ZZ-TEST-D1"


def suffix() -> str:
    return uuid4().hex[:8]


async def today(conn) -> date:
    return await conn.fetchval("SELECT public.hoy_chile()")


async def thresholds(conn, *, warning: int = 30, critical: int = 0) -> None:
    """Fija el umbral global de Configuración › Alertas para el test: ningún
    caso de aviso depende del valor que tenga producción."""
    await conn.execute(
        "UPDATE app.alert_thresholds SET warning_days = $1, error_days = $2 "
        "WHERE doc_type = 'documento_por_vencer'", warning, critical)


async def carrier(conn, *, status: str = "ACTIVE", management_types: list[str] | None = None) -> str:
    s = suffix()
    return str(await conn.fetchval(
        "INSERT INTO public.carriers (business_name, tax_id, operational_status, management_types) "
        "VALUES ($1, $2, $3, $4) RETURNING id",
        f"{PREFIX} Empresa {s}", f"{PREFIX}-{s}", status, management_types))


async def driver(conn, carrier_id: str | None, *, status: str = "ACTIVE", name: str | None = None) -> str:
    d = str(await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status) VALUES ($1, $2) RETURNING id",
        name or f"{PREFIX} Conductor {suffix()}", status))
    if carrier_id:
        # La asignación queda ACTIVE aunque el conductor esté de baja: dar de
        # baja (PATCH operational_status) no la toca (F-03).
        await conn.execute(
            "INSERT INTO public.driver_assignments (driver_id, carrier_id, status, start_date) "
            "VALUES ($1, $2, 'ACTIVE', public.hoy_chile() - 400)", d, carrier_id)
    return d


async def asset(conn, carrier_id: str | None, *, status: str = "ACTIVE",
                asset_type: str = "TRACTOCAMION") -> str:
    a = str(await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type, operational_status) "
        "VALUES ($1, $2, $3) RETURNING id",
        f"ZZ{uuid4().hex[:4].upper()}", asset_type, status))
    if carrier_id:
        await conn.execute(
            "INSERT INTO public.asset_assignments (asset_id, carrier_id, status, start_date) "
            "VALUES ($1, $2, 'ACTIVE', public.hoy_chile() - 400)", a, carrier_id)
    return a


async def usual_driver(conn, asset_id: str, driver_id: str, start: date) -> None:
    await conn.execute(
        "INSERT INTO public.vehicle_driver_assignments "
        "(asset_id, driver_id, status, source, is_manual_override, start_date) "
        "VALUES ($1, $2, 'ACTIVE', 'manual', true, $3)", asset_id, driver_id, start)


async def requirement(conn, *, entity: str, level: str = "LEGAL_MANDATORY",
                      policy: str = "REQUIRED", exigible_on: str = "ON_ENTITY_START") -> str:
    return str(await conn.fetchval(
        """
        INSERT INTO public.compliance_requirements
            (target_entity, requirement_code, name, requirement_level,
             expiration_policy, exigible_on, is_active, requires_file)
        VALUES ($1, $2, $3, $4, $5, $6, false, true)
        RETURNING id
        """,
        entity, f"ZZ_D1_{suffix().upper()}", f"{PREFIX} documento", level, policy, exigible_on))


async def record(conn, requirement_id: str, entity_type: str, entity_id: str, *,
                 status: str = "MISSING", expires: date | None = None) -> str:
    return str(await conn.fetchval(
        """
        INSERT INTO public.compliance_records
            (entity_id, entity_type, requirement_id, status, is_current, expiration_date, file_url)
        VALUES ($1, $2, $3, $4, true, $5, $6)
        RETURNING id
        """,
        entity_id, entity_type, requirement_id, status, expires,
        None if status == "MISSING" else "zz/test.pdf"))


async def without_seeding(conn, *entity_ids: str) -> None:
    await conn.execute(
        "DELETE FROM public.compliance_records WHERE entity_id = ANY($1::uuid[])", list(entity_ids))
