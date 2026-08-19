"""Motor de match: nombre de archivo → entidad + tipo de documento.

Función PURA, sin I/O: recibe el universo de entidades y el catálogo de alias ya
cargados, y devuelve candidatos ordenados por confianza. Quien la llama se
encarga de leer la DB y de persistir el resultado.

Está diseñada así a propósito. El repo tiene precedente de bugs de Postgres que
los tests con AsyncMock no detectaron; un motor puro se testea con datos reales
y el SQL se verifica por separado contra la base.
"""
import re
import unicodedata
from dataclasses import dataclass, field
from difflib import SequenceMatcher

# Debajo de esto ni siquiera se propone: es ruido.
_FUZZY_FLOOR = 0.80
# Desde acá se aplica sin intervención humana.
_AUTO_THRESHOLD = 0.90
# Dos candidatos más cerca que esto son indistinguibles: decide una persona.
_AMBIGUITY_MARGIN = 0.05

# Un RUT chileno en un nombre de archivo: 7-8 dígitos + DV, con o sin guión y
# con o sin puntos de miles. El DV se valida aparte por módulo 11, que es lo que
# hace que la tasa de falsos positivos sea ~0.
_RUT_RE = re.compile(r"(\d{1,3}(?:\.\d{3})+|\d{7,8})-?([\dkK])(?!\d)")


def normalize_text(value: str) -> str:
    """Mayúsculas, sin tildes, sin puntuación — todo separador pasa a espacio.

    'Carpeta_Tributaria_Regular' → 'CARPETA TRIBUTARIA REGULAR'
    """
    decomposed = unicodedata.normalize("NFKD", value)
    ascii_only = "".join(c for c in decomposed if not unicodedata.combining(c))
    upper = ascii_only.upper()
    return " ".join(re.sub(r"[^A-Z0-9]+", " ", upper).split())


def rut_dv(rut_digits: str) -> str:
    """Dígito verificador chileno (módulo 11)."""
    total = 0
    multiplier = 2
    for digit in reversed(rut_digits):
        total += int(digit) * multiplier
        multiplier = 2 if multiplier == 7 else multiplier + 1
    remainder = 11 - (total % 11)
    if remainder == 11:
        return "0"
    if remainder == 10:
        return "K"
    return str(remainder)


def extract_ruts(file_name: str) -> list[str]:
    """RUTs con DV VÁLIDO presentes en el nombre, normalizados a '12345678-9'.

    Descarta los que no validan: sin esto, cualquier número largo de un nombre
    tipo '..._260603_161130.pdf' se leería como RUT.
    """
    found = []
    for raw_digits, raw_dv in _RUT_RE.findall(file_name):
        digits = raw_digits.replace(".", "")
        if rut_dv(digits) == raw_dv.upper():
            found.append(f"{digits}-{raw_dv.upper()}")
    return found


@dataclass(frozen=True)
class RequirementAlias:
    """Una forma de escribir un tipo de documento en un nombre de archivo."""
    requirement_id: str
    target_entity: str  # CARRIER | DRIVER | ASSET
    alias: str
    priority: int = 0
    # Código canónico del requisito (REVISION_TECNICA, F30_MULTAS…). Lo usa el
    # manifiesto, que declara el tipo por código y no por alias.
    requirement_code: str | None = None


@dataclass(frozen=True)
class Catalog:
    aliases: list[RequirementAlias] = field(default_factory=list)


@dataclass(frozen=True)
class EntityUniverse:
    """Entidades candidatas. Tuplas planas para no acoplar a un ORM.

    carriers: (id, tax_id, business_name)
    drivers:  (id, tax_id, full_name)
    assets:   (id, license_plate)
    """
    carriers: list[tuple] = field(default_factory=list)
    drivers: list[tuple] = field(default_factory=list)
    assets: list[tuple] = field(default_factory=list)


@dataclass(frozen=True)
class MatchCandidate:
    entity_type: str
    entity_id: str
    requirement_id: str | None
    confidence: float
    evidence: dict


