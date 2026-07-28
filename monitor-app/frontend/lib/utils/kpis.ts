import type { Trip, TripStop, TemperatureRangeMeta, MonitorAlertRules } from '@/lib/types'
import { stopComplianceSummary } from './compliance'
import { getLatestTemp, getLatestTempStop, classifyTemperature } from './temperature'
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

/** Los mismos 4 KPIs que puede disparar el badge de bitácora (ver
 *  needsBitacoraFollowup) — unassigned/fleet_unmatched no tienen un ancla
 *  temporal natural, off_time ya está cubierto en la práctica por
 *  late_arrival/dwell. */
const FOLLOWUP_KPI_IDS: KpiId[] = ['late_arrival', 'dwell', 'stale', 'temp_out']

/** Timestamp (ms) desde el que un KPI activo lleva sonando. Re-aplica el
 *  mismo umbral que matchesKpi usa para decidir si el KPI está activo (no
 *  alcanza con "hay un stop sin este dato" — si hay varios stops candidatos
 *  y solo uno cruzó el umbral, el ancla tiene que ser la de ESE, no la del
 *  primero del arreglo). Es una duplicación deliberada y acotada a estos 4
 *  casos — no se tocó matchesKpi (usado también por tiles/filtros/conteos
 *  en todo el Diario) para no ampliar el blast radius de este cambio; el
 *  test "matches matchesKpi exactly" en kpis.test.ts existe para que estas
 *  dos implementaciones no se desalineen en silencio. Devuelve null para
 *  los 3 KPIs sin ancla temporal (unassigned, fleet_unmatched, off_time). */
export function kpiAnchorTimestamp(
  trip: Trip,
  kpi: KpiId,
  ranges: TemperatureRangeMeta[],
  rules: MonitorAlertRules = DEFAULT_ALERT_RULES,
  now: number = Date.now(),
): number | null {
  switch (kpi) {
    case 'late_arrival': {
      if (!isOpenTrip(trip)) return null
      for (const s of trip.stops ?? []) {
        if (stopArrival(s) != null) continue
        const plan = toMs(s.planning_date)
        if (plan != null && now - plan > rules.late_arrival_grace_min * 60_000) return plan
      }
      return null
    }

    case 'dwell': {
      if (!isOpenTrip(trip)) return null
      for (const s of trip.stops ?? []) {
        const arr = stopArrival(s)
        if (arr != null && stopDeparture(s) == null && now - arr > rules.dwell_hours * 3600_000) return arr
      }
      return null
    }

    case 'stale': {
      if (!isOpenTrip(trip)) return null
      const t = toMs(trip.status_reported_at)
      if (t == null || now - t <= rules.stale_report_hours * 3600_000) return null
      return t
    }

    case 'temp_out': {
      const stop = getLatestTempStop(trip.stops ?? [])
      if (!stop) return null
      if (classifyTemperature(stop.temperature ?? null, trip.cargo_type, ranges) !== 'out_of_range') return null
      return stopArrival(stop)
    }

    default:
      return null
  }
}

/** true si el viaje tiene alguna de las 4 alertas en alcance (ver
 *  FOLLOWUP_KPI_IDS) activa y ningún humano dejó una nota en la bitácora
 *  desde que esa alerta empezó a sonar. Si hay más de una alerta activa a
 *  la vez, compara contra la más reciente — si una nota ya cubrió la más
 *  vieja pero apareció una alerta nueva después, vuelve a pedir
 *  seguimiento. Notas note_type='sistema' no cuentan (ya excluidas por el
 *  backend en last_human_note_at). No hace falta llamar matchesKpi acá:
 *  kpiAnchorTimestamp ya devuelve null exactamente cuando matchesKpi
 *  devolvería false, para los 4 KPIs en alcance. */
export function needsBitacoraFollowup(
  trip: Trip,
  ranges: TemperatureRangeMeta[],
  rules: MonitorAlertRules = DEFAULT_ALERT_RULES,
  now: number = Date.now(),
): boolean {
  let latestAnchor: number | null = null
  for (const kpi of FOLLOWUP_KPI_IDS) {
    const anchor = kpiAnchorTimestamp(trip, kpi, ranges, rules, now)
    if (anchor != null && (latestAnchor == null || anchor > latestAnchor)) {
      latestAnchor = anchor
    }
  }
  if (latestAnchor == null) return false
  const lastNote = toMs(trip.last_human_note_at)
  return lastNote == null || lastNote < latestAnchor
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
