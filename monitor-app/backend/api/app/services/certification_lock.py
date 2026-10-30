"""Lo dado de baja no recibe documentación, por ningún camino.

Pedido del usuario (07/09): *"si una empresa se da baja en el modulo de
directorio, automaticamente debe dejar de solicitar documentacion, es como si se
bloqueara su espacio de certificacion"*. Y el 30/10: *"que no acepte nada por
ningún camino"*, también para un conductor o un equipo dado de baja.

POR QUÉ ESTE MÓDULO. Hasta el 30/10 la regla estaba escrita dos veces, a mano,
dentro de dos consultas (subir y clasificar), y comparaba
`operational_status <> 'ACTIVE'`: se escribió antes de que existiera el
onboarding, así que una empresa en onboarding —la que justamente está armando su
carpeta— no podía recibir archivos, con un mensaje que decía "dada de baja". Los
otros ocho caminos de escritura (planilla, editar, reasignar, solicitar, la
bandeja…) no tenían la regla. Ahora vive aquí, una vez, y todos la llaman.

Qué cuenta como "en certificación" no se decide aquí: lo dicen
`CARRIER_STATUSES_IN_CERTIFICATION` y `FLEET_STATUSES_IN_CERTIFICATION`.

Bloquea la ESCRITURA, no la lectura: dar de baja archiva, no oculta, y al
reactivar lo primero que se necesita ver es qué se venció durante la baja. Los
procesos automáticos (vencer, sembrar requisitos) no pasan por aquí: calculan
estado, no aceptan documentación.

La empresa sale de `app.carrier_of`, la respuesta única a "¿de qué empresa es?"
(D1): `entity_id` es polimórfico y resolverlo a mano es un error que este
proyecto ya cometió. Un conductor o equipo sin empresa vigente no está dado de
baja: sus documentos son de la persona o del vehículo, y se aceptan.
"""
from __future__ import annotations

from fastapi import HTTPException

from ..schemas.states import CARRIER_STATUSES_IN_CERTIFICATION, FLEET_STATUSES_IN_CERTIFICATION

# Una sola consulta para los dos usos; cambia sólo de dónde salen los sujetos.
_STATUS_SQL = """
SELECT k.key,
       c.business_name AS carrier_name, c.operational_status AS carrier_status,
       k.entity_type,
       COALESCE(d.operational_status, a.operational_status) AS subject_status,
       COALESCE(d.full_name, a.license_plate) AS subject_name
FROM ({source}) k
LEFT JOIN public.carriers c ON c.id = app.carrier_of(k.entity_type, k.entity_id)
LEFT JOIN public.drivers d ON k.entity_type = 'DRIVER' AND d.id = k.entity_id
LEFT JOIN public.assets a ON k.entity_type = 'ASSET' AND a.id = k.entity_id
"""
_FOR_RECORDS = _STATUS_SQL.format(source=(
    "SELECT cr.id::text AS key, cr.entity_type, cr.entity_id "
    "FROM public.compliance_records cr WHERE cr.id = ANY($1::uuid[])"))
_FOR_SUBJECT = _STATUS_SQL.format(source=(
    "SELECT $2::text AS key, $1::text AS entity_type, $2::uuid AS entity_id"))

_SUBJECT_LABEL = {"DRIVER": "El conductor", "ASSET": "El equipo"}


def _reason(row) -> str | None:
    """Por qué no recibe documentos, o None si los recibe. La empresa primero:
    si está dada de baja, eso explica también a su flota."""
    if row["carrier_status"] is not None and row["carrier_status"] not in CARRIER_STATUSES_IN_CERTIFICATION:
        return (f"{row['carrier_name']} está dada de baja: no recibe documentos. "
                "Reactívala desde el Directorio para volver a cargarlos.")
    if row["subject_status"] is not None and row["subject_status"] not in FLEET_STATUSES_IN_CERTIFICATION:
        return (f"{_SUBJECT_LABEL[row['entity_type']]} {row['subject_name']} está dado de baja: no recibe "
                "documentos. Reactívalo desde el Directorio para volver a cargarlos.")
    return None


async def locked_records(conn, record_ids: list[str]) -> dict[str, str]:
    """Los registros que no reciben documentos, con su motivo. Una vuelta a la
    base para todo el lote (la planilla trae cientos de filas)."""
    if not record_ids:
        return {}
    rows = await conn.fetch(_FOR_RECORDS, list(record_ids))
    return {f["key"]: m for f in rows if (m := _reason(f))}


async def ensure_record_open(conn, record_id: str) -> None:
    """409 si el registro es de algo dado de baja."""
    motivo = (await locked_records(conn, [record_id])).get(record_id)
    if motivo:
        raise HTTPException(409, motivo)


async def ensure_subject_open(conn, entity_type: str, entity_id: str) -> None:
    """409 si la empresa, o el conductor o equipo, está dado de baja. Para lo
    que todavía no es un registro: pedir un documento, subir a la bandeja de
    una empresa, mover archivos hacia ella."""
    row = await conn.fetchrow(_FOR_SUBJECT, entity_type, entity_id)
    motivo = _reason(row) if row else None
    if motivo:
        raise HTTPException(409, motivo)
