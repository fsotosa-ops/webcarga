'use client'

import { Check } from 'lucide-react'
import type { TripStop } from '@/lib/types'

type StopState = 'done' | 'active' | 'pending'

function isCompleted(s: TripStop): boolean {
  return !!(s.arrival_date || s.gps_arrival_date || s.on_time_status)
}

/**
 * Barra horizontal de progreso de ruta para el hero del detalle:
 * nodos por parada (check verde = completada, acento pulsante = activa,
 * gris = pendiente) unidos por conectores que se llenan con el avance.
 * showLabels=false por defecto: los nombres viven en el timeline de Ruta
 * (mostrarlos acá también saturaba el hero — feedback 2026-07-06); el
 * nombre queda como tooltip del nodo.
 */
export function RouteProgress({ stops, showLabels = false }: { stops: TripStop[]; showLabels?: boolean }) {
  if (!stops?.length) return null

  const currentIdx = stops.findIndex(s => !isCompleted(s))
  const stateFor = (i: number, stop: TripStop): StopState => {
    if (currentIdx < 0) return isCompleted(stop) ? 'done' : 'pending'
    if (i < currentIdx) return 'done'
    if (i === currentIdx) return 'active'
    return 'pending'
  }

  return (
    <div className="flex items-start w-full" role="img" aria-label={`Progreso de ruta: ${stops.length} paradas`}>
      {stops.map((stop, i) => {
        const state = stateFor(i, stop)
        const name = stop.local ?? stop.destination_city ?? '—'
        const offTime = stop.on_time_status === 'OFF TIME'
        return (
          <div key={stop.stop_id ?? i} className="flex-1 min-w-0 flex flex-col items-center relative">
            {/* Conector hacia el nodo anterior */}
            {i > 0 && (
              <span
                className={`absolute right-1/2 left-[-50%] top-[9px] h-0.5 ${
                  state === 'done' || state === 'active' ? 'bg-green-400' : 'bg-gray-200'
                }`}
              />
            )}
            {/* Nodo */}
            <span
              title={name}
              className={`relative z-10 w-[18px] h-[18px] rounded-full flex items-center justify-center shrink-0 border-2 ${
                state === 'done'
                  ? offTime
                    ? 'bg-red-500 border-red-500 text-white'
                    : 'bg-green-500 border-green-500 text-white'
                  : state === 'active'
                  ? 'bg-white border-accent text-accent animate-pulse'
                  : 'bg-white border-gray-200 text-transparent'
              }`}
            >
              {state === 'done'
                ? <Check size={10} strokeWidth={3} />
                : <span className={`w-1.5 h-1.5 rounded-full ${state === 'active' ? 'bg-accent' : 'bg-gray-200'}`} />}
            </span>
            {/* Nombre — opcional (por defecto solo tooltip del nodo) */}
            {showLabels && (
              <span
                className={`hidden md:block text-[9px] mt-1 max-w-full truncate px-0.5 ${
                  state === 'active' ? 'font-semibold text-accent' : state === 'done' ? 'text-gray-500' : 'text-gray-300'
                }`}
                title={name}
              >
                {name}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
