import { describe, it, expect } from 'vitest'
import { describeStopTiming, getLatestTemp, getLatestTempStop } from './temperature'
import type { TripStop } from '@/lib/types'

function makeStop(overrides: Partial<TripStop>): TripStop {
  return {
    stop_id: 's1', local: 'Parada', planning_date: null,
    arrival_date: null, departure_date: null, departure_date_prog: null,
    unload_start: null, unload_end: null,
    gps_arrival_date: null, gps_departure_date: null, on_time_status: null,
    destination_city: null, destination_region: null, s2s: null,
    temperature: null, milestone_status: null,
    ...overrides,
  }
}

describe('describeStopTiming', () => {
  it('returns null when no timing field has data', () => {
    expect(describeStopTiming(makeStop({}))).toBeNull()
  })

  it('shows real arrival and real departure when both exist', () => {
    const stop = makeStop({ arrival_date: '2026-07-02 10:00:00', departure_date: '2026-07-02 11:00:00' })
    expect(describeStopTiming(stop)).toMatch(/^llegó \d{2}:\d{2} · salió \d{2}:\d{2}$/)
  })

  it('falls back to planned arrival (ETA) when there is no real arrival', () => {
    const stop = makeStop({ planning_date: '2026-07-02 08:00:00' })
    expect(describeStopTiming(stop)).toMatch(/^llega ~\d{2}:\d{2}$/)
  })

  it('falls back to planned departure when there is no real departure', () => {
    const stop = makeStop({ arrival_date: '2026-07-02 10:00:00', departure_date_prog: '2026-07-02 12:00:00' })
    expect(describeStopTiming(stop)).toMatch(/^llegó \d{2}:\d{2} · sale ~\d{2}:\d{2}$/)
  })

  it('prefers real departure over planned departure when both exist', () => {
    const stop = makeStop({
      arrival_date: '2026-07-02 10:00:00',
      departure_date: '2026-07-02 11:00:00',
      departure_date_prog: '2026-07-02 15:00:00',
    })
    const result = describeStopTiming(stop)
    expect(result).toMatch(/^llegó \d{2}:\d{2} · salió \d{2}:\d{2}$/)
    expect(result).not.toContain('~')
  })

  it('shows only the arrival segment when there is no departure data at all', () => {
    const stop = makeStop({ arrival_date: '2026-07-02 10:00:00' })
    expect(describeStopTiming(stop)).toMatch(/^llegó \d{2}:\d{2}$/)
  })
})

describe('getLatestTempStop', () => {
  it('returns the active stop when it has a temperature reading', () => {
    const active = makeStop({ stop_id: 'active', arrival_date: '2026-07-28 10:00:00', temperature: 3 })
    expect(getLatestTempStop([active])?.stop_id).toBe('active')
  })

  it('falls back to the most recently visited stop with a reading', () => {
    const noTemp = makeStop({ stop_id: 'current', arrival_date: '2026-07-28 12:00:00', temperature: null })
    const visited = makeStop({ stop_id: 'visited', arrival_date: '2026-07-28 09:00:00', departure_date: '2026-07-28 10:00:00', temperature: 4 })
    expect(getLatestTempStop([visited, noTemp])?.stop_id).toBe('visited')
  })

  it('returns null when no stop has a temperature reading', () => {
    expect(getLatestTempStop([makeStop({ arrival_date: '2026-07-28 10:00:00' })])).toBeNull()
  })

  it('getLatestTemp still returns the same value as before the refactor', () => {
    const stop = makeStop({ arrival_date: '2026-07-28 10:00:00', temperature: 3 })
    expect(getLatestTemp([stop])).toBe(3)
  })
})
