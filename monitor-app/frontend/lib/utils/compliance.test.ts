import { describe, it, expect } from 'vitest'
import { stopComplianceSummary } from './compliance'
import type { TripStop } from '@/lib/types'

function makeStop(overrides: Partial<TripStop>): TripStop {
  return {
    stop_id: 's1', local: 'Parada', planning_date: null,
    arrival_date: null, departure_date: null, unload_start: null, unload_end: null,
    gps_arrival_date: null, gps_departure_date: null, on_time_status: null,
    destination_city: null, destination_region: null, s2s: null,
    temperature: null, milestone_status: null,
    ...overrides,
  }
}

describe('stopComplianceSummary', () => {
  it('returns null for an empty stop list', () => {
    expect(stopComplianceSummary([])).toBeNull()
  })

  it('returns null when no stop has on_time_status data yet', () => {
    const stops = [makeStop({}), makeStop({})]
    expect(stopComplianceSummary(stops)).toBeNull()
  })

  it('returns "ok" when all stops with data are ON TIME', () => {
    const stops = [makeStop({ on_time_status: 'ON TIME' }), makeStop({ on_time_status: 'ON TIME' }), makeStop({})]
    expect(stopComplianceSummary(stops)).toBe('ok')
  })

  it('returns "warn" when at least one stop is OFF TIME', () => {
    const stops = [makeStop({ on_time_status: 'ON TIME' }), makeStop({ on_time_status: 'OFF TIME' })]
    expect(stopComplianceSummary(stops)).toBe('warn')
  })
})
