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
  it('computes departure→next arrival duration, labeled "de tránsito" (ambos extremos confirmados)', () => {
    const a = makeStop({ departure_date: '2026-07-05 10:00:00' })
    const b = makeStop({ arrival_date: '2026-07-05 11:15:00' })
    expect(transitTime(a, b)).toBe('1h 15m de tránsito')
  })

  it('returns null when either end is missing', () => {
    expect(transitTime(makeStop(), makeStop({ arrival_date: '2026-07-05 11:00:00' }))).toBeNull()
  })

  // Caso real 2026-08-02: QAnalytics/Sodimac nunca reportan la salida real
  // del origen (100% de los viajes abiertos con 2+ destinos, confirmado
  // contra datos reales) — el tramo origen→primer destino quedaba siempre
  // sin tiempo de tránsito, aunque el resto de los tramos (entre destinos)
  // sí lo mostraran. `planning_date` de QAnalytics es la hora en que el
  // vehículo ya está dispuesto para salir (aclarado por el usuario) — no
  // confirma que efectivamente salió, por eso el label nunca dice "de
  // tránsito" para este tramo, siempre "desde despacho": en vivo contra
  // "now" (con "~") mientras el destino no llega, congelado (sin "~", pero
  // sigue diciendo "desde despacho") apenas hay llegada real.
  describe('tramo origen→primer destino sin salida real (usa planning_date)', () => {
    it('usa planning_date del origen como salida cuando no hay departure_date/gps_departure_date', () => {
      const origin = makeStop({ stop_type: 'ORIGIN', planning_date: '2026-08-01 04:46:00' })
      const dest = makeStop({ gps_arrival_date: '2026-08-01 12:51:00' })
      expect(transitTime(origin, dest)).toBe('8h 5m desde despacho')
    })

    it('calcula en vivo contra "now" mientras el destino todavía no llega, marcado con "~" (estimado)', () => {
      const origin = makeStop({ stop_type: 'ORIGIN', planning_date: '2026-08-01 04:46:00' })
      const dest = makeStop() // sin llegada todavía
      const now = Date.parse('2026-08-01T07:46:00Z')
      expect(transitTime(origin, dest, now)).toBe('~3h desde despacho')
    })

    it('se congela contra la llegada real apenas existe (sin "~", pero sigue diciendo "desde despacho", no "de tránsito")', () => {
      const origin = makeStop({ stop_type: 'ORIGIN', planning_date: '2026-08-01 04:46:00' })
      const dest = makeStop({ gps_arrival_date: '2026-08-01 06:46:00' })
      const now = Date.parse('2026-08-01T09:00:00Z') // mucho más tarde que la llegada real
      expect(transitTime(origin, dest, now)).toBe('2h desde despacho')
    })

    it('null si el origen tampoco tiene planning_date (sin ningún dato de salida)', () => {
      const origin = makeStop({ stop_type: 'ORIGIN' })
      const dest = makeStop({ gps_arrival_date: '2026-08-01 12:51:00' })
      expect(transitTime(origin, dest)).toBeNull()
    })

    it('no aplica el fallback "now" a tramos que no salen del origen (comportamiento existente sin cambios)', () => {
      const a = makeStop({ local: 'Destino A' }) // no ORIGIN, sin salida real
      const b = makeStop({ local: 'Destino B' }) // sin llegada todavía
      expect(transitTime(a, b, Date.now())).toBeNull()
    })
  })
})
