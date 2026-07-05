import type { Trip, TemperatureRangeMeta } from '@/lib/types'
import { stopComplianceSummary } from './compliance'
import { getLatestTemp, classifyTemperature } from './temperature'
import { normalizeUTC } from './datetime'

export type KpiId = 'off_time' | 'stale' | 'temp_out'

export const STALE_HOURS = 2

/** true si el viaje cae en la excepción indicada (usado por los KPIs accionables del Diario) */
export function matchesKpi(
  trip: Trip,
  kpi: KpiId,
  ranges: TemperatureRangeMeta[],
  now: number = Date.now(),
): boolean {
  switch (kpi) {
    case 'off_time':
      return stopComplianceSummary(trip.stops ?? []) === 'warn'
    case 'stale': {
      if (!trip.status_reported_at) return false
      const t = new Date(normalizeUTC(trip.status_reported_at)).getTime()
      if (isNaN(t)) return false
      return now - t > STALE_HOURS * 3600_000
    }
    case 'temp_out':
      return classifyTemperature(getLatestTemp(trip.stops ?? []), trip.cargo_type, ranges) === 'out_of_range'
  }
}

export interface DiarioKpis {
  off_time: number
  stale:    number
  temp_out: number
}

export function deriveKpis(
  trips: Trip[],
  ranges: TemperatureRangeMeta[],
  now: number = Date.now(),
): DiarioKpis {
  const kpis: DiarioKpis = { off_time: 0, stale: 0, temp_out: 0 }
  for (const t of trips) {
    if (matchesKpi(t, 'off_time', ranges, now)) kpis.off_time++
    if (matchesKpi(t, 'stale',    ranges, now)) kpis.stale++
    if (matchesKpi(t, 'temp_out', ranges, now)) kpis.temp_out++
  }
  return kpis
}
