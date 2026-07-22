import type { Trip, TripStop, TemperatureRangeMeta, MonitorAlertRules } from '@/lib/types'
import { stopComplianceSummary } from './compliance'
import { getLatestTemp, classifyTemperature } from './temperature'
import { normalizeUTC } from './datetime'

export type KpiId = 'off_time' | 'stale' | 'temp_out' | 'dwell' | 'late_arrival' | 'unassigned' | 'fleet_unmatched'

// Defaults si meta.monitor_alert_rules aún no está disponible
export const DEFAULT_ALERT_RULES: MonitorAlertRules = {
  stale_report_hours:     2,
  dwell_hours:            2,
  late_arrival_grace_min: 60,
  unassigned_enabled:     true,
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

function stopArrival(s: TripStop): number | null {
  return toMs(s.arrival_date) ?? toMs(s.gps_arrival_date)
}

function stopDeparture(s: TripStop): number | null {
  return toMs(s.departure_date) ?? toMs(s.gps_departure_date)
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
    case 'off_time':
      return stopComplianceSummary(trip.stops ?? []) === 'warn'

    case 'stale': {
      if (!isOpenTrip(trip)) return false
      const t = toMs(trip.status_reported_at)
      if (t == null) return false
      return now - t > rules.stale_report_hours * 3600_000
    }

    case 'temp_out':
      return classifyTemperature(getLatestTemp(trip.stops ?? []), trip.cargo_type, ranges) === 'out_of_range'

    // Llegó a una parada y no registra salida hace más de N horas
    case 'dwell': {
      if (!isOpenTrip(trip)) return false
      return (trip.stops ?? []).some(s => {
        const arr = stopArrival(s)
        return arr != null && stopDeparture(s) == null && now - arr > rules.dwell_hours * 3600_000
      })
    }

    // Parada con hora planificada vencida (+ gracia) sin llegada real ni GPS
    case 'late_arrival': {
      if (!isOpenTrip(trip)) return false
      return (trip.stops ?? []).some(s => {
        if (stopArrival(s) != null) return false
        const plan = toMs(s.planning_date)
        return plan != null && now - plan > rules.late_arrival_grace_min * 60_000
      })
    }

    // Viaje sin patente o conductor (sodimac excluido: nunca reporta flota)
    case 'unassigned': {
      if (!rules.unassigned_enabled) return false
      if (!isOpenTrip(trip)) return false
      if (trip.source_system === 'sodimac') return false
      const noPlate  = !trip.tractor_plate && !trip.trailer_plate
      const noDriver = !trip.driver_name
      return noPlate || noDriver
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
  const kpis: DiarioKpis = { off_time: 0, stale: 0, temp_out: 0, dwell: 0, late_arrival: 0, unassigned: 0, fleet_unmatched: 0 }
  for (const t of trips) {
    for (const id of Object.keys(kpis) as KpiId[]) {
      if (matchesKpi(t, id, ranges, rules, now)) kpis[id]++
    }
  }
  return kpis
}
