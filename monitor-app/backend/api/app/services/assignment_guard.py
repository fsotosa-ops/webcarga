"""Guarda de asignación: a quién se le puede asignar un viaje (D1 §7.1).

Una sola validación para POST /trips, /trips/bulk, /trips/{id}/fleet-link,
/trips/assign-driver y el conductor habitual de un equipo
(POST /assets/{id}/driver-assignment). La prueba de que todas pasan por acá es
tests/test_assignment_guard_wiring.py.

  · Rechaza (409) lo que no puede operar por su CICLO DE VIDA: empresa no
    activa (CARRIER_NOT_ACTIVE: dada de baja o en onboarding, C-R8),
    conductor dado de baja (DRIVER_INACTIVE), tracto o rampla dados de baja
    (ASSET_INACTIVE, C-R9).
  · Avisa, sin bloquear, a la empresa activa que NO ESTÁ HABILITADA por sus
    documentos (CARRIER_NOT_ENABLED). Bloquearla es la pregunta abierta P14:
    el día que se decida, es mover ese caso de `warnings` a `blocking`.

La empresa que se evalúa es la elegida o, si no se eligió, la del conductor
(app.carrier_of): es la que app.resolve_trip_fleet() le pone al vínculo manual
cuando falta (C-R6).

Un id que no existe no se rechaza acá: lo rechaza la foreign key al escribir,
con el error de siempre. La guarda solo dice que no a lo que existe y no puede
operar. Por eso una fila ausente en la consulta no es un error.

Todo es de lectura y va por la conexión que se le pasa: dentro de la
transacción de la ruta, nunca por el pool (test_no_pool_call_inside_a_transaction_block)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from fastapi import HTTPException

from .fleet_compliance import carrier_compliance_cte

CARRIER_NOT_ACTIVE = "CARRIER_NOT_ACTIVE"
DRIVER_INACTIVE = "DRIVER_INACTIVE"
ASSET_INACTIVE = "ASSET_INACTIVE"
CARRIER_NOT_ENABLED = "CARRIER_NOT_ENABLED"

# Las palabras del glosario (spec D1 §3): INACTIVE y LEGACY_INACTIVE se dicen igual ("dada de baja").


@dataclass(frozen=True)
class AssignmentSubjects:
    """Lo que una escritura va a vincular. `check_carrier=False` para lo que no
    es un viaje (el conductor habitual de un equipo)."""
    carrier_id: str | None = None
    driver_id: str | None = None
    asset_ids: tuple[str, ...] = ()
    check_carrier: bool = True
    # A qué se asigna, solo para el texto del 409: "trip" (un viaje) o
    # "usual_driver" (el conductor habitual de un equipo). No va atado a
    # check_carrier: el PATCH de patente de un viaje tampoco evalúa la empresa
    # y es un viaje.
    target: str = "trip"


@dataclass(frozen=True)
class AssignmentCheck:
    blocking: dict | None = None
    warnings: tuple[dict, ...] = ()


# Una fila por ítem, en una sola consulta: el lote llega a 500 filas.
_SUBJECTS_SQL = """
SELECT s.idx,
       c.id::text AS carrier_id, c.business_name, c.operational_status AS carrier_status,
       d.full_name AS driver_name, d.operational_status AS driver_status,
       (SELECT array_agg(a.license_plate ORDER BY a.license_plate)
          FROM public.assets a
         WHERE a.id = ANY(string_to_array(NULLIF(s.asset_ids, ''), ',')::uuid[])
           AND a.operational_status <> 'ACTIVE') AS inactive_plates
FROM unnest($1::int[], $2::uuid[], $3::uuid[], $4::text[], $5::bool[])
     AS s(idx, carrier_id, driver_id, asset_ids, check_carrier)
LEFT JOIN public.carriers c
       ON s.check_carrier AND c.id = COALESCE(s.carrier_id, app.carrier_of('DRIVER', s.driver_id))
