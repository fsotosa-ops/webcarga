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
 *  siguiente. Devuelve el texto completo (incluye "de tránsito"/"desde
 *  despacho") — el llamador solo lo renderiza, no decide el sufijo.
 *
 *  CASO ESPECIAL origen→primer destino (2026-08-02, pedido explícito del
 *  usuario): QAnalytics/Sodimac nunca reportan la salida real del origen
 *  (confirmado contra datos reales: 100% de los viajes abiertos con 2+
 *  destinos) — `planning_date` de QAnalytics es la hora en que el
 *  vehículo YA ESTÁ DISPUESTO para salir (aclarado por el usuario), no una
 *  estimación gruesa, pero sigue sin confirmar que efectivamente salió.
 *  Por eso el label nunca dice "de tránsito" para este tramo (afirmaría un
 *  movimiento que no está confirmado) — siempre "desde despacho": con "~"
 *  y calculado EN VIVO contra `now` mientras el destino no ha llegado
 *  (mismo criterio que dwellStatus, Hito 14); sin "~" y congelado contra
 *  la llegada real apenas existe (el extremo de llegada si queda
 *  confirmado, aunque el de salida siga siendo un supuesto). El resto de
 *  los tramos (entre destinos) no cambia: solo con salida/llegada real
 *  confirmadas por ambos lados, "de tránsito". */
export function transitTime(from: TripStop, to: TripStop, now: number = Date.now()): string | null {
  let dep = toMs(from.departure_date ?? from.gps_departure_date)
  const usingPlannedOrigin = dep == null && from.stop_type === 'ORIGIN'
  if (usingPlannedOrigin) {
    dep = toMs(from.planning_date)
  }
  if (dep == null) return null

  let arr = toMs(to.arrival_date ?? to.gps_arrival_date)
  const noRealArrival = arr == null
  if (noRealArrival) {
    if (!usingPlannedOrigin) return null
    arr = now
  }
  if (arr == null || arr <= dep) return null
  const duration = formatDurationMinutes((arr - dep) / 60_000)

  if (usingPlannedOrigin) {
    return noRealArrival ? `~${duration} desde despacho` : `${duration} desde despacho`
  }
  return `${duration} de tránsito`
}
