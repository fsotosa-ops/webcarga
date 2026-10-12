"""Apoyo de los tests de D1 "Una sola respuesta" (spec
2026-10-12-directory-d1-one-answer-design.md): los hechos de la flota de la
migración, y (desde la Task 5) las fábricas de sujetos ZZ-TEST-D1 que comparten
las tareas. No es un archivo de tests: pytest no lo colecta (no empieza con test_)."""
from __future__ import annotations

from pathlib import Path

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
