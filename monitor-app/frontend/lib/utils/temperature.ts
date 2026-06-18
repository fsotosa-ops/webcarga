import type { TripStop } from '@/lib/types'

export function getLatestTemp(stops: TripStop[]): number | null {
  for (let i = stops.length - 1; i >= 0; i--) {
    if (stops[i].temperature != null) return stops[i].temperature!
  }
  return null
}

export function getActiveStop(stops: TripStop[]): TripStop | null {
  const inProgress = stops.find(s => s.arrival_date && !s.departure_date)
  if (inProgress) return inProgress
  const next = stops.find(s => !s.arrival_date && !s.departure_date)
  if (next) return next
  const arrived = stops.filter(s => s.arrival_date)
  return arrived.length > 0 ? arrived[arrived.length - 1] : null
}
