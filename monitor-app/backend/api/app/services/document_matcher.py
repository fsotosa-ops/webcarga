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

from ..utils.identity import canonical_plate, canonical_rut, plate_in_tokens

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


def extract_ruts(file_name: str) -> list[str]:
    """RUTs con DV VÁLIDO presentes en el nombre, normalizados a '12345678-9'.

    Descarta los que no validan: sin esto, cualquier número largo de un nombre
    tipo '..._260603_161130.pdf' se leería como RUT.
    """
    found = []
    for raw_digits, raw_dv in _RUT_RE.findall(file_name):
        canon = canonical_rut(f"{raw_digits}-{raw_dv}")
        if canon:
            found.append(canon)
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

    `scope_carrier_id` es la empresa a la que el CALLER acoto este universo, si
    lo hizo. No se deduce de `len(carriers) == 1`: una base con una sola empresa
    activa daria el mismo valor sin que nadie haya acotado nada, y esa
    ambiguedad es la clase de dato con dos sentidos que este proyecto ya arrastro
    cinco veces. Lo declara quien acota.
    """
    carriers: list[tuple] = field(default_factory=list)
    drivers: list[tuple] = field(default_factory=list)
    assets: list[tuple] = field(default_factory=list)
    scope_carrier_id: str | None = None


@dataclass(frozen=True)
class MatchCandidate:
    entity_type: str
    entity_id: str
    requirement_id: str | None
    confidence: float
    evidence: dict


def _same_identifier(entity_type: str, stored, declared: str) -> bool:
    """RUT o patente en forma canónica cuando las dos lo son; si no, el texto normalizado de siempre."""
    canon = canonical_plate if entity_type == "ASSET" else canonical_rut
    a, b = canon(str(stored or "")), canon(declared)
    if a is not None and b is not None:
        return a == b
    return normalize_text(str(stored or "")) == normalize_text(declared)


def _from_manifest(row: dict, catalog: Catalog, universe: EntityUniverse):
    """Resuelve una fila del manifiesto contra el universo.

    `identificador` es RUT de empresa, RUT de conductor o patente — se prueba
    contra los tres, así el operador no tiene que declarar de qué tipo es.
    """
    declared = str(row.get("identificador") or "")
    identifier = normalize_text(declared)
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
            if not _same_identifier(entity_type, raw_identifier, declared):
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


_STRONG_VIAS = {"RUT", "PATENTE"}
_DECLARED_VIAS = {"EMPRESA_DECLARADA", "MANIFEST"}


def match_document(
    *,
    file_name: str,
    catalog: Catalog,
    universe: EntityUniverse,
    manifest_row: dict | None = None,
    declared_requirement: RequirementAlias | None = None,
) -> list[MatchCandidate]:
    """El único reconocedor: de quién es un archivo y qué documento es.

    Lo usan la bandeja (Por asignar), la carga en lote de Pendientes y la subida
    sin contexto (Entrega D, 15/10). Antes Pendientes tenía su propio
    `match_owner`, con otra escala y otras reglas: el mismo archivo se proponía
    distinto según dónde se soltaba.

    El contexto ACOTA, no cambia el algoritmo:
    - la empresa elegida va en el universo (`scope_carrier_id`, cargar_universo);
    - el tipo conocido (Pendientes: se soltó sobre el F30-1) va en
      `declared_requirement`: el tipo deja de adivinarse y solo se proponen
      entidades de su familia.

    La evidencia de cada candidato es la entidad (RUT, patente, nombre, empresa
    declarada o manifiesto) y el tipo (declarado, alias en el nombre, o ninguno).
    Con el tipo conocido, la confianza es la de la entidad; sin tipo, 0.60, porque
    no se sabe a qué registro va. Ordenados por confianza (mayor primero), sin
    repetir (entidad, tipo).
    """
    normalized = normalize_text(file_name)

    # El manifiesto es una declaración explícita del operador: corta la cascada.
    # Es lo único que rescata a los archivos sin señal en el nombre.
    if manifest_row:
        resolved = _from_manifest(manifest_row, catalog, universe)
        if resolved:
            return [resolved]

    def tipo(family: str):
        """El tipo para una familia: el declarado (si es de esa familia), o el alias del nombre."""
        if declared_requirement is not None:
            if declared_requirement.target_entity != family:
                return None, None
            return declared_requirement, {"via": "DECLARADO", "score": 1.0}
        alias = _match_requirement(normalized, catalog, family)
        return alias, ({"via": "ALIAS", "score": 0.85, "alias": alias.alias} if alias else {"via": None})

    def families():
        if declared_requirement is not None:
            return {declared_requirement.target_entity}
        return {"CARRIER", "DRIVER", "ASSET"}

    candidates: list[MatchCandidate] = []

    def add(family: str, entity_id: str, entity_evidence: dict, entity_score: float, *, needs_type=False):
        requirement, type_evidence = tipo(family)
        if needs_type and requirement is None:
            return
        candidates.append(MatchCandidate(
            entity_type=family, entity_id=entity_id,
            requirement_id=requirement.requirement_id if requirement else None,
            confidence=entity_score if requirement else 0.60,
            evidence={"entity": entity_evidence, "type": type_evidence},
        ))

    allowed = families()

    # LA EMPRESA YA SABIDA: la declaró una persona al acotar el universo (entrar a
    # la bandeja de esa empresa, o subir desde su ficha). Es la evidencia más
    # fuerte, y la única que rescata un documento de empresa sin RUT en el nombre
    # ("Carpeta_Tributaria_Regular.pdf": medido, 67 archivos así no producían
    # nada). Solo para requisitos de empresa, y solo con tipo: saber la empresa no
    # dice cuál de sus 12 conductores es, y proponer uno sería inventar.
    if universe.scope_carrier_id and "CARRIER" in allowed:
        add("CARRIER", universe.scope_carrier_id, {"via": "EMPRESA_DECLARADA", "score": 0.95}, 0.95,
            needs_type=True)

    ruts = set(extract_ruts(file_name))
    token_list = normalized.split()

    if "CARRIER" in allowed:
        for entity_id, tax_id, business_name in universe.carriers:
            if canonical_rut(tax_id) in ruts:
                add("CARRIER", entity_id, {"via": "RUT", "score": 0.95, "raw": canonical_rut(tax_id)}, 0.95)
                continue
            ratio = best_name_similarity(normalized, business_name or "")
            if ratio >= _FUZZY_FLOOR:
                add("CARRIER", entity_id, {"via": "NOMBRE_FUZZY", "score": round(ratio, 3), "raw": business_name},
                    _fuzzy_confidence(ratio))

    # Vehículo por patente: diccionario cerrado, no se inventa un vehículo que no
    # está en la flota.
    if "ASSET" in allowed:
        for entity_id, license_plate in universe.assets:
            if plate_in_tokens(license_plate, token_list):
                add("ASSET", entity_id, {"via": "PATENTE", "score": 0.95, "raw": license_plate}, 0.95)

    # Conductor por RUT o por nombre (el caso dominante en SharePoint: el nombre
    # trae la persona, no su RUT).
    if "DRIVER" in allowed:
        for entity_id, tax_id, full_name in universe.drivers:
            if canonical_rut(tax_id) in ruts:
                add("DRIVER", entity_id, {"via": "RUT", "score": 0.95, "raw": canonical_rut(tax_id)}, 0.95)
                continue
            ratio = best_name_similarity(normalized, full_name)
            if ratio >= _FUZZY_FLOOR:
                add("DRIVER", entity_id, {"via": "NOMBRE_FUZZY", "score": round(ratio, 3), "raw": full_name},
                    _fuzzy_confidence(ratio))

    return _rank(prefer_identifiers(candidates))


def prefer_identifiers(candidates: list[MatchCandidate]) -> list[MatchCandidate]:
    """Un identificador (RUT, patente) en el nombre gana sobre los NOMBRES de su
    misma familia: un homónimo con otro RUT (nombre exacto, 0.90) quedaba a menos
    de _AMBIGUITY_MARGIN del 0.95 y volvía ambiguo un archivo que sí identifica a su
    dueño. Por familia: el RUT de la empresa no borra al conductor nombrado en el
    mismo archivo, que puede ser el documento de él.

    Pública porque quien acota DESPUÉS del motor (Pendientes: solo quienes deben
    el documento) la aplica sobre lo que le queda: un RUT de alguien que no lo
    debe no puede borrar a quien sí."""
    strong = {c.entity_type for c in candidates if c.evidence["entity"]["via"] in _STRONG_VIAS}
    return [c for c in candidates
            if not (c.entity_type in strong and c.evidence["entity"]["via"] == "NOMBRE_FUZZY")]


def _rank(candidates: list[MatchCandidate]) -> list[MatchCandidate]:
    """De mayor a menor confianza, una vez por (entidad, tipo): un RUT repetido en
    el nombre (`F30_<rut>_ANEXO_<rut>.pdf`) no es un empate consigo mismo."""
    seen: set[tuple] = set()
    out = []
    for c in sorted(candidates, key=lambda c: c.confidence, reverse=True):
        key = (c.entity_type, c.entity_id, c.requirement_id)
        if key not in seen:
            seen.add(key)
            out.append(c)
    return out


def reason_of(c: MatchCandidate) -> str:
    """Por qué se propuso, dicho para la pantalla: rut | plate | name | declared."""
    via = c.evidence["entity"]["via"]
    return {"RUT": "rut", "PATENTE": "plate", "NOMBRE_FUZZY": "name"}.get(via, "declared")


def _strength(c: MatchCandidate) -> tuple[bool, float]:
    """Un identificador o una declaración pesan más que cualquier nombre."""
    return (reason_of(c) != "name", c.confidence)


def _outranks(a: MatchCandidate, b: MatchCandidate) -> bool:
    """`a` es estrictamente más fuerte que `b`: identificador contra nombre, o
    la misma clase de razón con más de _AMBIGUITY_MARGIN de confianza."""
    if (reason_of(a) != "name") != (reason_of(b) != "name"):
        return reason_of(a) != "name"
    return a.confidence - b.confidence > _AMBIGUITY_MARGIN


def resolve_collisions(tops: list[MatchCandidate | None]) -> dict[int, str]:
    """Regla de choque del lote (P23). Cuando varios archivos van al mismo
    registro (entidad + tipo), si UNO es estrictamente más fuerte que todos los
    demás, ese queda y los otros bajan ("outranked"); si no hay uno así (dos RUT
    exactos, dos nombres parecidos) bajan todos ("tie"). Devuelve índice -> motivo,
    solo de los que bajan. La pantalla repite esta regla en `usePendingBulkUpload`."""
    groups: dict[tuple, list[int]] = {}
    for i, c in enumerate(tops):
        if c is not None:
            groups.setdefault((c.entity_type, c.entity_id, c.requirement_id), []).append(i)
    demoted: dict[int, str] = {}
    for idx in groups.values():
        if len(idx) < 2:
            continue
        best = max(idx, key=lambda i: _strength(tops[i]))
        if all(_outranks(tops[best], tops[i]) for i in idx if i != best):
            demoted.update({i: "outranked" for i in idx if i != best})
        else:
            demoted.update({i: "tie" for i in idx})
    return demoted
