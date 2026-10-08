"""Encender el pendiente de un documento para una o varias entidades.

Una sola definición de "encender", que comparten dos caminos:
- recalcular un requisito (POST /compliance-requirements/{id}/recalc): la
  regla decide a quién se le exige;
- solicitar un documento "solo cuando se solicita"
  (POST /compliance-records/requests, HU-C1 entrega 2b): lo decide una
  persona, y por eso queda con `is_manual_override`. `calcular_diferencias`
  nunca apaga un registro con override, así que recalcular no borra lo que
  alguien pidió.

Por qué ON CONFLICT DO UPDATE y no DO NOTHING: el índice único
(entity_id, requirement_id) es TOTAL, así que una fila APAGADA sigue
ocupando el lugar. DO NOTHING la saltearía en silencio y reportaría
"encendido" sin haber encendido nada. El DO UPDATE toca SOLO el interruptor
(y la marca humana, si corresponde): un registro apagado puede tener
documento cargado, y pisarle status/file_url/fechas al encenderlo sería
destruir trabajo real. `updated_at` tampoco se toca: volver a exigir no es
haber actualizado un documento.

El `WHERE` del DO UPDATE hace el encendido idempotente: lo que ya estaba
encendido (y marcado, si es una solicitud) no se reescribe ni se cuenta.
"""
from __future__ import annotations

_ENCENDER = """
    INSERT INTO public.compliance_records
        (entity_id, entity_type, requirement_id, status, is_current, is_manual_override)
    SELECT unnest($1::uuid[]), $2, $3, 'MISSING', true, $4
    ON CONFLICT (entity_id, requirement_id) DO UPDATE SET
        is_current = true,
        is_manual_override = public.compliance_records.is_manual_override OR EXCLUDED.is_manual_override
    WHERE NOT public.compliance_records.is_current
       OR (EXCLUDED.is_manual_override AND NOT public.compliance_records.is_manual_override)
    RETURNING id
"""


async def encender_registros(conn, entity_ids: list, entity_type: str, requirement_id: str,
                             *, manual: bool) -> list[str]:
    """Enciende el pendiente para esas entidades y devuelve los ids que
    efectivamente cambiaron."""
    filas = await conn.fetch(_ENCENDER, entity_ids, entity_type, requirement_id, manual)
    return [str(fila["id"]) for fila in filas]
