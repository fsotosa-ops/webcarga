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
    carrier_name: null, carrier_name_tms: null, origin: null, cargo_type: null, cargo_delivered: false, temp_status: null, stops: [],
    is_active: false, is_working: false, is_assigned: false, is_first_leg: false,
    manual_status: null, notes: null, comments: null, unassigned_reason_id: null,
    fleet_link_id: null, carrier_id: null, driver_id: null, tractor_asset_id: null, trailer_asset_id: null,
    manually_edited_fields: [], edited_at: null, edited_by: null, updated_at: null, created_at: null,
    source_system_trip_id: null, milestone_status: null, pipeline_updated_at: null,
    ...overrides,
  }
}

describe('alertSignals', () => {
  it('alertSignalDefs returns 6 KPI + 4 flag = 10 signals (2026-08-18: + "El TMS dejó de reportarlo")', () => {
    const defs = alertSignalDefs(DEFAULT_ALERT_RULES)
    expect(defs.map(d => d.id)).toEqual([
      'dwell_severity', 'stale', 'tms_dropped', 'temp_out', 'temp_reported', 'fleet_unmatched',
      'active', 'working', 'assigned', 'second_leg_plus',
    ])
  })

  // Las dos señales de "el TMS no dice nada" son contiguas y distintas; que sus
  // labels lleven cada uno su propio umbral es lo que las hace distinguibles en
  // pantalla, y por eso se afirma acá.
  it('tms_dropped y stale muestran cada uno su propio umbral en el label', () => {
    const defs = alertSignalDefs({ ...DEFAULT_ALERT_RULES, stale_report_hours: 2, tms_dropped_hours: 3 })
    expect(defs.find(d => d.id === 'stale')!.label).toBe('Sin actualización del TMS > 2h')
    expect(defs.find(d => d.id === 'tms_dropped')!.label).toBe('El TMS dejó de reportarlo > 3h')
  })

  it('tms_dropped cuenta y filtra como el resto de las señales KPI', () => {
    const trips = [makeTrip({ tms_dropped: true }), makeTrip({ tms_dropped: false })]
    expect(computeSignalCounts(trips, []).tms_dropped).toBe(1)
    expect(matchesActiveSignals(trips[0], ['tms_dropped'], [])).toBe(true)
    expect(matchesActiveSignals(trips[1], ['tms_dropped'], [])).toBe(false)
  })

  it('fleet_unmatched ("Sin identificar") cuenta y filtra vía el KPI compartido', () => {
    const trips = [makeTrip({ fleet_match_status: 'UNMATCHED' }), makeTrip({ fleet_match_status: 'MATCHED' })]
    const counts = computeSignalCounts(trips, [])
    expect(counts.fleet_unmatched).toBe(1)
    expect(matchesActiveSignals(trips[0], ['fleet_unmatched'], [])).toBe(true)
    expect(matchesActiveSignals(trips[1], ['fleet_unmatched'], [])).toBe(false)
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
    const tempOutTrip = makeTrip({ temp_status: 'out_of_range' })
    expect(matchesActiveSignals(tempOutTrip, ['temp_out', 'fleet_unmatched'], [])).toBe(true)
    expect(matchesActiveSignals(tempOutTrip, ['fleet_unmatched'], [])).toBe(false)
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
