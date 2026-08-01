import { describe, it, expect } from 'vitest'
import { deriveKpis, matchesKpi, DEFAULT_ALERT_RULES, isOpenTrip, kpiAnchorTimestamp, needsBitacoraFollowup } from './kpis'
import type { Trip, TripStop, TemperatureRangeMeta, MonitorAlertRules } from '@/lib/types'

function makeStop(overrides: Partial<TripStop> = {}): TripStop {
  return {
    stop_id: 's1', local: 'Parada 1', planning_date: null, arrival_date: null, departure_date: null,
    departure_date_prog: null, unload_start: null, unload_end: null, gps_arrival_date: null,
    gps_departure_date: null, on_time_status: null, destination_city: null, destination_region: null,
    s2s: null, temperature: null, milestone_status: null,
    ...overrides,
  }
}

function makeTrip(id: string, overrides: Partial<Trip> = {}): Trip {
  return {
    id, source_system: 'qanalytics', client_name: 'walmart', planning_date: '2026-07-04',
    status_reported_at: null, current_status: 'RUTA', tractor_plate: 'ABCD12', tractor_plate_tms: null, trailer_plate: null,
    driver_name: 'Juan', driver_name_tms: null, driver_tax_id: null, driver_phone: null, carrier_name: null, carrier_name_tms: null,
    origin: null, cargo_type: 'FRIO', stops: [], is_active: true, is_working: false, is_assigned: true,
    is_first_leg: false, manual_status: null, notes: null, comments: null, unassigned_reason_id: null,
    fleet_link_id: null, carrier_id: null, driver_id: null, tractor_asset_id: null, trailer_asset_id: null, manually_edited_fields: [], edited_at: null,
    edited_by: null, updated_at: null, created_at: null,
    source_system_trip_id: '1', milestone_status: null, pipeline_updated_at: null,
    ...overrides,
  }
}

const NOW = Date.parse('2026-07-04T18:00:00Z')
const RANGES: TemperatureRangeMeta[] = [{ cargo_type: 'FRIO', label: 'Frío', min_c: 2, max_c: 5 }]
const RULES = DEFAULT_ALERT_RULES

describe('isOpenTrip', () => {
  it('terminal statuses are not open', () => {
    expect(isOpenTrip(makeTrip('a', { current_status: 'CERRADO FINALIZADO' }))).toBe(false)
    expect(isOpenTrip(makeTrip('b', { current_status: 'CANCELADO' }))).toBe(false)
    expect(isOpenTrip(makeTrip('c', { current_status: 'RUTA' }))).toBe(true)
  })
})

describe('matchesKpi — alertas existentes', () => {
  it('off_time: true solo si alguna parada está OFF TIME', () => {
    const off = makeTrip('a', { stops: [makeStop({ on_time_status: 'OFF TIME' })] })
    const on  = makeTrip('b', { stops: [makeStop({ on_time_status: 'ON TIME' })] })
    expect(matchesKpi(off, 'off_time', RANGES, RULES, NOW)).toBe(true)
    expect(matchesKpi(on,  'off_time', RANGES, RULES, NOW)).toBe(false)
  })

  it('stale: umbral configurable y excluye viajes cerrados', () => {
    const old    = makeTrip('a', { status_reported_at: '2026-07-04 15:00:00' }) // 3h antes
    const closed = makeTrip('b', { status_reported_at: '2026-07-04 10:00:00', current_status: 'CERRADO FINALIZADO' })
    expect(matchesKpi(old, 'stale', RANGES, RULES, NOW)).toBe(true)
    expect(matchesKpi(old, 'stale', RANGES, { ...RULES, stale_report_hours: 4 }, NOW)).toBe(false)
    expect(matchesKpi(closed, 'stale', RANGES, RULES, NOW)).toBe(false)
  })

  it('temp_out: fuera de rango configurado', () => {
    const hot = makeTrip('a', { stops: [makeStop({ temperature: 11, is_active: true })] })
    expect(matchesKpi(hot, 'temp_out', RANGES, RULES, NOW)).toBe(true)
  })
})