def _from_manifest(row: dict, catalog: Catalog, universe: EntityUniverse):
    """Resuelve una fila del manifiesto contra el universo.

    `identificador` es RUT de empresa, RUT de conductor o patente — se prueba
    contra los tres, así el operador no tiene que declarar de qué tipo es.
    """
    identifier = normalize_text(str(row.get("identificador") or ""))
    code = str(row.get("requirement_code") or "").strip().upper()
    if not identifier:
        return None

    lookups = (
        ("CARRIER", [(e, ident) for e, ident, _n in universe.carriers]),
        ("DRIVER", [(e, ident) for e, ident, _n in universe.drivers]),
        ("ASSET", list(universe.assets)),
    )
    for entity_type, rows in lookups:
        for entity_id, raw_identifier in rows:
            if normalize_text(str(raw_identifier or "")) != identifier:
                continue
            requirement = next(
                (a for a in catalog.aliases
                 if a.target_entity == entity_type and a.requirement_code == code),
                None,
            )
            return MatchCandidate(
                entity_type=entity_type,
                entity_id=entity_id,
                requirement_id=requirement.requirement_id if requirement else None,
                confidence=1.0,
                evidence={
                    "entity": {"via": "MANIFEST", "score": 1.0, "raw": str(raw_identifier)},
                    "type": {"via": "MANIFEST", "score": 1.0, "alias": code},
                },
            )
    return None


def classify_match(candidates: list[MatchCandidate]) -> str:
    """Traduce los candidatos al match_status que persiste la bandeja.

    La regla de oro: solo se aplica solo lo que tiene identificador fuerte, un
    único candidato y un tipo de documento resuelto. Todo lo demás lo confirma
    una persona, y nada se descarta nunca.
    """
    if not candidates:
        return "UNMATCHED"

    top = candidates[0]
    rivals = [c for c in candidates[1:] if abs(top.confidence - c.confidence) < _AMBIGUITY_MARGIN]
    if rivals:
        return "AMBIGUOUS"
    if top.confidence >= _AUTO_THRESHOLD and top.requirement_id is not None:
        return "AUTO"
    return "SUGGESTED"


def _match_requirement(normalized_name: str, catalog: Catalog, target_entity: str):
    """Alias de mayor priority que aparece en el nombre. None si ninguno.

    La prioridad es lo que resuelve el solapamiento por substring: 'USO Y
    MANTENCION EPP' (100) le gana a 'EPP' (10), que está contenido en él.
    """
    best = None
    for alias in catalog.aliases:
        if alias.target_entity != target_entity:
            continue
        if normalize_text(alias.alias) not in normalized_name:
            continue
        if best is None or alias.priority > best.priority:
            best = alias
    return best


def best_name_similarity(normalized_name: str, candidate_name: str) -> float:
    """Mejor similitud entre el nombre buscado y una ventana del nombre de archivo.

    Compara ventanas deslizantes del mismo largo en tokens que el nombre
    buscado, para que el tipo de documento que rodea a la persona
    ('TRABAJO SEGURO ...') no diluya el puntaje.
    """
    target = normalize_text(candidate_name)
    if not target:
        return 0.0

    target_tokens = target.split()
    haystack_tokens = normalized_name.split()
    window = len(target_tokens)
    if not haystack_tokens or window == 0:
        return 0.0

    best = 0.0
    for start in range(max(1, len(haystack_tokens) - window + 1)):
        chunk = " ".join(haystack_tokens[start:start + window])
        best = max(best, SequenceMatcher(None, target, chunk).ratio())
    return best


def _fuzzy_confidence(ratio: float) -> float:
    """Mapea similitud a confianza.

    Un match exacto llega a 0.90 (auto-commit); uno aproximado se queda por
    debajo a propósito — un typo siempre pasa por confirmación humana.
    """
    if ratio >= 0.999:
        return 0.90
    return round(0.60 + (ratio - _FUZZY_FLOOR) * 1.4, 3)


