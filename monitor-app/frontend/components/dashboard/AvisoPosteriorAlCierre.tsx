'use client'

import { AlertTriangle } from 'lucide-react'

interface Props {
  /** `cierre.posteriores_al_cierre` de GET /daily-closures — entero, nunca
   *  negativo. */
  cantidad: number
}

/**
 * El día NO se reabre: la firma sigue siendo verdadera sobre los viajes que
 * existían cuando se firmó (ver el comentario en
 * `daily_closures.py::get_daily_closure_status`). Lo que llega después es un
 * delta — "posterior al cierre" — nunca "reabierto": esa palabra mentiría
 * sobre lo que pasó. El encabezado del día sigue diciendo "Cerrado"; este
 * aviso va al lado, no lo reemplaza.
 *
 * Con `cantidad === 0` no hay delta que avisar: no renderiza nada.
 *
 * Crítico 2 (revisión de rama, 2026-08-18): este aviso cuenta TODOS los
 * viajes con `planning_date = D` (correcto — dice si la firma sigue
 * cubriendo todo). La pestaña "Viajes" del Centro de Cierre muestra otro
 * universo (los 4 grupos de `cierre_viajes.py`, que excluyen buena parte de
 * lo que cuenta acá). Medido: 47 viajes del 2026-08-14, 0 visibles en esa
 * pestaña con esa fecha. Un botón "Verlos" que llevara ahí mentiría. La
 * corrección de fondo es navegar al Monitor filtrado por esa fecha, pero
 * `app/dashboard/operations/monitor/page.tsx` no lee ningún filtro desde la
 * URL (`useDiarioFilters` es un `useReducer` sin `useSearchParams`) — no se
 * inventa un mecanismo nuevo acá. Sin destino confiable, este aviso queda
 * sólo con el número, sin acción.
 */
export function AvisoPosteriorAlCierre({ cantidad }: Props) {
  if (cantidad === 0) return null

  return (
    <div className="flex items-center gap-2 rounded-xl border border-espera/20 bg-espera/5 px-4 py-3">
      <AlertTriangle size={14} className="text-espera shrink-0" />
      <p className="text-dato text-text-primary tabular-nums">
        {cantidad} {cantidad === 1 ? 'viaje posterior al cierre' : 'viajes posteriores al cierre'}
      </p>
    </div>
  )
}