LEFT JOIN public.drivers d ON d.id = s.driver_id
"""

# La habilitación sale del único lugar que la calcula (fleet_compliance, T4).
# Solo se pide para las empresas activas del lote: a las demás ya las rechaza
# el ciclo de vida.
_CAN_OPERATE_SQL = f"""
WITH {carrier_compliance_cte()}
SELECT carrier_id::text, can_operate FROM carrier_compliance WHERE carrier_id = ANY($1::uuid[])
"""


# Texto del 409 por conductor o equipo de baja, según a qué se asigna.
_INACTIVE_MESSAGES = {
    "trip": {
        DRIVER_INACTIVE: "El conductor {} está dado de baja: no se le pueden asignar viajes.",
        ASSET_INACTIVE: "El equipo {} está dado de baja: no se le pueden asignar viajes.",
    },
    "usual_driver": {
        DRIVER_INACTIVE: ("El conductor {} está dado de baja: no puede ser el conductor habitual de un "
                          "equipo. Reactívalo en el Directorio."),
        ASSET_INACTIVE: ("El equipo {} está dado de baja: no se le puede asignar un conductor habitual. "
                         "Reactívalo en el Directorio."),
    },
}


def _verdict(row, can_operate: dict[str, bool], target: str = "trip") -> AssignmentCheck:
    if row is None:
        return AssignmentCheck()
    if row["carrier_id"] and row["carrier_status"] == "ONBOARDING":
        # C-R8 (confirmado por el usuario): en onboarding se le piden documentos, pero no recibe viajes.
        return AssignmentCheck(blocking={
            "code": CARRIER_NOT_ACTIVE,
            "message": (f"La empresa {row['business_name']} está en onboarding: actívala en el "
                        "Directorio para asignarle viajes.")})
    if row["carrier_id"] and row["carrier_status"] != "ACTIVE":
        return AssignmentCheck(blocking={
            "code": CARRIER_NOT_ACTIVE,
            "message": f"La empresa {row['business_name']} está dada de baja: no se le pueden asignar viajes."})
    if row["driver_status"] is not None and row["driver_status"] != "ACTIVE":
        return AssignmentCheck(blocking={
            "code": DRIVER_INACTIVE,
            "message": _INACTIVE_MESSAGES[target][DRIVER_INACTIVE].format(row["driver_name"])})
    if row["inactive_plates"]:
        return AssignmentCheck(blocking={
            "code": ASSET_INACTIVE,
            "message": _INACTIVE_MESSAGES[target][ASSET_INACTIVE].format(row["inactive_plates"][0])})
    # `is False`, no `not`: una empresa sin fila en carrier_compliance no tiene
    # nada pendiente (contrato de la T4, Review Focus 1) y no se avisa.
    if row["carrier_id"] and can_operate.get(row["carrier_id"]) is False:
        return AssignmentCheck(warnings=({
            "code": CARRIER_NOT_ENABLED,
            "message": (f"La empresa {row['business_name']} no está habilitada: tiene documentos "
                        "obligatorios vencidos o faltantes. El viaje quedó asignado igual."),
        },))
    return AssignmentCheck()


async def check_assignments(conn, items: Sequence[AssignmentSubjects]) -> list[AssignmentCheck]:
    """Un veredicto por ítem, en el mismo orden. Dos consultas por lote, no por ítem."""
    if not items:
        return []
    rows = {r["idx"]: r for r in await conn.fetch(
        _SUBJECTS_SQL,
        list(range(len(items))),
        [i.carrier_id for i in items],
        [i.driver_id for i in items],
        [",".join(i.asset_ids) for i in items],
        [i.check_carrier for i in items],
    )}
    activas = sorted({r["carrier_id"] for r in rows.values()
                      if r["carrier_id"] and r["carrier_status"] == "ACTIVE"})
    can_operate = ({r["carrier_id"]: r["can_operate"] for r in await conn.fetch(_CAN_OPERATE_SQL, activas)}
                   if activas else {})
    return [_verdict(rows.get(i), can_operate, item.target) for i, item in enumerate(items)]


async def enforce_assignment(conn, subjects: AssignmentSubjects | None) -> list[dict]:
    """409 si algo no puede operar; si no, los avisos (lista vacía si no hay)."""
    if subjects is None:
        return []
    (check,) = await check_assignments(conn, [subjects])
    if check.blocking:
        raise HTTPException(409, check.blocking)
    return list(check.warnings)
