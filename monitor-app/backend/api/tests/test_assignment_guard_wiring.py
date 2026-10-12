"""Una sola validación de asignación (D1 §7.1). Toda ruta que escribe un
vínculo de flota pasa por app/services/assignment_guard.py antes de escribir.
Un endpoint nuevo que inserte en app.trip_fleet_links sin la guarda hace
fallar este test."""
from __future__ import annotations

import ast
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"
GUARD_CALLS = {"enforce_assignment", "check_assignments"}
# Escriben el vínculo pero no son rutas: las llaman rutas que ya pasaron la guarda.
WRITERS = {"_escribir_link_manual", "_insert_trip"}


def _funcs(path: Path) -> dict[str, ast.AsyncFunctionDef]:
    tree = ast.parse(path.read_text())
    return {n.name: n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef)}


def _calls(func) -> list[tuple[int, str]]:
    out = []
    for node in ast.walk(func):
        if isinstance(node, ast.Call):
            f = node.func
            name = f.id if isinstance(f, ast.Name) else f.attr if isinstance(f, ast.Attribute) else None
            if name:
                out.append((node.lineno, name))
    return sorted(out)


def _source(func, path: Path) -> str:
    return ast.get_source_segment(path.read_text(), func) or ""


def test_toda_ruta_que_escribe_un_vinculo_pasa_por_la_guarda_antes():
    trips = APP / "routers" / "trips.py"
    funcs = _funcs(trips)
    rutas = set()
    for name, func in funcs.items():
        if name in WRITERS:
            continue
        calls = _calls(func)
        escribe = (any(n in WRITERS for _, n in calls)
                   or "INSERT INTO app.trip_fleet_links" in _source(func, trips))
        if not escribe:
            continue
        rutas.add(name)
        primera_guarda = min((l for l, n in calls if n in GUARD_CALLS), default=None)
        primera_escritura = min((l for l, n in calls if n in WRITERS), default=None)
        assert primera_guarda is not None, f"{name} escribe un vínculo sin pasar por la guarda"
        if primera_escritura is not None:
            assert primera_guarda < primera_escritura, f"{name}: la guarda corre después de escribir"
    # Si la expresión deja de encontrarlas, el test no protege nada.
    assert {"create_trip", "bulk_create_trips", "assign_fleet_link", "assign_driver_bulk", "patch_trip"} <= rutas


def test_el_conductor_habitual_pasa_por_la_guarda():
    funcs = _funcs(APP / "routers" / "assets.py")
    assert any(n in GUARD_CALLS for _, n in _calls(funcs["assign_driver_to_asset"]))