describe('matchesKpi — alertas nuevas', () => {
  it('dwell: llegada sin salida hace más de dwell_hours', () => {
    const stuck = makeTrip('a', { stops: [makeStop({ arrival_date: '2026-07-04 15:00:00' })] }) // 3h sin salir
    const moving = makeTrip('b', { stops: [makeStop({ arrival_date: '2026-07-04 15:00:00', departure_date: '2026-07-04 15:40:00' })] })
    expect(matchesKpi(stuck, 'dwell', RANGES, RULES, NOW)).toBe(true)
    expect(matchesKpi(moving, 'dwell', RANGES, RULES, NOW)).toBe(false)
    expect(matchesKpi(stuck, 'dwell', RANGES, { ...RULES, dwell_hours: 4 }, NOW)).toBe(false)
  })

  it('dwell: acepta llegada solo-GPS', () => {
    const stuck = makeTrip('a', { stops: [makeStop({ gps_arrival_date: '2026-07-04 14:00:00' })] })
    expect(matchesKpi(stuck, 'dwell', RANGES, RULES, NOW)).toBe(true)
  })

  it('late_arrival: plan vencido + gracia sin llegada real ni GPS', () => {
    const late  = makeTrip('a', { stops: [makeStop({ planning_date: '2026-07-04 16:00:00' })] }) // 2h tarde
    const grace = makeTrip('b', { stops: [makeStop({ planning_date: '2026-07-04 17:30:00' })] }) // 30min: dentro de gracia
    const arrived = makeTrip('c', { stops: [makeStop({ planning_date: '2026-07-04 16:00:00', gps_arrival_date: '2026-07-04 16:10:00' })] })
    expect(matchesKpi(late, 'late_arrival', RANGES, RULES, NOW)).toBe(true)
    expect(matchesKpi(grace, 'late_arrival', RANGES, RULES, NOW)).toBe(false)
    expect(matchesKpi(arrived, 'late_arrival', RANGES, RULES, NOW)).toBe(false)
  })

  it('unassigned: sin patente o conductor, excluye sodimac y respeta el toggle', () => {
    const noDriver = makeTrip('a', { driver_name: null })
    const sodimac  = makeTrip('b', { driver_name: null, tractor_plate: null, source_system: 'sodimac' })
    const full     = makeTrip('c')
    expect(matchesKpi(noDriver, 'unassigned', RANGES, RULES, NOW)).toBe(true)
    expect(matchesKpi(sodimac, 'unassigned', RANGES, RULES, NOW)).toBe(false)
    expect(matchesKpi(full, 'unassigned', RANGES, RULES, NOW)).toBe(false)
    const off: MonitorAlertRules = { ...RULES, unassigned_enabled: false }
    expect(matchesKpi(noDriver, 'unassigned', RANGES, off, NOW)).toBe(false)
  })

  it('fleet_unmatched ("Sin identificar"): true solo si fleet_match_status es UNMATCHED', () => {
    const ovni    = makeTrip('a', { fleet_match_status: 'UNMATCHED' })
    const matched = makeTrip('b', { fleet_match_status: 'MATCHED' })
    const mismatch = makeTrip('c', { fleet_match_status: 'MISMATCH' })
    const none    = makeTrip('d')
    expect(matchesKpi(ovni, 'fleet_unmatched', RANGES, RULES, NOW)).toBe(true)
    expect(matchesKpi(matched, 'fleet_unmatched', RANGES, RULES, NOW)).toBe(false)
    expect(matchesKpi(mismatch, 'fleet_unmatched', RANGES, RULES, NOW)).toBe(false)
    expect(matchesKpi(none, 'fleet_unmatched', RANGES, RULES, NOW)).toBe(false)
  })
})

describe('deriveKpis', () => {
  it('cuenta las 7 excepciones de forma independiente', () => {
    const trips = [
      makeTrip('a', { stops: [makeStop({ on_time_status: 'OFF TIME', temperature: 11, is_active: true })] }),
      makeTrip('b', { status_reported_at: '2026-07-04 14:00:00' }),
      makeTrip('c', { driver_name: null }),
      makeTrip('d'),
      makeTrip('e', { fleet_match_status: 'UNMATCHED' }),
    ]
    const kpis = deriveKpis(trips, RANGES, RULES, NOW)
    expect(kpis.off_time).toBe(1)
    expect(kpis.stale).toBe(1)
    expect(kpis.temp_out).toBe(1)
    expect(kpis.unassigned).toBe(1)
    expect(kpis.fleet_unmatched).toBe(1)
    expect(kpis.dwell).toBe(0)
    expect(kpis.late_arrival).toBe(0)
  })
})

