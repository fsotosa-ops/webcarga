"""La regla de aplicabilidad de un requisito, en UN solo lugar.

El trigger la aplica al insertar una entidad; este servicio la aplica sobre
las entidades que YA existen, para el recalcular. Son el mismo criterio y por
eso viven juntos: si divergen, la vista previa miente.

REFERENCIA CRUZADA: el tipo de gestión de una empresa NO se lee de
`public.carriers.management_types`. Se lee de `public.carrier_management_types()`
(migración `20260816050000_carrier_management_types_single_definition.sql`), que
es la ÚNICA definición del concepto: la flota manda cuando existe, lo declarado
cubre el hueco. La misma función la llaman las cuatro ramas CARRIER de siembra y
la pantalla de Certificación (`app/routers/compliance.py`). Leer la columna
declarada a secas es el defecto C1: hoy está en NULL en las 248 empresas, así
que cualquier condición de gestión dejaba `aplican` vacío y proponía borrar
TODOS los registros vigentes del requisito.
"""
from __future__ import annotations

# El universo de cada tipo de entidad: la tabla contra la que se evalúa la
# regla, y también contra la que se cuenta el "de 118" del alcance
# (app/routers/requirements.py). Las tres son literales de este módulo; nunca
# entra acá un nombre que venga de un request.
TABLA_DE_ENTIDAD = {
    "CARRIER": "public.carriers",
    "DRIVER":  "public.drivers",
    "ASSET":   "public.assets",
}

# Por qué el SQL y no ORM: la misma expresión tiene que poder compararse a
# ojo contra la del trigger. Dos lenguajes distintos para la misma regla es
# exactamente cómo divergen.
#
# La CONDICIÓN, y nada más que la condición: escrita sobre dos alias fijos,
# `e` (la entidad candidata) y `req` (el requisito). Quien la usa decide cómo
# trae esas dos filas. Así la puede reusar tanto la vista previa —que fija un
# requisito por parámetro— como el catálogo, que necesita los 37 de una y
# correlaciona `req` con la fila que ya está leyendo.
#
# NO incluye `req.is_active`: la vigencia no es parte de la condición, es la
# puerta de entrada, y se compone abajo. Separarlas es lo que permite que la
# lista de configuración diga a cuántos ALCANZARÍA una regla apagada (que es
# justamente lo que alguien quiere saber antes de encenderla) sin que existan
# dos definiciones de la condición.
SQL_CONDICION_DE_ENTIDAD = {
    # CARRIER tiene dos casos, igual que las dos ramas CARRIER de
    # reconcile_new_requirement(): un requisito sin shipper_id es general y
    # aplica a toda empresa (filtrada solo por management_types); uno CON
    # shipper_id es de un cliente puntual y aplica solo a las empresas
    # vinculadas a ese cliente vía carrier_shippers (ACTIVE) — lo mismo que
    # siembran reconcile_carrier_shipper_link y la rama con shipper de
    # reconcile_new_requirement(). Sin esta segunda rama, recalcular un
    # requisito de cliente puntual (p.ej. ANEXO_REPLEG) trataría "aplica a
    # 0 empresas" y propondría borrar todos sus registros legítimos.
    #
    # `public.carrier_management_types(e.id)`: misma expresión que las cuatro
    # ramas CARRIER de siembra. Si cambia una, cambia la otra — pero cambian
    # juntas porque las dos llaman a la MISMA función de base.
    "CARRIER": """
        (req.applies_to_management_types IS NULL
         OR public.carrier_management_types(e.id) && req.applies_to_management_types)
        AND (
            req.shipper_id IS NULL
            OR EXISTS (
                SELECT 1 FROM public.carrier_shippers cs
                WHERE cs.carrier_id = e.id AND cs.shipper_id = req.shipper_id
                  AND cs.status = 'ACTIVE'
            )
        )
    """,
    # Un conductor no tiene subtipo ni gestión propios: hoy no hay ninguna
    # condición que lo acote, y el requisito le aplica a todos. Queda escrito
    # como `TRUE` en vez de omitido para que las tres entidades pasen por la
    # misma composición y una condición nueva de DRIVER se agregue en un solo
    # lugar.
    "DRIVER": "TRUE",
    "ASSET": """
        (req.applies_to_fleet_service_type_ids IS NULL
         OR e.fleet_service_type_id = ANY(req.applies_to_fleet_service_type_ids))
    """,
}

