import { describe, it, expect } from 'vitest'
import { deriveKpis, matchesKpi, STALE_HOURS } from './kpis'
import type { Trip, TripStop, TemperatureRangeMeta } from '@/lib/types'

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
    status_reported_at: null, current_status: 'ORIGEN', tractor_plate: 'ABCD12', trailer_plate: null,
    driver_name: null, driver_rut: null, driver_phone: null, transporter: null, transporter_tms: null,
    origin: null, cargo_type: 'FRIO', stops: [], activo: true, trabajando: false, asignado: true,
    primera_vuelta: false, estado_manual: null, observaciones: null, comentarios: null,
    fleet_link_id: null, transporter_profile_id: null, manually_edited_fields: [], edited_at: null,
    edited_by: null, updated_at: null, created_at: null,
    source_system_trip_id: '1', milestone_status: null, pipeline_updated_at: null,
    ...overrides,
  }
}

const NOW = Date.parse('2026-07-04T18:00:00Z')
const RANGES: TemperatureRangeMeta[] = [{ cargo_type: 'FRIO', label: 'Frío', min_c: 2, max_c: 5 }]

describe('matchesKpi', () => {
  it('off_time: true solo si alguna parada está OFF TIME', () => {
    const off = makeTrip('a', { stops: [makeStop({ on_time_status: 'OFF TIME' })] })
    const on  = makeTrip('b', { stops: [makeStop({ on_time_status: 'ON TIME' })] })
    expect(matchesKpi(off, 'off_time', RANGES, NOW)).toBe(true)
    expect(matchesKpi(on,  'off_time', RANGES, NOW)).toBe(false)
  })

  it(`stale: true si el último reporte supera ${STALE_HOURS}h, false si es reciente o no hay reporte`, () => {
    const old    = makeTrip('a', { status_reported_at: '2026-07-04 15:00:00' }) // 3h antes
    const recent = makeTrip('b', { status_reported_at: '2026-07-04 17:30:00' }) // 30min antes
    const none   = makeTrip('c', { status_reported_at: null })
    expect(matchesKpi(old,    'stale', RANGES, NOW)).toBe(true)
    expect(matchesKpi(recent, 'stale', RANGES, NOW)).toBe(false)
    expect(matchesKpi(none,   'stale', RANGES, NOW)).toBe(false)
  })

  it('temp_out: true solo si la última temperatura sale del rango configurado para el cargo_type', () => {
    const hot  = makeTrip('a', { stops: [makeStop({ temperature: 11 })] })
    const ok   = makeTrip('b', { stops: [makeStop({ temperature: 3 })] })
    const seco = makeTrip('c', { cargo_type: 'SECO', stops: [makeStop({ temperature: 30 })] }) // sin rango => sin clasificar
    expect(matchesKpi(hot,  'temp_out', RANGES, NOW)).toBe(true)
    expect(matchesKpi(ok,   'temp_out', RANGES, NOW)).toBe(false)
    expect(matchesKpi(seco, 'temp_out', RANGES, NOW)).toBe(false)
  })
})

describe('deriveKpis', () => {
  it('cuenta cada excepción de forma independiente', () => {
    const trips = [
      makeTrip('a', { stops: [makeStop({ on_time_status: 'OFF TIME', temperature: 11 })] }),
      makeTrip('b', { status_reported_at: '2026-07-04 14:00:00' }),
      makeTrip('c'),
    ]
    const kpis = deriveKpis(trips, RANGES, NOW)
    expect(kpis).toEqual({ off_time: 1, stale: 1, temp_out: 1 })
  })
})