describe('kpiAnchorTimestamp', () => {
  it('late_arrival: anchors on the overdue stop\'s planning_date', () => {
    const trip = makeTrip('a', {
      stops: [makeStop({ planning_date: '2026-07-04 10:00:00' })], // 8h before NOW, past 60min grace
    })
    expect(kpiAnchorTimestamp(trip, 'late_arrival', RANGES, RULES, NOW)).toBe(Date.parse('2026-07-04T10:00:00Z'))
  })

  it('late_arrival: does not anchor on a stop that has a plan but has not exceeded the grace period yet', () => {
    const notYetLate = makeStop({ stop_id: 's1', planning_date: '2026-07-04 17:30:00' }) // 30min before NOW, under 60min grace
    const trip = makeTrip('a', { stops: [notYetLate] })
    expect(kpiAnchorTimestamp(trip, 'late_arrival', RANGES, RULES, NOW)).toBeNull()
  })

  it('late_arrival: with two candidate stops, anchors on the one that is actually overdue, not the first in the array', () => {
    const notYetLate = makeStop({ stop_id: 's1', planning_date: '2026-07-04 17:30:00' }) // under grace
    const overdue    = makeStop({ stop_id: 's2', planning_date: '2026-07-04 10:00:00' }) // well past grace
    const trip = makeTrip('a', { stops: [notYetLate, overdue] })
    expect(kpiAnchorTimestamp(trip, 'late_arrival', RANGES, RULES, NOW)).toBe(Date.parse('2026-07-04T10:00:00Z'))
  })

  it('dwell: anchors on the stuck stop\'s arrival_date', () => {
    const trip = makeTrip('a', {
      stops: [makeStop({ arrival_date: '2026-07-04 15:00:00', departure_date: null })], // 3h before NOW
    })
    expect(kpiAnchorTimestamp(trip, 'dwell', RANGES, RULES, NOW)).toBe(Date.parse('2026-07-04T15:00:00Z'))
  })

  it('dwell: does not anchor when the stop has not been stuck past the threshold yet', () => {
    const trip = makeTrip('a', {
      stops: [makeStop({ arrival_date: '2026-07-04 17:30:00', departure_date: null })], // 30min before NOW, under 2h dwell_hours
    })
    expect(kpiAnchorTimestamp(trip, 'dwell', RANGES, RULES, NOW)).toBeNull()
  })

  it('stale: anchors on status_reported_at', () => {
    const trip = makeTrip('a', { status_reported_at: '2026-07-04 15:00:00' }) // 3h before NOW
    expect(kpiAnchorTimestamp(trip, 'stale', RANGES, RULES, NOW)).toBe(Date.parse('2026-07-04T15:00:00Z'))
  })

  it('temp_out: anchors on the reporting stop\'s arrival_date', () => {
    const trip = makeTrip('a', {
      cargo_type: 'FRIO',
      stops: [makeStop({ arrival_date: '2026-07-04 16:00:00', temperature: 9 })], // out of 2-5 range
    })
    expect(kpiAnchorTimestamp(trip, 'temp_out', RANGES, RULES, NOW)).toBe(Date.parse('2026-07-04T16:00:00Z'))
  })

  it('returns null when the KPI is not actually active', () => {
    const trip = makeTrip('a', { status_reported_at: '2026-07-04 17:50:00' }) // 10min before NOW, not stale
    expect(kpiAnchorTimestamp(trip, 'stale', RANGES, RULES, NOW)).toBeNull()
  })

  it('returns null for KPIs outside the followup badge scope', () => {
    const trip = makeTrip('a', { tractor_plate: null, trailer_plate: null, driver_name: null })
    expect(kpiAnchorTimestamp(trip, 'unassigned', RANGES, RULES, NOW)).toBeNull()
  })

  it('matches matchesKpi exactly: anchor is non-null if and only if matchesKpi is true', () => {
    for (const kpi of ['late_arrival', 'dwell', 'stale', 'temp_out'] as const) {
      const trip = makeTrip('a', {
        status_reported_at: '2026-07-04 15:00:00',
        stops: [makeStop({ arrival_date: '2026-07-04 15:00:00', departure_date: null, planning_date: '2026-07-04 10:00:00', temperature: 9 })],
        cargo_type: 'FRIO',
      })
      const anchor = kpiAnchorTimestamp(trip, kpi, RANGES, RULES, NOW)
      expect(anchor != null).toBe(matchesKpi(trip, kpi, RANGES, RULES, NOW))
    }
  })
})

describe('needsBitacoraFollowup', () => {
  it('false when no in-scope KPI is active', () => {
    const trip = makeTrip('a', { last_human_note_at: null })
    expect(needsBitacoraFollowup(trip, RANGES, RULES, NOW)).toBe(false)
  })

  it('true when a KPI is active and there is no human note at all', () => {
    const trip = makeTrip('a', {
      status_reported_at: '2026-07-04 15:00:00', // stale, 3h before NOW
      last_human_note_at: null,
    })
    expect(needsBitacoraFollowup(trip, RANGES, RULES, NOW)).toBe(true)
  })

  it('false when a human note came after the alert started', () => {
    const trip = makeTrip('a', {
      status_reported_at: '2026-07-04 15:00:00', // stale, 3h before NOW
      last_human_note_at: '2026-07-04T16:00:00Z', // 1h after the alert's anchor
    })
    expect(needsBitacoraFollowup(trip, RANGES, RULES, NOW)).toBe(false)
  })

  it('true when the last human note predates the alert', () => {
    const trip = makeTrip('a', {
      status_reported_at: '2026-07-04 15:00:00', // stale, anchor 15:00
      last_human_note_at: '2026-07-04T12:00:00Z', // note is older than the alert
    })
    expect(needsBitacoraFollowup(trip, RANGES, RULES, NOW)).toBe(true)
  })

  it('reopens when a second alert fires after the note that covered the first one', () => {
    // stale since 14:00 (4h before NOW, past the 2h threshold); note at 14:30 covers it.
    // dwell since 15:00 (3h before NOW, also past its 2h threshold) fires AFTER that note —
    // latest anchor becomes 15:00, which the 14:30 note does not cover.
    const trip = makeTrip('a', {
      status_reported_at: '2026-07-04 14:00:00',
      stops: [makeStop({ arrival_date: '2026-07-04 15:00:00', departure_date: null })],
      last_human_note_at: '2026-07-04T14:30:00Z',
    })
    expect(needsBitacoraFollowup(trip, RANGES, RULES, NOW)).toBe(true)
  })
})
