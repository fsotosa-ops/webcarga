"""Corregir el RUT de un conductor y la patente de un equipo (D3, Entrega B 14/10).

Con permiso propio (directory.identity) y motivo obligatorio, y queda en audit_log con el
valor viejo y el nuevo. Un duplicado se compara en forma canónica. Una patente nueva es el
mismo equipo (P12): la anterior queda como alias en app.asset_plate_aliases, y
app.resolve_trip_fleet la sigue reconociendo en los viajes del TMS.
"""
from __future__ import annotations

from fastapi import HTTPException

from ..utils.identity import canonical_plate, canonical_rut
from .audit import log_change


def _reason(reason: str | None) -> str:
    if not reason or not reason.strip():
        raise HTTPException(422, "Corregir un RUT o una patente exige un motivo")
    return reason.strip()


async def correct_driver_rut(conn, driver_id: str, raw: str, reason: str | None, *, actor: str) -> str:
    reason = _reason(reason)
    rut = canonical_rut(raw)
    if rut is None:
        raise HTTPException(422, "Ese RUT no es válido (revisa el dígito verificador)")
    current = await conn.fetchval("SELECT tax_id FROM public.drivers WHERE id = $1 FOR UPDATE", driver_id)
    if current is None and not await conn.fetchval("SELECT 1 FROM public.drivers WHERE id = $1", driver_id):
        raise HTTPException(404, "Conductor no encontrado")
    if canonical_rut(current) == rut:
        return rut
    owner = await conn.fetchval(
        "SELECT full_name FROM public.drivers WHERE public.canonical_rut(tax_id) = $1 AND id <> $2", rut, driver_id)
    if owner:
        raise HTTPException(409, f"Ese RUT ya es de {owner}")
    await conn.execute("UPDATE public.drivers SET tax_id = $2 WHERE id = $1", driver_id, rut)
    await log_change(conn, actor=actor, entity_type="DRIVER", entity_id=driver_id, action="identity_correction",
                     field="tax_id", old_value=current, new_value={"value": rut, "reason": reason})
    return rut


async def correct_asset_plate(conn, asset_id: str, raw: str, reason: str | None, *, actor: str) -> str:
    reason = _reason(reason)
    plate = canonical_plate(raw)
    if plate is None:
        raise HTTPException(422, "Esa patente no tiene un formato válido")
    current = await conn.fetchval("SELECT license_plate FROM public.assets WHERE id = $1 FOR UPDATE", asset_id)
    if current is None:
        raise HTTPException(404, "Equipo no encontrado")
    if current == plate:
        return plate
    owner = await conn.fetchval(
        """
        SELECT a.license_plate FROM public.assets a WHERE a.license_plate = $1 AND a.id <> $2
        UNION ALL
        SELECT a.license_plate FROM app.asset_plate_aliases pa JOIN public.assets a ON a.id = pa.asset_id
        WHERE pa.plate = $1 AND pa.asset_id <> $2
        LIMIT 1
        """,
        plate, asset_id)
    if owner:
        raise HTTPException(409, f"Esa patente ya es del equipo {owner}")
    # Si la patente nueva era un alias de este mismo equipo, deja de serlo.
    await conn.execute("DELETE FROM app.asset_plate_aliases WHERE plate = $1 AND asset_id = $2", plate, asset_id)
    await conn.execute(
        "INSERT INTO app.asset_plate_aliases (plate, asset_id, reason, created_by) VALUES ($1, $2, $3, $4::uuid) "
        "ON CONFLICT (plate) DO NOTHING", current, asset_id, reason, actor)
    await conn.execute("UPDATE public.assets SET license_plate = $2 WHERE id = $1", asset_id, plate)
    await log_change(conn, actor=actor, entity_type="ASSET", entity_id=asset_id, action="identity_correction",
                     field="license_plate", old_value=current, new_value={"value": plate, "reason": reason})
    return plate
