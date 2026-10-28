"""Una sola definición para las preguntas de D1 (spec §8.5): flota activa,
estado del documento, habilitación, resumen e identidad. Fuera de los dueños
(services/vencimientos.py, services/fleet_compliance.py, utils/identity.py y la
migración 20261013090000), nadie las escribe a mano.

Cada regla tiene un TOPE por archivo que solo puede bajar (C-R14), igual que
los trinquetes visuales. La Task 16 (contraer, §9) dejó en 0 todo lo que
existía por los campos viejos de D1 (compliance_health, pending_mandatory del
Directorio y del roster, urgencia, funnel_group, expired_count,
*_pending_docs_critical del viaje). Lo que queda con tope es de otro bloque
(D2, D3, el Cierre) o tiene un motivo escrito al lado (F6, F7). Si un número de
acá sube, alguien volvió a escribir la regla."""
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


# Los campos que D1 retiró (Task 16): no vuelven ni como alias de SQL ni como
# clave de la respuesta (el literal "urgencia" de un dict o de r["urgencia"]).
_RETIRED = r"urgencia|compliance_health|funnel_group|expired_count|\w+_pending_docs_critical|pending_mandatory"


def retired_fields(s: str) -> int:
    return (int(bool(re.fullmatch(rf"(?:{_RETIRED})", s.strip())))
            + len(re.findall(rf"\bAS\s+(?:{_RETIRED})\b", s)))


def mandatory_blocking(s: str) -> int:  # "qué obligatorio bloquea" escrito fuera del módulo
    return len(re.findall(r"requirement_level\s*=\s*'LEGAL_MANDATORY'", s))


# Empresa de un conductor o equipo atribuida a mano: un JOIN a su asignación
# ACTIVE y a carriers. La definición es app.carrier_of.
_ATTR_JOIN = re.compile(r"JOIN\s+public\.(driver|asset)_assignments\s+\w+\s+ON[^;]*?status\s*=\s*'ACTIVE'", re.S | re.I)


def carrier_attribution(s: str) -> int:
    return int(bool(_ATTR_JOIN.search(s) and re.search(r"JOIN\s+public\.carriers\b", s, re.I)))


# La misma atribución escrita como CASE sobre las asignaciones ACTIVE, sin JOIN a
# carriers (la forma del embudo): carrier_attribution no la ve.
_ATTR_CASE = re.compile(r"WHEN\s+'(?:DRIVER|ASSET)'\s+THEN\s+(?:COALESCE\(\s*)?\w+\.carrier_id", re.I)


def carrier_attribution_case(s: str) -> int:
    return int(bool(_ATTR_CASE.search(s)))


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
        # La búsqueda de conductores y equipos del Directorio (su empresa vigente
        # y el orden activos primero). No es un campo viejo de D1: se queda (F7).
        "routers/carriers.py": 2,
        "routers/status_report.py": 1,
        "routers/trips.py": 4,                       # el Monitor y su lateral compartida con el Cierre (F7)
        # D2 (14/10): el Cierre lee app.fleet_assignment_periods por día.
        "services/cierre_lineas.py": 0,
        "services/driver_roster.py": 0,
        "services/fleet_driver_gap.py": 1,
        "services/plantilla_certificacion.py": 1,
        "services/pre_cierre.py": 2,                 # Cierre, no se toca
    },
    # F6: trips.py queda en 3 (la T7 agregó el aviso por entidad). La lateral vieja que usa el
    # Cierre (daily_closures.py:93 la comparte) y pending_mandatory del embudo (compliance.py,
    # R-E6) se quedan con tope permanente. carriers.py llegó a 0 en la T16.
    "mandatory_blocking": {"routers/compliance.py": 1, "routers/trips.py": 3},
    "retired_fields": {
        # §6.3: el Cierre sigue leyendo driver_pending_docs_critical (no es el campo del viaje).
        "routers/daily_closures.py": 1,
        # R-E6: pending_mandatory de /compliance-records/status (lo pinta CertificationStatusTable).
        "routers/compliance.py": 1,
    },
    "carrier_attribution_case": {
        # Ruling T16-CO: el embudo atribuye con los dos LEFT JOIN y no con app.carrier_of. Medido
        # el 12/10 sobre el SQL real (37 filas iguales): LEFT JOIN 145-152 ms, carrier_of 270-277 ms,
        # y sin SET search_path 261-278 ms: no se inlinea igual, porque su cuerpo tiene subconsultas
        # (Postgres no inlinea una función SQL escalar con sublinks). Vuelve a carrier_of en D2,
        # cuando reciba la fecha y lea el historial.
        "routers/compliance.py": 1,
        "services/plantilla_certificacion.py": 1,   # anterior a D1; diferido a D2 como su carrier_attribution
    },
    "plate_trim": {"services/pre_cierre.py": 3},                  # D3 (C-R13); el Cierre no se toca
    "carrier_attribution": {
        # Medido al cerrar la Task 9 (Task 10, 12/10). entity_summary.py ya está en 0 (T6).
        "routers/assets.py": 1,
        "routers/carriers.py": 2,
        "routers/daily_closures.py": 0,   # D2 (14/10): carrier_of(…, día)
        "routers/drivers.py": 1,
        "routers/equipment_closures.py": 0,
        "routers/status_report.py": 1,
        "routers/trips.py": 4,   # D5: sin fleet-daily-overview
        "services/cierre_lineas.py": 0,              # D2: el Cierre juzga con la empresa del día
        "services/driver_roster.py": 0,
        "services/plantilla_certificacion.py": 1,
        "services/pre_cierre.py": 1,                 # 28/10: el aviso de empresa no activa lee las asignaciones del día
    },
}
# La tupla FUNNEL_ACTIVE_STATUSES = ("ACTIVE", "ONBOARDING") se queda (C-R15): no es un predicado
# duplicado y ninguna regla de acá la cuenta.
ZERO_OUTSIDE_OWNERS = {"document_state": document_state, "can_operate_computed": can_operate_computed,
                       "tax_id_like": tax_id_like}
RATCHETED = {"active_fleet": active_fleet, "retired_fields": retired_fields,
             "mandatory_blocking": mandatory_blocking, "plate_trim": plate_trim,
             "carrier_attribution": carrier_attribution, "carrier_attribution_case": carrier_attribution_case}


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
    # Los campos retirados: como clave de la respuesta y como alias, no como palabra de un texto.
    assert retired_fields("urgencia") == 1 and retired_fields("SELECT 1 AS funnel_group") == 1
    assert retired_fields("CASE … END AS driver_pending_docs_critical") == 1
    assert retired_fields("La urgencia de la fila") == 0
    # La atribución del embudo (CASE sobre la asignación ACTIVE), que carrier_attribution no ve.
    funnel = ("CASE r.entity_type WHEN 'CARRIER' THEN r.entity_id "
              "WHEN 'DRIVER' THEN COALESCE(da.carrier_id, x) WHEN 'ASSET' THEN aa.carrier_id END AS carrier_id")
    assert carrier_attribution_case(funnel) == 1 and carrier_attribution(funnel) == 0
    assert carrier_attribution_case("app.carrier_of(r.entity_type, r.entity_id) AS carrier_id") == 0
