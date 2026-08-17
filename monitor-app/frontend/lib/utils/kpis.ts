import type { Trip, TripStop, TemperatureRangeMeta, MonitorAlertRules } from '@/lib/types'
import { normalizeUTC } from './datetime'
import { formatDurationMinutes } from './stopStats'

/** Set de alertas activas (2026-08-01): reducido a 4 mientras los hitos 12
 *  (retornando)/15/16 (cruce de flota) no tengan una definición de negocio.
 *  'off_time', 'late_arrival' y 'unassigned' quedaron descartados — el
 *  binario 'dwell' fue reemplazado por 'dwell_severity' (semáforo de 4
 *  niveles, Hito 14, ver dwellSeverity). */
export type KpiId = 'stale' | 'temp_out' | 'temp_reported' | 'dwell_severity' | 'fleet_unmatched'

export type DwellSeverity = 'green' | 'yellow' | 'orange' | 'red'

// Defaults si meta.monitor_alert_rules aún no está disponible
export const DEFAULT_ALERT_RULES: MonitorAlertRules = {
  stale_report_hours:     2,
  dwell_hours:            2,
  late_arrival_grace_min: 60,
  unassigned_enabled:     true,
  dwell_yellow_min:       60,
  dwell_orange_min:       90,
  dwell_red_min:          120,
}

function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = new Date(normalizeUTC(iso)).getTime()
  return isNaN(t) ? null : t
}

/** Mismo criterio de estado terminal que la derivación de `is_active` en dbt —
 *  las alertas operacionales solo aplican a viajes abiertos (accionables) */
export function isOpenTrip(trip: Trip): boolean {
  const s = trip.current_status ?? ''
  return !s.startsWith('CERRADO') && !['CANCELADO', 'Declinada', 'Removida'].includes(s)
}

/** GPS primero, TR (arrival_date/departure_date) como fallback — FIX
 *  2026-08-01: antes priorizaba TR, al revés que el backend
 *  (_stop_arrived/_stop_departed, trips.py). GPS se reporta ~87% de las
 *  veces en paradas reales de QAnalytics vs. ~8% TR (Ronda 61) — con TR
 *  primero, la severidad de tiempo en local (dwellSeverity) podía calcular
 *  la llegada contra un dato menos confiable que el que ya usa is_active. */
function stopArrival(s: TripStop): number | null {
  return toMs(s.gps_arrival_date) ?? toMs(s.arrival_date)
}

function stopDeparture(s: TripStop): number | null {
  return toMs(s.gps_departure_date) ?? toMs(s.departure_date)
}

export interface DwellStatus {
  severity: DwellSeverity
  /** Texto listo para mostrar, ej. "1h 45m en local". */
  label:    string
}

/** Hito 14 (minuta 29/07 §4.4): severidad de tiempo en la parada activa —
 *  única fuente de verdad de "quién está activo" es stop.is_active (mismo
 *  criterio que StopTimeline/getActiveStop, calculado en backend por
 *  _mark_active_stop). null cuando el viaje está cerrado o no hay parada
 *  activa.
 *
 *  FIX 2026-08-02 (pedido explícito del usuario: "¿qué pasa con los que
 *  permanecen mucho tiempo en el origen?"): el origen nunca tiene
 *  arrival_date/gps_arrival_date (no es una "llegada"), así que antes esta
 *  función siempre devolvía null mientras is_active apuntaba al origen —
 *  un camión parado horas sin salir del origen no disparaba ninguna
 *  alerta. Ahora, cuando la parada activa es el origen, se usa
 *  planning_date (para QAnalytics: la hora en que el vehículo ya está
 *  dispuesto para salir, aclarado por el usuario) como referencia — mismo
 *  criterio que ya usa transitTime (stopStats.ts) para el tramo
 *  origen→primer destino. El label nunca dice "en local" para el origen
 *  (no es un local de destino) — dice "desde despacho", igual framing que
 *  transitTime. */
export function dwellStatus(
  trip: Trip,
  rules: MonitorAlertRules = DEFAULT_ALERT_RULES,
  now: number = Date.now(),
): DwellStatus | null {
  if (!isOpenTrip(trip)) return null
  const stop = (trip.stops ?? []).find(s => s.is_active)
  if (!stop) return null
  const isOrigin = stop.stop_type === 'ORIGIN'
  const arr = isOrigin ? toMs(stop.planning_date) : stopArrival(stop)
  if (arr == null || stopDeparture(stop) != null) return null
  const minutes = (now - arr) / 60_000
  const severity: DwellSeverity =
    minutes >= rules.dwell_red_min ? 'red' :
    minutes >= rules.dwell_orange_min ? 'orange' :
    minutes >= rules.dwell_yellow_min ? 'yellow' : 'green'
  const label = isOrigin
    ? `${formatDurationMinutes(minutes)} desde despacho`
    : `${formatDurationMinutes(minutes)} en local`
  return { severity, label }
}

/** true si el viaje cae en la excepción indicada (KPIs accionables del Diario) */
export function matchesKpi(
  trip: Trip,
  kpi: KpiId,
  ranges: TemperatureRangeMeta[],
  rules: MonitorAlertRules = DEFAULT_ALERT_RULES,
  now: number = Date.now(),
): boolean {
  switch (kpi) {
    case 'stale': {
      if (!isOpenTrip(trip)) return false
      const t = toMs(trip.status_reported_at)
      if (t == null) return false
      return now - t > rules.stale_report_hours * 3600_000
    }

    case 'temp_out':
      return trip.temp_status === 'out_of_range'

    // Los viajes que SI reportan temperatura, este o no en rango. No es una
    // alerta: es el subconjunto con cadena de frio, y sin este filtro no hay
    // forma de mirar solo esos — "fuera de rango" solo muestra los que ya
    // fallaron. Se lee de las paradas, no de trip.temp_status, que se apaga
    // al entregarse la carga (mismo criterio que la celda de la tabla).
    case 'temp_reported':
      return (trip.stops ?? []).some(s => s.temperature != null)

    // Solo cuenta como alerta lo anómalo (amarillo/naranja/rojo) — verde es
    // el estado normal, mismo criterio de "gestión por excepción" que ya
    // usa el resto del Diario.
    case 'dwell_severity': {
      const status = dwellStatus(trip, rules, now)
      return status != null && status.severity !== 'green'
    }

    // "Sin identificar" (Ronda 43, Hallazgo F): tracto/conductor que el TMS
    // reporta sin ningún cruce contra empresa — la detección ya existe
    // (app.v_trip_fleet_resolution → fleet_match_status), pero hasta ahora
    // solo se veía como banner pasivo dentro del detalle de un viaje. Pablo
    // pidió explícitamente que quede visible "en la cuadratura de la caja"
    // (transcript-meeting.md línea 605) — de ahí que sea un KPI contable y
    // filtrable como el resto, no solo texto en el slide-over.
    case 'fleet_unmatched':
      return trip.fleet_match_status === 'UNMATCHED'
  }
}

export type DiarioKpis = Record<KpiId, number>

export function deriveKpis(
  trips: Trip[],
  ranges: TemperatureRangeMeta[],
  rules: MonitorAlertRules = DEFAULT_ALERT_RULES,
  now: number = Date.now(),
): DiarioKpis {
  const kpis: DiarioKpis = { stale: 0, temp_out: 0, temp_reported: 0, dwell_severity: 0, fleet_unmatched: 0 }
  for (const t of trips) {
    for (const id of Object.keys(kpis) as KpiId[]) {
      if (matchesKpi(t, id, ranges, rules, now)) kpis[id]++
    }
  }
  return kpis
}
