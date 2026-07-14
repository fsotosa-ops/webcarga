"""Calcula el diff en memoria entre las filas parseadas del Excel EETT
(`centralizer_parser.parse_centralizer_workbook`, Task 1) y el estado actual
de `app.transporters`/`app.drivers`/`app.vehicles` + sus tablas de
documentos angostas (`app.transporter_documents`/`app.driver_documents`/
`app.vehicle_documents`).

No persiste nada — este módulo es puramente de lectura + comparación. El
router de upload (Task 3, fuera de este alcance) es quien decide qué aplicar
y cuándo, y recalcula este diff de nuevo dentro de la transacción de
`apply` (no confía en un diff calculado en un preview anterior).

Columnas verificadas en vivo contra Supabase (proyecto viclzoftiudkepqnhekv,
2026-07-13) antes de escribir las queries de este módulo:
  - `app.transporters`: rut, dv, business_name, admin_internal_id,
    manually_edited_fields (ARRAY), baja_override, id.
  - `app.drivers`/`app.vehicles`: SÍ tienen su propia columna
    `manually_edited_fields` (ARRAY) y `baja_override` — no hay que asumir,
    estaba en la duda explícita del brief y se confirmó que existen en las
    3 tablas, con el mismo tipo (ARRAY/text[]) que transporters.
  - `app.drivers`/`app.vehicles` NO tienen `admin_internal_id` (columna
    exclusiva de `app.transporters`) — por eso el fallback de matching por
    ID legado sólo aplica a transporters (el propio parser tampoco mapea
    esa columna para las hojas Conductores/Vehiculos_Equipos).
  - `app.vehicles` no tiene columna `rut` propia (confirmado también por el
    parser, ver docstring de `centralizer_parser.py`) — el match de
    vehículos es por `plate`, no por rut.
  - `app.{transporter,driver,vehicle}_documents`: `doc_name`, `status`,
    `manual_override`, y la FK correspondiente
    (`transporter_id`/`driver_id`/`vehicle_id`).

Decisión de diseño — severidad de conflicto a nivel de fila:
El brief pide que un campo con override manual se marque `conflict` "sin
bloquear toda la fila" (permitir aplicar los campos limpios e ignorar los
que están en conflicto), pero también pide explícitamente (ver tests) que
una fila donde el ÚNICO campo que cambió está en conflicto quede con
`change_type='conflict'` a nivel de entidad completa (no 'updated' con un
field_diff suelto que nadie aplicaría). Se resuelve así:
  - Si hay al menos un campo "limpio" (sin override) que difiere -> row
    'updated' (aplicable parcialmente), y cada `field_diff` individual trae
    una clave extra `conflict: bool` para que el paso de apply (Task 3)
    sepa cuáles de esos campos debe saltarse.
  - Si TODOS los campos que difieren están en conflicto (no hay nada limpio
    que aplicar) -> row 'conflict', `conflict_reason='manually_edited_field'`.
  - `baja_override=true` en la entidad matcheada tiene prioridad absoluta:
    toda la fila es 'conflict' con `conflict_reason='baja_override_active'`,
    sin importar si los datos en verdad difieren o no (blindaje explícito
    contra "revivir" algo dado de baja intencionalmente vía un upload).

La clave `conflict` dentro de cada `field_diffs[i]` es una extensión sobre
la forma mínima descrita en el brief (`{field, old, new}`) — necesaria para
que Task 3 pueda distinguir campos aplicables de campos en conflicto dentro
de una misma fila 'updated'. `entity_key` es el rut normalizado
(transporters/drivers) o la patente (vehicles); `match_method` usa 'rut'
para transporters/drivers matcheados por su propio rut, 'legacy_id' para
transporters matcheados por `admin_internal_id`, y 'plate' para vehicles
(no hay campo rut propio para vehicles — ver arriba).

Decisión de diseño — upload parcial (Conductores/Vehiculos_Equipos de una
empresa que NO viene en la hoja Empresas de este archivo):
El Excel de origen no siempre es una foto completa de todas las empresas —
puede ser un archivo recortado que solo trae altas/cambios puntuales. Antes
de este fix, un `transporter_rut` que no apareciera en la hoja Empresas del
MISMO archivo se rechazaba como huérfano aunque esa empresa ya existiera en
`app.transporters` por un upload anterior (bug real, encontrado auditando
Checkpoints E/F). Ahora, además de los RUTs de la hoja Empresas de este
upload (`batch_ruts`), se consulta `app.transporters` por los
`transporter_rut` que Conductores/Vehiculos_Equipos referencian y que NO
están en ese batch — si ya existen en la base, se aceptan (no huérfano).
Solo queda huérfano un RUT que ni está en este archivo ni existe ya en la
base. El mapeo resultante se expone en `DiffResult["transporter_id_by_rut"]`
porque estas empresas no generan `EntityDiff` en `transporters` (no vinieron
en la hoja Empresas de este upload) — el router de apply (Task 3) lo
necesita para resolver el FK de esos drivers/vehicles.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any, TypedDict

from .centralizer_parser import ParsedUpload


class FieldDiff(TypedDict):
    field: str
    old: Any
    new: Any
    conflict: bool


class EntityDiff(TypedDict):
    entity_key: str
    match_method: str | None
    existing_id: str | None
    change_type: str  # "new" | "updated" | "unchanged" | "conflict"
    field_diffs: list[FieldDiff]
    conflict_reason: str | None
    parsed_row: dict


class DiffResult(TypedDict):
    transporters: list[EntityDiff]
    drivers: list[EntityDiff]
    vehicles: list[EntityDiff]
    # Filas de drivers/vehicles cuyo transporter_rut no matchea ninguna fila
    # de la hoja Empresas del mismo upload (huérfanas) — no generan
    # EntityDiff, se registran acá en vez de crashear. Mismo shape que
    # ParsedUpload["parse_errors"] (sheet/identifier/reason).
    parse_errors: list[dict]
    # RUT -> id de transporter, para TODO rut referenciado por Conductores/
    # Vehiculos_Equipos que ya existe en `app.transporters` — incluye tanto
    # los de la hoja Empresas de este upload (`transporters` arriba) como los
    # de empresas ya existentes en la base que esta subida no volvió a traer
    # (upload parcial, ver decisión de diseño abajo). El router de upload
    # (Task 3) lo usa para resolver el FK de drivers/vehicles sin depender de
    # que su empresa haya aparecido en el diff de `transporters`.
    transporter_id_by_rut: dict[str, str]


_TRANSPORTER_NATIVE_FIELDS = ["business_name"]
_DRIVER_NATIVE_FIELDS = ["full_name", "id_expiry", "license_expiry"]
_VEHICLE_NATIVE_FIELDS = [
    "kind", "type_label", "year",
    "circ_permit_expiry", "tech_inspection_expiry",
    "gas_emissions_expiry", "soap_insurance_expiry",
]


def _diff_fields(
    parsed_row: dict,
    existing_row: dict | None,
    native_fields: list[str],
    existing_docs: dict[str, dict],
) -> list[FieldDiff]:
    manually_edited = set((existing_row or {}).get("manually_edited_fields") or [])
    field_diffs: list[FieldDiff] = []

    for field in native_fields:
        new_value = parsed_row.get(field)
        old_value = (existing_row or {}).get(field)
        if new_value == old_value:
            continue
        field_diffs.append({
            "field": field,
            "old": old_value,
            "new": new_value,
            "conflict": field in manually_edited,
        })

    for doc_code, new_status in parsed_row.get("documents", {}).items():
        existing_doc = existing_docs.get(doc_code)
        old_status = existing_doc["status"] if existing_doc else None
        if new_status == old_status:
            continue
        field_diffs.append({
            "field": f"documents.{doc_code}",
            "old": old_status,
            "new": new_status,
            "conflict": bool(existing_doc and existing_doc.get("manual_override")),
        })

    return field_diffs


def _classify(existing_row: dict | None, field_diffs: list[FieldDiff]) -> tuple[str, str | None]:
    if existing_row is None:
        return "new", None
    if existing_row.get("baja_override"):
        return "conflict", "baja_override_active"
    if not field_diffs:
        return "unchanged", None
    has_clean = any(not fd["conflict"] for fd in field_diffs)
    has_conflict = any(fd["conflict"] for fd in field_diffs)
    if has_conflict and not has_clean:
        return "conflict", "manually_edited_field"
    return "updated", None


def _build_entity_diff(
    row: dict,
    entity_key: str,
    existing_row: dict | None,
    match_method: str | None,
    native_fields: list[str],
    existing_docs: dict[str, dict],
) -> EntityDiff:
    field_diffs = _diff_fields(row, existing_row, native_fields, existing_docs)
    change_type, conflict_reason = _classify(existing_row, field_diffs)
    return {
        "entity_key": entity_key,
        "match_method": match_method if existing_row else None,
        "existing_id": str(existing_row["id"]) if existing_row else None,
        "change_type": change_type,
        "field_diffs": field_diffs,
        "conflict_reason": conflict_reason,
        "parsed_row": row,
    }


async def _diff_transporters(pool, rows: list[dict]) -> tuple[list[EntityDiff], set[str]]:
    batch_ruts = {row["rut"] for row in rows}
    if not rows:
        return [], batch_ruts

    ruts = [row["rut"] for row in rows]
    admin_ids = [row["admin_internal_id"] for row in rows if row.get("admin_internal_id")]

    existing_rows = [
        dict(r) for r in await pool.fetch(
            "SELECT id, business_name, rut, dv, account_stage, admin_internal_id, "
            "manually_edited_fields, baja_override "
            "FROM app.transporters WHERE rut = ANY($1::text[]) OR admin_internal_id = ANY($2::int[])",
            ruts, admin_ids,
        )
    ]
    by_rut = {r["rut"]: r for r in existing_rows}
    by_admin_id = {r["admin_internal_id"]: r for r in existing_rows if r.get("admin_internal_id") is not None}

    transporter_ids = [r["id"] for r in existing_rows]
    docs_by_transporter: dict[Any, dict[str, dict]] = defaultdict(dict)
    if transporter_ids:
        doc_rows = await pool.fetch(
            "SELECT transporter_id, doc_name, status, manual_override "
            "FROM app.transporter_documents WHERE transporter_id = ANY($1::uuid[])",
            transporter_ids,
        )
        for d in doc_rows:
            docs_by_transporter[d["transporter_id"]][d["doc_name"]] = dict(d)

    diffs: list[EntityDiff] = []
    for row in rows:
        existing = by_rut.get(row["rut"])
        match_method = "rut" if existing else None
        if existing is None and row.get("admin_internal_id"):
            existing = by_admin_id.get(row["admin_internal_id"])
            match_method = "legacy_id" if existing else None

        existing_docs = docs_by_transporter.get(existing["id"], {}) if existing else {}
        diffs.append(_build_entity_diff(
            row, row["rut"], existing, match_method,
            _TRANSPORTER_NATIVE_FIELDS, existing_docs,
        ))

    return diffs, batch_ruts


async def _diff_driver_or_vehicle(
    pool,
    rows: list[dict],
    transporter_ruts: set[str],
    sheet_name: str,
    identity_field: str,
    entity_table: str,
    fk_column: str,
    documents_table: str,
    native_fields: list[str],
) -> tuple[list[EntityDiff], list[dict]]:
    valid_rows: list[dict] = []
    errors: list[dict] = []
    for row in rows:
        transporter_rut = row.get("transporter_rut")
        if transporter_rut not in transporter_ruts:
            errors.append({
                "sheet": sheet_name,
                "identifier": row.get(identity_field),
                "reason": (
                    f"transporter_rut '{transporter_rut}' no matchea ninguna fila "
                    "de la hoja Empresas del mismo upload"
                ),
            })
            continue
        valid_rows.append(row)

    if not valid_rows:
        return [], errors

    identities = [row[identity_field] for row in valid_rows]
    existing_rows = [
        dict(r) for r in await pool.fetch(
            f"SELECT * FROM app.{entity_table} WHERE {identity_field} = ANY($1::text[])",
            identities,
        )
    ]
    by_identity = {r[identity_field]: r for r in existing_rows}

    entity_ids = [r["id"] for r in existing_rows]
    docs_by_entity: dict[Any, dict[str, dict]] = defaultdict(dict)
    if entity_ids:
        doc_rows = await pool.fetch(
            f"SELECT {fk_column}, doc_name, status, manual_override "
            f"FROM app.{documents_table} WHERE {fk_column} = ANY($1::uuid[])",
            entity_ids,
        )
        for d in doc_rows:
            docs_by_entity[d[fk_column]][d["doc_name"]] = dict(d)

    diffs: list[EntityDiff] = []
    for row in valid_rows:
        existing = by_identity.get(row[identity_field])
        existing_docs = docs_by_entity.get(existing["id"], {}) if existing else {}
        diffs.append(_build_entity_diff(
            row, row[identity_field], existing,
            "rut" if entity_table == "drivers" else "plate",
            native_fields, existing_docs,
        ))

    return diffs, errors


async def _lookup_preexisting_transporters(pool, ruts: set[str]) -> dict[str, str]:
    if not ruts:
        return {}
    rows = await pool.fetch(
        "SELECT rut, id FROM app.transporters WHERE rut = ANY($1::text[])",
        list(ruts),
    )
    return {r["rut"]: str(r["id"]) for r in rows}


async def compute_diff(pool, parsed: ParsedUpload) -> DiffResult:
    transporter_diffs, batch_ruts = await _diff_transporters(pool, parsed["transporters"])

    # RUTs que Conductores/Vehiculos_Equipos referencian pero que la hoja
    # Empresas de ESTE archivo no trae — pueden ser empresas ya existentes
    # en la base (upload parcial, ver decisión de diseño arriba) en vez de
    # huérfanas de verdad.
    referenced_ruts = {
        row["transporter_rut"]
        for row in (*parsed["drivers"], *parsed["vehicles"])
        if row.get("transporter_rut")
    }
    preexisting_by_rut = await _lookup_preexisting_transporters(pool, referenced_ruts - batch_ruts)
    known_ruts = batch_ruts | preexisting_by_rut.keys()

    driver_diffs, driver_errors = await _diff_driver_or_vehicle(
        pool, parsed["drivers"], known_ruts,
        sheet_name="Conductores", identity_field="rut",
        entity_table="drivers", fk_column="driver_id",
        documents_table="driver_documents", native_fields=_DRIVER_NATIVE_FIELDS,
    )
    vehicle_diffs, vehicle_errors = await _diff_driver_or_vehicle(
        pool, parsed["vehicles"], known_ruts,
        sheet_name="Vehiculos_Equipos", identity_field="plate",
        entity_table="vehicles", fk_column="vehicle_id",
        documents_table="vehicle_documents", native_fields=_VEHICLE_NATIVE_FIELDS,
    )

    transporter_id_by_rut = {
        **preexisting_by_rut,
        **{d["entity_key"]: d["existing_id"] for d in transporter_diffs if d["existing_id"]},
    }

    return {
        "transporters": transporter_diffs,
        "drivers": driver_diffs,
        "vehicles": vehicle_diffs,
        "parse_errors": [*driver_errors, *vehicle_errors],
        "transporter_id_by_rut": transporter_id_by_rut,
    }
