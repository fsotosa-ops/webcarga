"""Una sola definición para las preguntas de D1 (spec §8.5): flota activa,
estado del documento, habilitación, resumen e identidad. Fuera de los dueños
(services/vencimientos.py, services/fleet_compliance.py, utils/identity.py y la
migración 20261013090000), nadie las escribe a mano.

Mientras duren los despliegues 1 y 2, los lectores viejos conviven con los
nuevos (expandir/contraer, §9). Por eso cada regla tiene un TOPE por archivo
que solo puede bajar (C-R14), igual que los trinquetes visuales. La Task 16
los lleva a 0. Si un número de acá sube, alguien volvió a escribir la regla."""
from __future__ import annotations

import ast
import re
from collections import Counter
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"
OWNERS = {"services/vencimientos.py", "services/fleet_compliance.py", "utils/identity.py"}


def _sql_strings(path: Path):
    """Cada literal de texto del archivo una sola vez: una f-string cuenta
    entera (sus huecos como {}), no además cada pedazo."""
    tree = ast.parse(path.read_text())
    inner = {id(v) for n in ast.walk(tree) if isinstance(n, ast.JoinedStr) for v in n.values}
    for node in ast.walk(tree):
        if id(node) in inner:
            continue
        if isinstance(node, ast.JoinedStr):
            yield "".join(v.value if isinstance(v, ast.Constant) else "{}" for v in node.values)
        elif isinstance(node, ast.Constant) and isinstance(node.value, str):
            yield node.value


def _count(rule) -> Counter:
    out = Counter()
    for path in APP.rglob("*.py"):
        rel = str(path.relative_to(APP))
        for s in _sql_strings(path):
            out[rel] += rule(s)
    return Counter({k: v for k, v in out.items() if v})


# ── Las reglas ────────────────────────────────────────────────────────────────
# Flota activa escrita a mano: una misma consulta que mira conductores o
# equipos activos Y su asignación ACTIVE. La definición es app.active_fleet.
_FLEET_TABLE = re.compile(r"public\.(drivers|assets)\b")
_FLEET_ROW = re.compile(r"\b\w+\.operational_status\s*=\s*'ACTIVE'")
# \b al inicio: vehicle_driver_assignments (el tracto habitual, C-R16) no es la
# asignación a la empresa y no cuenta como flota activa.
_ASSIGN_ACTIVE = re.compile(r"\b(driver|asset)_assignments\b.*?\bstatus\s*=\s*'ACTIVE'", re.S)


def active_fleet(s: str) -> int:
    return int(bool(_FLEET_TABLE.search(s) and _FLEET_ROW.search(s) and _ASSIGN_ACTIVE.search(s)))


def document_state(s: str) -> int:      # clasificar un registro en un estado
    return len(re.findall(r"THEN\s+'(OVERDUE|EXPIRING|MISSING|UP_TO_DATE)'", s))


def compliance_health(s: str) -> int:   # el resumen viejo, que se retira en la T16
    return len(re.findall(r"\bAS\s+compliance_health\b", s))


def mandatory_blocking(s: str) -> int:  # "qué obligatorio bloquea" escrito fuera del módulo
    return len(re.findall(r"requirement_level\s*=\s*'LEGAL_MANDATORY'", s))


# Empresa de un conductor o equipo atribuida a mano: un JOIN a su asignación
# ACTIVE y a carriers. La definición es app.carrier_of.
_ATTR_JOIN = re.compile(r"JOIN\s+public\.(driver|asset)_assignments\s+\w+\s+ON[^;]*?status\s*=\s*'ACTIVE'", re.S | re.I)


def carrier_attribution(s: str) -> int:
    return int(bool(_ATTR_JOIN.search(s) and re.search(r"JOIN\s+public\.carriers\b", s, re.I)))


def can_operate_computed(s: str) -> int:
    return len(re.findall(r"\bAS\s+can_operate\b", s))


def plate_trim(s: str) -> int:          # patente comparada sin canonical_plate
    return len(re.findall(r"upper\(\s*trim\(\s*(\w+\.)?license_plate", s, re.I))


def tax_id_like(s: str) -> int:         # RUT buscado sin canonical_rut
    return len(re.findall(r"\btax_id\s+I?LIKE\b", s, re.I))


