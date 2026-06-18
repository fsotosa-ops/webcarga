import type { TripStop } from '@/lib/types'

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
