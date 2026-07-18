import { describe, it, expect } from 'vitest'
import { deriveKpis, matchesKpi, DEFAULT_ALERT_RULES, isOpenTrip } from './kpis'
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
    const hot = makeTrip('a', { stops: [makeStop({ temperature: 11 })] })
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
})

describe('deriveKpis', () => {
  it('cuenta las 6 excepciones de forma independiente', () => {
    const trips = [
      makeTrip('a', { stops: [makeStop({ on_time_status: 'OFF TIME', temperature: 11 })] }),
      makeTrip('b', { status_reported_at: '2026-07-04 14:00:00' }),
      makeTrip('c', { driver_name: null }),
      makeTrip('d'),
    ]
    const kpis = deriveKpis(trips, RANGES, RULES, NOW)
    expect(kpis.off_time).toBe(1)
    expect(kpis.stale).toBe(1)
    expect(kpis.temp_out).toBe(1)
    expect(kpis.unassigned).toBe(1)
    expect(kpis.dwell).toBe(0)
    expect(kpis.late_arrival).toBe(0)
  })
})
