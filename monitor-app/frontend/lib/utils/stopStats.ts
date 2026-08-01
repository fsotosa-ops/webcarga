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

/** Tiempo de tránsito entre la salida de una parada y la llegada a la
 *  siguiente. CASO ESPECIAL origen→primer destino (2026-08-02, pedido
 *  explícito del usuario): QAnalytics/Sodimac nunca reportan la salida
 *  real del origen (confirmado contra datos reales: 100% de los viajes
 *  abiertos con 2+ destinos) — se usa `planning_date` (hora planificada de
 *  despacho) como referencia de salida. Mientras el destino todavía no
 *  llega, se calcula EN VIVO contra `now` (mismo criterio que dwellStatus,
 *  Hito 14) para dar visibilidad de cuánto lleva en ruta; apenas hay una
 *  llegada real, se recalcula (y congela) contra ese dato — nunca contra
 *  `now` una vez que existe una llegada real. El resto de los tramos
 *  (entre destinos) no cambia: sin salida/llegada real, siguen sin
 *  mostrar nada, ninguno de ellos tiene un "planificado" confiable hoy. */
export function transitTime(from: TripStop, to: TripStop, now: number = Date.now()): string | null {
  let dep = toMs(from.departure_date ?? from.gps_departure_date)
  const usingPlannedOrigin = dep == null && from.stop_type === 'ORIGIN'
  if (usingPlannedOrigin) {
    dep = toMs(from.planning_date)
  }
  if (dep == null) return null

  let arr = toMs(to.arrival_date ?? to.gps_arrival_date)
  // Sin llegada real todavía: en vivo contra `now`, marcado con "~" —
  // estándar de la industria para distinguir un estimado (basado en la
  // hora planificada de salida) de un dato confirmado. Se congela sin "~"
  // apenas existe una llegada real, sin importar cuánto tiempo pase después.
  const estimated = arr == null
  if (estimated) {
    if (!usingPlannedOrigin) return null
    arr = now
  }
  if (arr == null || arr <= dep) return null
  const duration = formatDurationMinutes((arr - dep) / 60_000)
  return estimated ? `~${duration}` : duration
}
