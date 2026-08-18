"""HU-02 (Cierre del Día, Fase 3): pre-cierre automático — corrige lo que el
sistema puede resolver con confianza (Tipo A) y escala lo que no puede
(Tipo B). Se ejecuta al inicio de cada request de `daily_closures.py` que
calcula la cuadratura del día (mismo punto donde hoy corre `_recompute`),
ANTES de calcular MISMATCH — así, cuando el coordinador llega a "Cerrar el
día", la mayoría de los MISMATCH por empresa mal asociada ya no existen: el
Tipo A los corrigió solo. MISMATCH sigue existiendo como red de contención
para lo que el Tipo A explícitamente decide NO tocar (señal ambigua dentro
del mismo día, ver `_single_value` más abajo) — no son 2 mecanismos
compitiendo por la misma señal, es un pipeline: Tipo A resuelve lo claro,
MISMATCH atrapa lo que queda.

Todas las correcciones Tipo A usan `log_change(source='pre_cierre_auto')`,
NUNCA `record_manual_edit` (que fija `is_manual_override=true`): una
corrección automática que resulta ser un falso positivo debe poder
autocorregirse sola en la próxima corrida (con una nueva señal), no quedar
fijada para siempre. Mismo criterio que ya usan `assign_driver`/
`assign_asset` en carriers.py para una asignación "normal" (no
`unassign`, que sí fija override porque ahí SÍ es una decisión deliberada
del coordinador).

Hallazgo real verificado contra producción (2026-08-02): `transporter_name_tms`
(qué empresa dice el TMS que opera el tracto) es una variante de "WEBCARGA"
en ~3270 de ~3280 viajes reales — WebCarga es el operador de la plataforma,
no una empresa transportista real, así que ese valor nunca debe disparar una
reasignación. Se excluye explícitamente (`_looks_like_webcarga_itself`).
"""
import re
import unicodedata
from datetime import date as _date

import asyncpg

from .audit import log_change


def _normalize(value: str | None) -> str:
    if not value:
        return ""
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", value).strip().upper()


def _looks_like_webcarga_itself(tms_carrier_name: str) -> bool:
    return "WEBCARGA" in _normalize(tms_carrier_name)


def _single_value(values: list[str]) -> str | None:
    """Señal usable solo si TODOS los viajes de la ventana coinciden para esa
    patente/RUT — un solo viaje discrepante es ambiguo, no se auto-resuelve
    (queda para que MISMATCH lo atrape).

    Desde el fix multi-día la ventana ya no es "hoy": incluye los viajes
    abiertos de días anteriores. Medido sobre el 2026-08-14, eso SUMA 2
    patentes con señal usable (32 → 34) y no le quita la señal a ninguna,
    o sea el ensanche no vuelve más conservador al Tipo A."""
    distinct = {v for v in values if v}
    return next(iter(distinct)) if len(distinct) == 1 else None


