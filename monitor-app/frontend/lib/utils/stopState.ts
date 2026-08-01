import type { TripStop } from '@/lib/types'

export type StopState = 'done' | 'active' | 'pending'

// Fallback SOLO para el caso extremo de que el backend no haya marcado
// ninguna parada is_active (ver _mark_active_stop, trips.py — en la
// práctica casi siempre marca alguna). "Quién está activo" ya no se decide
// acá — FIX 2026-08-01: esta lógica vivía duplicada (con reglas
// ligeramente distintas) en StopTimeline.tsx y en la tabla principal
// (StopPills/StopProgressDots), desalineadas entre sí y con el detalle del
// viaje.
function isCompleted(s: TripStop): boolean {
  if (s.stop_type === 'ORIGIN') return !!(s.departure_date || s.gps_departure_date)
  return !!(s.arrival_date || s.gps_arrival_date)
}

/** Estado 'done'/'active'/'pending' de cada parada, en el mismo orden que
 *  `stops` — única fuente de verdad compartida entre el detalle del viaje
 *  (StopTimeline) y la tabla principal del Diario (StopPills/
 *  StopProgressDots), para que hito 13 se vea igual en ambos lugares. */
export function getStopStates(stops: TripStop[]): StopState[] {
  const currentIdx = stops.findIndex(s => s.is_active)
  return stops.map((stop, i) => {
    if (currentIdx < 0) return isCompleted(stop) ? 'done' : 'pending'
    if (i < currentIdx) return 'done'
    if (i === currentIdx) return 'active'
    return 'pending'
  })
}
