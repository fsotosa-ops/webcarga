import { describe, it, expect } from 'vitest'
import {
  alertSignalDefs, computeSignalCounts, matchesActiveSignals, severityBand,
  isKpiSignal, KPI_SIGNAL_IDS, FLAG_SIGNAL_IDS,
} from './alertSignals'
import { DEFAULT_ALERT_RULES } from './kpis'
import type { Trip } from '@/lib/types'

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 't1', source_system: 'qanalytics', client_name: null, planning_date: '2026-07-18',
    status_reported_at: null, current_status: 'ORIGEN', tractor_plate: null, tractor_plate_tms: null,
    trailer_plate: null, driver_name: null, driver_name_tms: null, driver_tax_id: null, driver_phone: null,
    carrier_name: null, carrier_name_tms: null, origin: null, cargo_type: null, stops: [],
    is_active: false, is_working: false, is_assigned: false, is_first_leg: false,
    manual_status: null, notes: null, comments: null, unassigned_reason_id: null,
    fleet_link_id: null, carrier_id: null, driver_id: null, tractor_asset_id: null, trailer_asset_id: null,
    manually_edited_fields: [], edited_at: null, edited_by: null, updated_at: null, created_at: null,
    source_system_trip_id: null, milestone_status: null, pipeline_updated_at: null,
    ...overrides,
  }
}

describe('alertSignals', () => {
  it('alertSignalDefs returns 6 KPI + 4 flag = 10 signals when unassigned is enabled', () => {
    const defs = alertSignalDefs(DEFAULT_ALERT_RULES)
    expect(defs.map(d => d.id)).toEqual([
      'off_time', 'late_arrival', 'dwell', 'stale', 'temp_out', 'unassigned',
      'active', 'working', 'assigned', 'second_leg_plus',
    ])
  })

  it('alertSignalDefs drops unassigned when the rule is disabled, keeping 9', () => {
    const defs = alertSignalDefs({ ...DEFAULT_ALERT_RULES, unassigned_enabled: false })
    expect(defs.map(d => d.id)).not.toContain('unassigned')
    expect(defs).toHaveLength(9)
  })

  it('isKpiSignal classifies both groups correctly', () => {
    for (const id of KPI_SIGNAL_IDS) expect(isKpiSignal(id)).toBe(true)
    for (const id of FLAG_SIGNAL_IDS) expect(isKpiSignal(id)).toBe(false)
  })

  it('computeSignalCounts counts flags directly from Trip columns', () => {
    const trips = [makeTrip({ is_active: true }), makeTrip({ is_active: false })]
    const counts = computeSignalCounts(trips, [])
    expect(counts.active).toBe(1)
  })

  it('computeSignalCounts counts second_leg_plus from driver_leg_number >= 2', () => {
    const trips = [
      makeTrip({ driver_leg_number: 1 }),
      makeTrip({ driver_leg_number: 2 }),
      makeTrip({ driver_leg_number: null }),
    ]
    expect(computeSignalCounts(trips, []).second_leg_plus).toBe(1)
  })

  it('matchesActiveSignals: OR between KPI signals — matches if at least one applies', () => {
    const offTimeTrip = makeTrip({ stops: [{ stop_id: 's1', local: 'A', planning_date: null, arrival_date: null, departure_date: null, departure_date_prog: null, unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null, on_time_status: 'OFF TIME', destination_city: null, destination_region: null, s2s: null, temperature: null, milestone_status: null }] })
    expect(matchesActiveSignals(offTimeTrip, ['off_time', 'temp_out'], [])).toBe(true)
    expect(matchesActiveSignals(offTimeTrip, ['temp_out'], [])).toBe(false)
  })

  it('matchesActiveSignals: AND between flag signals', () => {
    const trip = makeTrip({ is_active: true, is_working: false })
    expect(matchesActiveSignals(trip, ['active', 'working'], [])).toBe(false)
    expect(matchesActiveSignals(trip, ['active'], [])).toBe(true)
  })

  it('matchesActiveSignals: empty array matches everything', () => {
    expect(matchesActiveSignals(makeTrip(), [], [])).toBe(true)
  })

  it('severityBand bands 0/1-2/3+', () => {
    expect(severityBand(0)).toBe('neutral')
    expect(severityBand(1)).toBe('elevated')
    expect(severityBand(2)).toBe('elevated')
    expect(severityBand(3)).toBe('critical')
    expect(severityBand(10)).toBe('critical')
  })
})
