import type { TripStop } from '@/lib/types'
import { normalizeUTC } from './datetime'

function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = new Date(normalizeUTC(iso)).getTime()
  return isNaN(t) ? null : t
}

export function formatDurationMinutes(mins: number): string {
  if (mins < 1) return '<1 min'
  if (mins < 60) return `${Math.round(mins)} min`
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

/** Tiempo que el camión estuvo en la parada (llegada → salida), null si falta alguno */
export function stopDwellTime(stop: TripStop): string | null {
  const arr = toMs(stop.arrival_date ?? stop.gps_arrival_date)
  const dep = toMs(stop.departure_date ?? stop.gps_departure_date)
  if (arr == null || dep == null || dep <= arr) return null
  return formatDurationMinutes((dep - arr) / 60_000)
}

/** Tiempo de tránsito entre la salida de una parada y la llegada a la siguiente */
export function transitTime(from: TripStop, to: TripStop): string | null {
  const dep = toMs(from.departure_date ?? from.gps_departure_date)
  const arr = toMs(to.arrival_date ?? to.gps_arrival_date)
  if (dep == null || arr == null || arr <= dep) return null
  return formatDurationMinutes((arr - dep) / 60_000)
}
