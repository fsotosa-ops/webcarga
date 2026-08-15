"""La regla de aplicabilidad de un requisito, en UN solo lugar.

El trigger la aplica al insertar una entidad; este servicio la aplica sobre
las entidades que YA existen, para el recalcular. Son el mismo criterio y por
eso viven juntos: si divergen, la vista previa miente.
"""
from __future__ import annotations

# Por qué el SQL y no ORM: la misma expresión tiene que poder compararse a
# ojo contra la del trigger. Dos lenguajes distintos para la misma regla es
# exactamente cómo divergen.
SQL_ENTIDADES_QUE_APLICAN = {
    # CARRIER tiene dos casos, igual que las dos ramas CARRIER de
    # reconcile_new_requirement(): un requisito sin shipper_id es general y
    # aplica a toda empresa (filtrada solo por management_types); uno CON
    # shipper_id es de un cliente puntual y aplica solo a las empresas
    # vinculadas a ese cliente vía carrier_shippers (ACTIVE) — lo mismo que
    # siembran reconcile_carrier_shipper_link y la rama con shipper de
    # reconcile_new_requirement(). Sin esta segunda rama, recalcular un
    # requisito de cliente puntual (p.ej. ANEXO_REPLEG) trataría "aplica a
    # 0 empresas" y propondría borrar todos sus registros legítimos.
    "CARRIER": """
        SELECT e.id
        FROM public.carriers e, public.compliance_requirements req
        WHERE req.id = $1 AND req.is_active
          AND (req.applies_to_management_types IS NULL
               OR e.management_types && req.applies_to_management_types)
          AND (
              req.shipper_id IS NULL
              OR EXISTS (
                  SELECT 1 FROM public.carrier_shippers cs
                  WHERE cs.carrier_id = e.id AND cs.shipper_id = req.shipper_id
                    AND cs.status = 'ACTIVE'
              )
          )
    """,
    "DRIVER": """
        SELECT e.id
        FROM public.drivers e, public.compliance_requirements req
        WHERE req.id = $1 AND req.is_active
    """,
    "ASSET": """
        SELECT e.id
        FROM public.assets e, public.compliance_requirements req
        WHERE req.id = $1 AND req.is_active
          AND (req.applies_to_fleet_service_type_ids IS NULL
               OR e.fleet_service_type_id = ANY(req.applies_to_fleet_service_type_ids))
    """,
}


async def calcular_diferencias(pool, requirement_id: str) -> dict:
    """Qué cambiaría si se recalculara este requisito ahora.

    `bloqueados` son los que la regla ya no incluye pero NO se pueden quitar:
    tienen archivo, o edición manual, o un estado distinto de MISSING. Borrar
    un documento cargado porque cambió una regla de catálogo sería destruir
    trabajo real (D13).

    Devuelve también `target_entity` (None si el requisito no existe) para
    que quien llama pueda decidir el 404 sin repetir este mismo `fetchrow`."""
    req = await pool.fetchrow(
        "SELECT target_entity FROM public.compliance_requirements WHERE id = $1",
        requirement_id,
    )
    if not req:
        return {"crear": [], "quitar": [], "bloqueados": [], "target_entity": None}

    aplican = SQL_ENTIDADES_QUE_APLICAN[req["target_entity"]]

    crear = await pool.fetch(f"""
        WITH aplican AS ({aplican})
        SELECT a.id::text FROM aplican a
        WHERE NOT EXISTS (
            SELECT 1 FROM public.compliance_records cr
            WHERE cr.entity_id = a.id AND cr.requirement_id = $1 AND cr.is_current
        )
    """, requirement_id)

    sobran = await pool.fetch(f"""
        WITH aplican AS ({aplican})
        SELECT cr.id::text, cr.entity_id::text,
               (cr.file_url IS NOT NULL OR cr.is_manual_override
                OR cr.status <> 'MISSING') AS bloqueado
        FROM public.compliance_records cr
        WHERE cr.requirement_id = $1 AND cr.is_current
          AND cr.entity_id NOT IN (SELECT id FROM aplican)
    """, requirement_id)

    return {
        "crear":      [r["id"] for r in crear],
        "quitar":     [r["id"] for r in sobran if not r["bloqueado"]],
        "bloqueados": [r["id"] for r in sobran if r["bloqueado"]],
        "target_entity": req["target_entity"],
    }