# La regla completa para UN requisito, por su id: vigencia + condición. Es lo
# que consume el recálculo (`calcular_diferencias`, más abajo) y lo que los
# tests de integración comparan contra lo que siembran los triggers.
SQL_ENTIDADES_QUE_APLICAN = {
    entidad: f"""
        SELECT e.id
        FROM {TABLA_DE_ENTIDAD[entidad]} e, public.compliance_requirements req
        WHERE req.id = $1 AND req.is_active
          AND ({condicion})
    """
    for entidad, condicion in SQL_CONDICION_DE_ENTIDAD.items()
}


async def calcular_diferencias(pool, requirement_id: str) -> dict:
    """Qué cambiaría si se recalculara este requisito ahora.

    `crear` incluye tanto entidades sin registro como entidades con uno
    APAGADO: el `NOT EXISTS (... AND cr.is_current)` no distingue los dos
    casos, y no tiene por qué — para la regla, un registro apagado es "no lo
    tiene". Quien aplica (`app/routers/requirements.py`) resuelve la
    diferencia con `ON CONFLICT ... DO UPDATE SET is_current = true`, porque
    el índice único (entity_id, requirement_id) es TOTAL y la fila apagada
    sigue ocupando el lugar.

    `bloqueados` son los que la regla ya no incluye pero NO se pueden apagar:
    tienen archivo, o edición manual, o un estado distinto de MISSING. Apagar
    un registro con documento cargado lo sacaría de todas las pantallas
    (todas filtran `is_current`), que para quien mira es lo mismo que haberlo
    perdido (D13).

    `status` es NULLABLE (aunque hoy no hay filas con ese valor): el
    predicado usa `IS DISTINCT FROM 'MISSING'`, no `<>`, para que un NULL
    caiga del lado bloqueado en vez de la lógica de tres valores de SQL
    (`NULL <> 'MISSING'` da NULL, ni true ni false) — el `UPDATE` guardado de
    `app/routers/requirements.py` usa el operador espejo
    (`IS NOT DISTINCT FROM`), así que los dos lados tratan un NULL exactamente
    igual y la vista previa nunca promete un apagado que el UPDATE no hace.

    Devuelve también `target_entity` (None si el requisito no existe) para
    que quien llama pueda decidir el 404 sin repetir este mismo `fetchrow`.

    Las tres lecturas van en una sola conexión y una transacción de sólo
    lectura (`conn.transaction(readonly=True)`), no sueltas sobre `pool`: cada
    `pool.fetch*` puede tomar una conexión distinta del pool y por lo tanto un
    snapshot distinto, así que `crear` y `sobran` de una misma vista previa
    podían no ser mutuamente coherentes entre sí (M3). El daño estaba acotado
    porque el `UPDATE` de `app/routers/requirements.py` revalida D13 por su
    cuenta, pero son los números que alguien mira antes de confirmar el
    cambio."""
    async with pool.acquire() as conn:
        async with conn.transaction(readonly=True):
            req = await conn.fetchrow(
                "SELECT target_entity FROM public.compliance_requirements WHERE id = $1",
                requirement_id,
            )
            if not req:
                return {"crear": [], "quitar": [], "bloqueados": [], "target_entity": None}

            aplican = SQL_ENTIDADES_QUE_APLICAN[req["target_entity"]]

            crear = await conn.fetch(f"""
                WITH aplican AS ({aplican})
                SELECT a.id::text FROM aplican a
                WHERE NOT EXISTS (
                    SELECT 1 FROM public.compliance_records cr
                    WHERE cr.entity_id = a.id AND cr.requirement_id = $1 AND cr.is_current
                )
            """, requirement_id)

            sobran = await conn.fetch(f"""
                WITH aplican AS ({aplican})
                SELECT cr.id::text, cr.entity_id::text,
                       (cr.file_url IS NOT NULL OR cr.is_manual_override
                        OR cr.status IS DISTINCT FROM 'MISSING') AS bloqueado
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