def match_document(
    *,
    file_name: str,
    catalog: Catalog,
    universe: EntityUniverse,
    manifest_row: dict | None = None,
) -> list[MatchCandidate]:
    """Candidatos para un archivo, ordenados por confianza (mayor primero).

    El scope de empresa se aplica ACOTANDO EL UNIVERSO antes de llamar: cuando
    el lote es de una sola empresa, el caller pasa solo sus entidades. Así el
    scope no puede quedar desincronizado entre el filtro y el match.
    """
    normalized = normalize_text(file_name)
    candidates: list[MatchCandidate] = []

    # El manifiesto es una declaración explícita del operador: corta la cascada.
    # Es lo único que rescata a los archivos sin señal en el nombre.
    if manifest_row:
        resolved = _from_manifest(manifest_row, catalog, universe)
        if resolved:
            return [resolved]

    ruts = extract_ruts(file_name)
    for rut in ruts:
        for entity_id, tax_id, _name in universe.carriers:
            if tax_id != rut:
                continue
            requirement = _match_requirement(normalized, catalog, "CARRIER")
            candidates.append(MatchCandidate(
                entity_type="CARRIER",
                entity_id=entity_id,
                requirement_id=requirement.requirement_id if requirement else None,
                confidence=0.95 if requirement else 0.60,
                evidence={
                    "entity": {"via": "RUT", "score": 0.95, "raw": rut},
                    "type": (
                        {"via": "ALIAS", "score": 0.85, "alias": requirement.alias}
                        if requirement else {"via": None}
                    ),
                },
            ))

    # Vehículo por patente. No hay que "reconocer" un formato: se busca cuál de
    # las patentes que existen aparece en el nombre. Diccionario cerrado ⇒ no
    # se puede inventar un vehículo que no está en la flota.
    name_tokens = set(normalized.split())
    for entity_id, license_plate in universe.assets:
        plate = normalize_text(license_plate)
        if not plate or plate not in name_tokens:
            continue
        requirement = _match_requirement(normalized, catalog, "ASSET")
        candidates.append(MatchCandidate(
            entity_type="ASSET",
            entity_id=entity_id,
            requirement_id=requirement.requirement_id if requirement else None,
            confidence=0.95 if requirement else 0.60,
            evidence={
                "entity": {"via": "PATENTE", "score": 0.95, "raw": license_plate},
                "type": (
                    {"via": "ALIAS", "score": 0.85, "alias": requirement.alias}
                    if requirement else {"via": None}
                ),
            },
        ))

    # Conductor por RUT en el nombre del archivo. Simétrica a la rama de
    # empresas de arriba: sin esto, un archivo que trae el RUT del conductor
    # ADEMÁS de su nombre queda peor que uno que solo trae el nombre — el
    # `continue` de la rama difusa de abajo lo saca del match difuso, y antes
    # de este cambio nada más abajo lo recogía.
    for rut in ruts:
        for entity_id, tax_id, _name in universe.drivers:
            if tax_id != rut:
                continue
            requirement = _match_requirement(normalized, catalog, "DRIVER")
            candidates.append(MatchCandidate(
                entity_type="DRIVER",
                entity_id=entity_id,
                requirement_id=requirement.requirement_id if requirement else None,
                confidence=0.95 if requirement else 0.60,
                evidence={
                    "entity": {"via": "RUT", "score": 0.95, "raw": rut},
                    "type": (
                        {"via": "ALIAS", "score": 0.85, "alias": requirement.alias}
                        if requirement else {"via": None}
                    ),
                },
            ))

    # Conductor por nombre de persona. Es el caso dominante en SharePoint:
    # el nombre del archivo trae la persona, no su RUT.
    for entity_id, tax_id, full_name in universe.drivers:
        if tax_id and tax_id in ruts:
            continue  # ya resuelto por identificador fuerte más arriba
        ratio = best_name_similarity(normalized, full_name)
        if ratio < _FUZZY_FLOOR:
            continue
        requirement = _match_requirement(normalized, catalog, "DRIVER")
        candidates.append(MatchCandidate(
            entity_type="DRIVER",
            entity_id=entity_id,
            requirement_id=requirement.requirement_id if requirement else None,
            confidence=_fuzzy_confidence(ratio),
            evidence={
                "entity": {"via": "NOMBRE_FUZZY", "score": round(ratio, 3), "raw": full_name},
                "type": (
                    {"via": "ALIAS", "score": 0.85, "alias": requirement.alias}
                    if requirement else {"via": None}
                ),
            },
        ))

    candidates.sort(key=lambda c: c.confidence, reverse=True)
    return candidates
