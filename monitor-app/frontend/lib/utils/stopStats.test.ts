import { describe, it, expect } from 'vitest'
import { stopDwellTime, transitTime, formatDurationMinutes } from './stopStats'
import type { TripStop } from '@/lib/types'

function makeStop(overrides: Partial<TripStop> = {}): TripStop {
  return {
    stop_id: 's1', local: 'Parada', planning_date: null, arrival_date: null, departure_date: null,
    departure_date_prog: null, unload_start: null, unload_end: null, gps_arrival_date: null,
    gps_departure_date: null, on_time_status: null, destination_city: null, destination_region: null,
    s2s: null, temperature: null, milestone_status: null,
    ...overrides,
  }
}

describe('formatDurationMinutes', () => {
  it('formats minutes and hours', () => {
    expect(formatDurationMinutes(0.4)).toBe('<1 min')
    expect(formatDurationMinutes(45)).toBe('45 min')
    expect(formatDurationMinutes(90)).toBe('1h 30m')
    expect(formatDurationMinutes(120)).toBe('2h')
  })
})

describe('stopDwellTime', () => {
  it('computes arrival→departure duration', () => {
    const s = makeStop({ arrival_date: '2026-07-05 10:00:00', departure_date: '2026-07-05 10:45:00' })
    expect(stopDwellTime(s)).toBe('45 min')
  })

  it('falls back to GPS timestamps', () => {
    const s = makeStop({ gps_arrival_date: '2026-07-05 10:00:00', gps_departure_date: '2026-07-05 12:30:00' })
    expect(stopDwellTime(s)).toBe('2h 30m')
  })

  it('returns null when data is missing or inconsistent', () => {
    expect(stopDwellTime(makeStop())).toBeNull()
    expect(stopDwellTime(makeStop({ arrival_date: '2026-07-05 10:00:00' }))).toBeNull()
    expect(stopDwellTime(makeStop({ arrival_date: '2026-07-05 11:00:00', departure_date: '2026-07-05 10:00:00' }))).toBeNull()
  })
})

describe('transitTime', () => {
  it('computes departure→next arrival duration', () => {
    const a = makeStop({ departure_date: '2026-07-05 10:00:00' })
    const b = makeStop({ arrival_date: '2026-07-05 11:15:00' })
    expect(transitTime(a, b)).toBe('1h 15m')
  })

  it('returns null when either end is missing', () => {
    expect(transitTime(makeStop(), makeStop({ arrival_date: '2026-07-05 11:00:00' }))).toBeNull()
  })
})