async def run_pre_cierre(pool: asyncpg.Pool, business_date: _date) -> dict:
    auto_resolved: list[dict] = []
    escalations: dict[str, list[dict]] = {
        "PATENTE_NO_REGISTRADA": [],
        "EMPRESA_NO_RECONOCIDA": [],
        "CONDUCTOR_NO_REGISTRADO": [],
        "EMPRESA_ONBOARDING": [],
        "SIN_TIPO_OPERACION": [],
    }

    # FIX 2026-08-18: las 5 consultas de acá usaban `planning_date = $1`
    # exacto mientras el resto del Cierre ya usaba el criterio multi-día
    # (daily_closures.py:92, equipment_closures.py:68, status_report.py:106).
    # Como `run_pre_cierre` corre DENTRO de `_recompute()`, justo antes del
    # cálculo que sí es multi-día, un viaje multi-día no disparaba ninguna
    # corrección Tipo A ni ninguna escalación Tipo B: el pre-cierre miraba un
    # universo más chico que la cuadratura que venía a preparar.
    # Delta medido sobre el 2026-08-14 antes de aplicarlo: patentes 33 → 35,
    # conductores por RUT 1 → 1, cliente+patente 33 → 35, onboarding 0 → 0,
    # sin tipo de operación 1 → 1. El ensanche está acotado porque el segundo
    # término exige `is_active`, que ya exige recencia.
    #
    # NO se agrega acá la exclusión de Sodimac que sí se agregó a
    # daily_closures.py, y es deliberado: sería código muerto. Las 5 consultas
    # exigen `tractor_plate` o `driver_rut_tms`, y de los 54 viajes Sodimac que
    # existen en app.trips, 0 traen patente y 0 traen RUT (verificado
    # 2026-08-18). Esa fuente no puede aportar señal a un Tipo A ni a un
    # Tipo B: ya está excluida por construcción.
    async with pool.acquire() as conn:
        async with conn.transaction():
            # ── Tipo A #1 + Tipo B "patente" ────────────────────────────────
            plate_rows = await conn.fetch(
                """
                SELECT upper(trim(t.fleet->>'tractor_plate')) AS plate,
                       array_agg(t.fleet->>'transporter_name_tms') AS carrier_names
                FROM app.trips t
                WHERE (t.planning_date = $1 OR (t.planning_date < $1 AND t.is_active)) AND t.fleet->>'tractor_plate' IS NOT NULL
                GROUP BY 1
                """,
                business_date,
            )
            resolved_carrier_by_plate: dict[str, str] = {}
            for r in plate_rows:
                plate = r["plate"]
                asset = await conn.fetchrow(
                    "SELECT id FROM public.assets WHERE upper(trim(license_plate)) = $1", plate,
                )
                if not asset:
                    escalations["PATENTE_NO_REGISTRADA"].append(
                        {"tractor_plate": plate, "reason": "La patente no existe en public.assets"}
                    )
                    continue
                assignment = await conn.fetchrow(
                    """
                    SELECT aa.carrier_id, c.business_name, aa.is_manual_override
                    FROM public.asset_assignments aa
                    JOIN public.carriers c ON c.id = aa.carrier_id
                    WHERE aa.asset_id = $1 AND aa.status = 'ACTIVE'
                    """,
                    asset["id"],
                )
                if not assignment:
                    escalations["PATENTE_NO_REGISTRADA"].append(
                        {"tractor_plate": plate, "reason": "La patente existe pero no tiene empresa asignada"}
                    )
                    continue
                resolved_carrier_by_plate[plate] = assignment["carrier_id"]

                tms_name = _single_value(r["carrier_names"])
                if not tms_name or _looks_like_webcarga_itself(tms_name):
                    continue
                if _normalize(tms_name) == _normalize(assignment["business_name"]):
                    continue
                if assignment["is_manual_override"]:
                    continue  # override manual: nunca lo pisa una corrección automática

                candidates = await conn.fetch(
                    "SELECT id, business_name FROM public.carriers WHERE upper(trim(business_name)) = $1",
                    _normalize(tms_name),
                )
                if len(candidates) != 1:
                    escalations["EMPRESA_NO_RECONOCIDA"].append({
                        "tractor_plate": plate, "tms_carrier_name": tms_name,
                        "directory_carrier_name": assignment["business_name"],
                    })
                    continue

                new_carrier = candidates[0]
                await conn.execute(
                    """
                    UPDATE public.asset_assignments SET status = 'INACTIVE'
                    WHERE asset_id = $1 AND carrier_id = $2 AND status = 'ACTIVE' AND NOT is_manual_override
                    """,
                    asset["id"], assignment["carrier_id"],
                )
                await conn.execute(
                    """
                    INSERT INTO public.asset_assignments (asset_id, carrier_id, status)
                    VALUES ($1, $2, 'ACTIVE')
                    ON CONFLICT (asset_id, carrier_id) DO UPDATE SET status = 'ACTIVE'
                    WHERE NOT asset_assignments.is_manual_override
                    """,
                    asset["id"], new_carrier["id"],
                )
                await log_change(
                    conn, actor=None, entity_type="ASSET", entity_id=asset["id"],
                    action="pre_cierre_reasignar_empresa", field="carrier_id",
                    old_value=assignment["business_name"], new_value=new_carrier["business_name"],
                    source="pre_cierre_auto",
                )
                resolved_carrier_by_plate[plate] = new_carrier["id"]
                auto_resolved.append({
                    "type": "PATENTE_EMPRESA", "tractor_plate": plate,
                    "old_carrier_name": assignment["business_name"], "new_carrier_name": new_carrier["business_name"],
                    "message": (
                        f"Se actualizó la empresa asociada a la patente {plate} de "
                        f"'{assignment['business_name']}' a '{new_carrier['business_name']}'. "
                        "Revisar que los documentos asociados (permiso de circulación, "
                        "contrato de conductor) estén vigentes para la nueva empresa."
                    ),
                })

            # ── Tipo A #2 — conductor: nombre distinto para el mismo RUT ────
            driver_rows = await conn.fetch(
                """
                SELECT upper(trim(t.fleet->>'driver_rut_tms')) AS rut,
                       array_agg(t.fleet->>'driver_name_tms') AS names
                FROM app.trips t
                WHERE (t.planning_date = $1 OR (t.planning_date < $1 AND t.is_active)) AND t.fleet->>'driver_rut_tms' IS NOT NULL
                  AND trim(t.fleet->>'driver_rut_tms') != ''
                GROUP BY 1
                """,
                business_date,
            )
            for r in driver_rows:
                rut = r["rut"]
                driver = await conn.fetchrow(
                    "SELECT id, full_name, is_manual_override FROM public.drivers WHERE upper(trim(tax_id)) = $1", rut,
                )
                if not driver:
                    escalations["CONDUCTOR_NO_REGISTRADO"].append({"driver_rut": rut})
                    continue
                tms_name = _single_value(r["names"])
                if not tms_name or driver["is_manual_override"]:
                    continue
                if _normalize(tms_name) == _normalize(driver["full_name"]):
                    continue
                await conn.execute(
                    "UPDATE public.drivers SET full_name = $1 WHERE id = $2", tms_name.strip(), driver["id"],
                )
                await log_change(
                    conn, actor=None, entity_type="DRIVER", entity_id=driver["id"],
                    action="pre_cierre_actualizar_nombre", field="full_name",
                    old_value=driver["full_name"], new_value=tms_name.strip(), source="pre_cierre_auto",
                )
                auto_resolved.append({
                    "type": "CONDUCTOR_DATOS", "driver_rut": rut,
                    "old_value": driver["full_name"], "new_value": tms_name.strip(),
                    "message": f"Se actualizó el nombre del conductor {rut} de '{driver['full_name']}' a '{tms_name.strip()}'.",
                })

            # ── Tipo A #3 — cliente no listado en carrier_shippers ──────────
            client_rows = await conn.fetch(
                """
                SELECT DISTINCT upper(trim(t.fleet->>'tractor_plate')) AS plate, t.client_name
                FROM app.trips t
                WHERE (t.planning_date = $1 OR (t.planning_date < $1 AND t.is_active)) AND t.fleet->>'tractor_plate' IS NOT NULL
                  AND t.client_name IS NOT NULL
                """,
                business_date,
            )
            for r in client_rows:
                carrier_id = resolved_carrier_by_plate.get(r["plate"])
                if not carrier_id:
                    continue
                shipper = await conn.fetchrow(
                    "SELECT id, name FROM public.shippers WHERE upper(trim(name)) = $1", _normalize(r["client_name"]),
                )
                if not shipper:
                    continue
                already_linked = await conn.fetchval(
                    "SELECT 1 FROM public.carrier_shippers WHERE carrier_id = $1 AND shipper_id = $2 AND status = 'ACTIVE'",
                    carrier_id, shipper["id"],
                )
                if already_linked:
                    continue
                carrier_name = await conn.fetchval("SELECT business_name FROM public.carriers WHERE id = $1", carrier_id)
                await conn.execute(
                    """
                    INSERT INTO public.carrier_shippers (carrier_id, shipper_id, status)
                    VALUES ($1, $2, 'ACTIVE')
                    ON CONFLICT (carrier_id, shipper_id) DO UPDATE SET status = 'ACTIVE'
                    WHERE NOT carrier_shippers.is_manual_override
                    """,
                    carrier_id, shipper["id"],
                )
                await log_change(
                    conn, actor=None, entity_type="CARRIER", entity_id=carrier_id,
                    action="pre_cierre_agregar_cliente", field="carrier_shippers",
                    new_value=shipper["name"], source="pre_cierre_auto",
                )
                auto_resolved.append({
                    "type": "CLIENTE_EMPRESA", "carrier_name": carrier_name, "client_name": shipper["name"],
                    "message": f"Se agregó '{shipper['name']}' a la lista de clientes de '{carrier_name}'.",
                })

            # ── Tipo B — empresa en onboarding (post-correcciones Tipo A) ───
            onboarding_rows = await conn.fetch(
                """
                SELECT DISTINCT c.id AS carrier_id, c.business_name
                FROM app.trips t
                JOIN public.assets a ON upper(trim(a.license_plate)) = upper(trim(t.fleet->>'tractor_plate'))
                JOIN public.asset_assignments aa ON aa.asset_id = a.id AND aa.status = 'ACTIVE'
                JOIN public.carriers c ON c.id = aa.carrier_id
                WHERE (t.planning_date = $1 OR (t.planning_date < $1 AND t.is_active)) AND c.operational_status != 'ACTIVE'
                """,
                business_date,
            )
            for r in onboarding_rows:
                escalations["EMPRESA_ONBOARDING"].append(
                    {"carrier_id": str(r["carrier_id"]), "carrier_name": r["business_name"]}
                )

            # ── Tipo B — tracto activo sin "Tipo de Operación WebCarga" ─────
            # (Ronda 85, corrige la Ronda 80: el campo que decide Bloque 1/2
            # del cierre es webcarga_operation_type_id, no
            # fleet_service_type_id — viven en el TRACTO individual, no a
            # nivel empresa; public.carrier_fleet_service_types se eliminó,
            # nunca tuvo una fuente de ingesta real.)
            sin_tipo_rows = await conn.fetch(
                """
                SELECT DISTINCT c.id AS carrier_id, c.business_name
                FROM app.trips t
                JOIN public.assets a ON upper(trim(a.license_plate)) = upper(trim(t.fleet->>'tractor_plate'))
                JOIN public.asset_assignments aa ON aa.asset_id = a.id AND aa.status = 'ACTIVE'
                JOIN public.carriers c ON c.id = aa.carrier_id AND c.operational_status = 'ACTIVE'
                WHERE (t.planning_date = $1 OR (t.planning_date < $1 AND t.is_active))
                  AND a.webcarga_operation_type_id IS NULL
                """,
                business_date,
            )
            for r in sin_tipo_rows:
                escalations["SIN_TIPO_OPERACION"].append(
                    {"carrier_id": str(r["carrier_id"]), "carrier_name": r["business_name"]}
                )

    return {"auto_resolved": auto_resolved, "escalations": escalations}
