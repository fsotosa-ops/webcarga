"""Activo y asignado tienen una sola definición: app.is_trip_open y
app.is_trip_assigned (spec 2026-10-11). Ningún INSERT de app.trips en la API
puede escribirlos con un literal: ese fue el segundo escritor que dejaba un
viaje manual "activo, no asignado" hasta la corrida de Mage."""
from __future__ import annotations

import ast
import re
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"
# Del paréntesis de columnas hasta el cierre del string SQL: abarca VALUES,
# ON CONFLICT y RETURNING, en cualquier orden.
INSERT = re.compile(r"INSERT INTO app\.trips\s*\((?P<cols>[^)]*)\)(?P<vals>.*?)(?:\"\"\"|\'\'\')", re.S)


def test_no_insert_into_trips_hardcodes_the_flags():
    found = 0
    for path in APP.rglob("*.py"):
        for match in INSERT.finditer(path.read_text()):
            cols = match["cols"]
            if "is_assigned" not in cols and "is_active" not in cols:
                continue
            found += 1
            vals = match["vals"]
            assert "app.is_trip_open(" in vals, f"{path.name}: is_active sin app.is_trip_open"
            assert "app.is_trip_assigned(" in vals, f"{path.name}: is_assigned sin app.is_trip_assigned"
    assert found >= 1, "la guarda no encontró el INSERT del alta manual: revisar la expresión regular"


TRIPS_ROUTER = APP / "routers" / "trips.py"
# Las rutas que escriben un viaje en una transacción (spec 2026-10-11).
TRANSACTIONAL_ROUTES = {"create_trip", "patch_trip", "assign_fleet_link", "remove_fleet_link", "reset_field"}


def _transaction_blocks(func: ast.AsyncFunctionDef):
    for node in ast.walk(func):
        if isinstance(node, ast.AsyncWith):
            for item in node.items:
                call = item.context_expr
                if (isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute)
                        and call.func.attr == "transaction"):
                    yield node


def test_no_pool_call_inside_a_transaction_block():
    """Dentro de `async with conn.transaction():` todo va por `conn`. Una llamada
    a `pool.` ahí toma otra conexión, queda fuera de la transacción y no se
    revierte. Los tests mockeados no lo distinguen (el mock presta el mismo pool
    como conexión): por eso esta guarda mira el código."""
    tree = ast.parse(TRIPS_ROUTER.read_text())
    funcs = {n.name: n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef)}
    assert TRANSACTIONAL_ROUTES <= funcs.keys()
    offenders = []
    for name in sorted(TRANSACTIONAL_ROUTES):
        for block in _transaction_blocks(funcs[name]):
            for node in ast.walk(block):
                if isinstance(node, ast.Name) and node.id == "pool":
                    offenders.append(f"{name}:{node.lineno}")
    assert not offenders, f"pool usado dentro de una transacción: {offenders}"
