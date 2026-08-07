import type { TripStop } from '@/lib/types'
import { fmtShort } from './datetime'

// "Parada activa" (dónde está el camión ahora) se calcula en el backend
// (_mark_active_stop, trips.py) — única fuente de verdad. FIX 2026-08-01:
// antes se recalculaba acá con TR/GPS directo, y por separado (con reglas
// ligeramente distintas) en StopTimeline.tsx — bug real: para QAnalytics/
// Sodimac (~90% de los viajes), que nunca reportan la salida del origen,
// la parada activa quedaba pegada en el origen para siempre.
export function getActiveStop(stops: TripStop[]): TripStop | null {
  return stops.find(s => s.is_active) ?? null
}

// Returns the stop whose temperature reading is "the current one" — active
// stop first, falling back to the most recently visited stop with a
// non-null reading. Extracted from getLatestTemp so callers that need the
// stop itself (not just the number, e.g. to anchor a timestamp) don't have
// to duplicate this fallback order.
export function getLatestTempStop(stops: TripStop[]): TripStop | null {
  const active = getActiveStop(stops)
  if (active?.temperature != null) return active
  const visited = stops.filter(s => s.arrival_date || s.gps_arrival_date)
  for (let i = visited.length - 1; i >= 0; i--) {
    if (visited[i].temperature != null) return visited[i]
  }
  return null
}

// Returns the temperature at the active stop (current reading).
// Falls back to the most recently visited stop if the active stop has no temp.
export function getLatestTemp(stops: TripStop[]): number | null {
  return getLatestTempStop(stops)?.temperature ?? null
}

// Whether a stop has actually been reached (so temperature is a real reading).
export function stopWasVisited(stop: TripStop): boolean {
  return !!(stop.arrival_date || stop.gps_arrival_date)
}

// Describe la llegada/salida de una parada con una sola fórmula, agnóstica
// de TMS y de estado (done/active/pending): prefiere el dato real, cae a lo
// planificado cuando no hay real todavía, y no muestra nada si ninguno existe.
export function describeStopTiming(stop: TripStop): string | null {
  // El origen no tiene "llegada" (el viaje arranca ahí) — describirlo con
  // el mismo par llegada/salida que un destino confundía "llega ~X" con lo
  // que en realidad es la salida planificada (Fase 1, origen como parada
  // 0, 2026-07-18).
  if (stop.stop_type === 'ORIGIN') {
    // Mismo fallback declarada→medida que en los destinos, ver abajo.
    const leftAt = stop.departure_date ?? stop.gps_departure_date
    if (leftAt) return `salió ${fmtShort(leftAt)}`
    if (stop.planning_date) return `sale ~${fmtShort(stop.planning_date)}`
    return null
  }

  // Llegada/salida efectivas: la declarada por el transportista si existe,
  // si no la medida por GPS. Hay TMS que solo reportan una de las dos —
  // IANSA, por ejemplo, solo entrega horas medidas (van a las columnas GPS
  // por definición de negocio). Sin este fallback, una parada de IANSA ya
  // visitada mostraba "llega ~" con su hora planificada en vez de "llegó"
  // con la real. `stopWasVisited` acá abajo ya usaba este mismo criterio.
  const arrivedAt   = stop.arrival_date   ?? stop.gps_arrival_date
  const departedAt  = stop.departure_date ?? stop.gps_departure_date

  const arrival = arrivedAt
    ? `llegó ${fmtShort(arrivedAt)}`
    : stop.planning_date
    ? `llega ~${fmtShort(stop.planning_date)}`
    : null

  const departure = departedAt
    ? `salió ${fmtShort(departedAt)}`
    : stop.departure_date_prog
    ? `sale ~${fmtShort(stop.departure_date_prog)}`
    : null

  const parts = [arrival, departure].filter((p): p is string => p != null)
  return parts.length > 0 ? parts.join(' · ') : null
}
