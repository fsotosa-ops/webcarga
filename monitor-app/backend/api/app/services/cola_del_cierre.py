"""El ejecutor de la cola del Cierre (spec 2026-10-10, §3.3).

Lo llama Cloud Scheduler cada minuto vía POST /api/v1/internal/closures/recompute.
Recorre los días marcados por los triggers trg_enqueue_closure_recompute_* y recalcula cada
uno; al terminar borra exactamente las marcas que leyó, así que una marca que
llegó mientras tanto queda para la próxima corrida. Un día que falla no detiene
a los demás."""
from __future__ import annotations

import logging
import time

from . import cierre_lineas

log = logging.getLogger(__name__)

# Hoy entra aunque nadie lo haya encolado si todavía no tiene líneas: así cada
# día arranca calculado sin que nadie abra la pantalla.
_SQL_PENDIENTES = """
SELECT q.business_date, array_agg(q.id ORDER BY q.id) AS marcas
FROM app.closure_recompute_queue q
GROUP BY q.business_date
UNION ALL
SELECT public.hoy_chile(), NULL::bigint[]
WHERE NOT EXISTS (SELECT 1 FROM app.closure_lines WHERE business_date = public.hoy_chile())
  AND NOT EXISTS (SELECT 1 FROM app.closure_recompute_queue WHERE business_date = public.hoy_chile())
ORDER BY 1
"""


async def procesar_cola(pool, *, presupuesto_s: float = 45.0) -> dict:
    inicio = time.monotonic()
    resumen: dict = {"recalculados": [], "cerrados": [], "ocupados": [], "fallidos": [], "pendientes": 0}
    filas = await pool.fetch(_SQL_PENDIENTES)
    for i, fila in enumerate(filas):
        if time.monotonic() - inicio > presupuesto_s:
            resumen["pendientes"] = len(filas) - i
            break
        fecha, marcas = fila["business_date"], fila["marcas"]
        try:
            resultado = await cierre_lineas.recalcular(pool, fecha, marcas=marcas, saltar_si_ocupado=True)
        except Exception as exc:  # aislar el día: los demás siguen y este se reintenta
            log.exception("recalculo_del_cierre_fallido", extra={"business_date": fecha.isoformat()})
            resumen["fallidos"].append({"fecha": fecha.isoformat(), "error": str(exc)})
            continue
        clave = {cierre_lineas.Resultado.RECALCULADO: "recalculados",
                 cierre_lineas.Resultado.CERRADO: "cerrados",
                 cierre_lineas.Resultado.OCUPADO: "ocupados"}[resultado]
        resumen[clave].append(fecha.isoformat())
    return resumen