# ── Los topes ─────────────────────────────────────────────────────────────────
# Medidos al cerrar la Task 9 (ver Step 2). Solo pueden bajar. La columna
# "T16" dice a cuánto los lleva la contracción.
CEILINGS: dict[str, dict[str, int]] = {
    "active_fleet": {
        # Medido al cerrar la Task 9 (Task 10, 12/10); todos <= la referencia previa a T5-T7.
        "routers/carriers.py": 2,                    # T16 → 0
        "routers/status_report.py": 1,
        "routers/trips.py": 5,                       # T16 baja los del Monitor
        "services/cierre_lineas.py": 1,              # Cierre, no se toca
        "services/driver_roster.py": 1,              # Cierre, no se toca
        "services/fleet_driver_gap.py": 1,
        "services/plantilla_certificacion.py": 1,
        "services/pre_cierre.py": 2,                 # Cierre, no se toca
    },
    "compliance_health": {"routers/carriers.py": 3},              # T16 → 0
    # F6: trips.py queda en 3 (la T7 agregó el aviso por entidad). La lateral vieja que usa el
    # Cierre (daily_closures.py:93 la comparte) y pending_mandatory del embudo (compliance.py,
    # R-E6) se quedan con tope permanente; la T16 solo baja carriers.py.
    "mandatory_blocking": {"routers/carriers.py": 3, "routers/compliance.py": 1, "routers/trips.py": 3},
    "plate_trim": {"services/pre_cierre.py": 3},                  # D3 (C-R13); el Cierre no se toca
    "carrier_attribution": {
        # Medido al cerrar la Task 9 (Task 10, 12/10). entity_summary.py ya está en 0 (T6).
        "routers/assets.py": 1,
        "routers/carriers.py": 2,
        "routers/daily_closures.py": 2,   # diferido a D2: carrier_of recibe la fecha y lee el historial
        "routers/drivers.py": 1,
        "routers/equipment_closures.py": 1,
        "routers/status_report.py": 1,
        "routers/trips.py": 5,
        "services/cierre_lineas.py": 2,              # Cierre, no se toca
        "services/driver_roster.py": 1,              # Cierre, no se toca
        "services/plantilla_certificacion.py": 1,
        "services/pre_cierre.py": 2,                 # Cierre, no se toca
    },
}
# La tupla FUNNEL_ACTIVE_STATUSES = ("ACTIVE", "ONBOARDING") se queda (C-R15): no es un predicado
# duplicado y ninguna regla de acá la cuenta.
ZERO_OUTSIDE_OWNERS = {"document_state": document_state, "can_operate_computed": can_operate_computed,
                       "tax_id_like": tax_id_like}
RATCHETED = {"active_fleet": active_fleet, "compliance_health": compliance_health,
             "mandatory_blocking": mandatory_blocking, "plate_trim": plate_trim,
             "carrier_attribution": carrier_attribution}


def test_las_reglas_con_tope_no_crecen():
    for name, rule in RATCHETED.items():
        got = {k: v for k, v in _count(rule).items() if k not in OWNERS}
        tope = CEILINGS[name]
        sobran = {k: (v, tope.get(k, 0)) for k, v in got.items() if v > tope.get(k, 0)}
        assert not sobran, f"{name}: (encontrado, tope) {sobran}. La regla vive en su dueño; no se reescribe."


def test_los_topes_bajan_cuando_se_contrae():
    """Un tope más alto que lo que hay deja espacio para que la regla vuelva sin
    que nadie lo note: cuando un lector se migra, su tope baja en el mismo commit."""
    for name, rule in RATCHETED.items():
        got = _count(rule)
        holgura = {k: (t, got.get(k, 0)) for k, t in CEILINGS[name].items() if t > got.get(k, 0)}
        assert not holgura, f"{name}: bajar el tope (tope, real) {holgura}"


def test_estado_habilitacion_e_identidad_solo_en_sus_duenos():
    for name, rule in ZERO_OUTSIDE_OWNERS.items():
        fuera = {k: v for k, v in _count(rule).items() if k not in OWNERS}
        assert not fuera, f"{name} escrito fuera de su dueño: {fuera}"


def test_la_guarda_ve_lo_que_dice_ver():
    """Sin esto, una expresión regular rota dejaría pasar todo en verde."""
    assert document_state(Path(APP / "services" / "vencimientos.py").read_text()) >= 3
    assert active_fleet("JOIN public.drivers d JOIN public.driver_assignments da ON da.status = 'ACTIVE' "
                        "WHERE d.operational_status = 'ACTIVE'") == 1
    assert tax_id_like("WHERE c.tax_id ILIKE '%' || $1") == 1
    assert active_fleet("JOIN public.vehicle_driver_assignments v ON v.status = 'ACTIVE' "
                        "JOIN public.assets a ON a.id = v.asset_id WHERE a.operational_status = 'ACTIVE'") == 0
    assert _count(can_operate_computed).get("services/fleet_compliance.py", 0) >= 1
