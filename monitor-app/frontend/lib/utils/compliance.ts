import type { TripStop } from '@/lib/types'

export type StopComplianceSummary = 'ok' | 'warn' | null

export function stopComplianceSummary(stops: TripStop[]): StopComplianceSummary {
  if (!stops?.length) return null
  const withStatus = stops.filter(s => s.on_time_status != null)
  if (withStatus.length === 0) return null
  return withStatus.some(s => s.on_time_status === 'OFF TIME') ? 'warn' : 'ok'
}
