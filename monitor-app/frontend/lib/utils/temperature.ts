import type { TripStop, TemperatureRangeMeta } from '@/lib/types'
import { fmtShort } from './datetime'

export function getActiveStop(stops: TripStop[]): TripStop | null {
  const inProgress = stops.find(s => s.arrival_date && !s.departure_date)
  if (inProgress) return inProgress
  const next = stops.find(s => !s.arrival_date && !s.departure_date)
  if (next) return next
  const arrived = stops.filter(s => s.arrival_date)
  return arrived.length > 0 ? arrived[arrived.length - 1] : null
}

// Returns the temperature at the active stop (current reading).
// Falls back to the most recently visited stop if the active stop has no temp.
export function getLatestTemp(stops: TripStop[]): number | null {
  const active = getActiveStop(stops)
  if (active?.temperature != null) return active.temperature
  const visited = stops.filter(s => s.arrival_date || s.gps_arrival_date)
  for (let i = visited.length - 1; i >= 0; i--) {
    if (visited[i].temperature != null) return visited[i].temperature!
  }
  return null
}

// Whether a stop has actually been reached (so temperature is a real reading).
export function stopWasVisited(stop: TripStop): boolean {
  return !!(stop.arrival_date || stop.gps_arrival_date)
}

// Classifies a temperature reading against the admin-configured range for the
// trip's cargo_type. cargo_type is free text from the TMS (not a fixed enum),
// so a trip whose cargo_type has no matching row is intentionally unclassified
// (null) rather than assuming a default range.
export function classifyTemperature(
  temp: number | null,
  cargoType: string | null,
  ranges: TemperatureRangeMeta[],
): 'ok' | 'out_of_range' | null {
  if (temp == null || !cargoType) return null
  const range = ranges.find(r => r.cargo_type === cargoType)
  if (!range) return null
  return temp < range.min_c || temp > range.max_c ? 'out_of_range' : 'ok'
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
    if (stop.departure_date) return `salió ${fmtShort(stop.departure_date)}`
    if (stop.planning_date) return `sale ~${fmtShort(stop.planning_date)}`
    return null
  }

  const arrival = stop.arrival_date
    ? `llegó ${fmtShort(stop.arrival_date)}`
    : stop.planning_date
    ? `llega ~${fmtShort(stop.planning_date)}`
    : null

  const departure = stop.departure_date
    ? `salió ${fmtShort(stop.departure_date)}`
    : stop.departure_date_prog
    ? `sale ~${fmtShort(stop.departure_date_prog)}`
    : null

  const parts = [arrival, departure].filter((p): p is string => p != null)
  return parts.length > 0 ? parts.join(' · ') : null
}
