import { describe, it, expect } from 'vitest'
import { describeStopTiming, getActiveStop, getLatestTemp, getLatestTempStop } from './temperature'
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

function makeOrigin(overrides: Partial<TripStop>): TripStop {
  return makeStop({ stop_id: 'origin', stop_type: 'ORIGIN', ...overrides })
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

describe('getActiveStop', () => {
  // FIX 2026-08-01: "parada activa" pasó a calcularse en el backend
  // (_mark_active_stop, trips.py) — única fuente de verdad. Antes esta
  // función reimplementaba la regla acá (y, con reglas ligeramente
  // distintas, en StopTimeline.tsx) — bug real reportado en producción:
  // para QAnalytics/Sodimac (~90% de los viajes), que nunca reportan la
  // salida del origen, la parada activa quedaba pegada en el origen para
  // siempre (viaje 2021346, ver AGENTLOG). Ahora solo lee el flag.

  it('returns the stop flagged is_active by the backend', () => {
    const origin = makeOrigin({})
    const dest = makeStop({ stop_id: 'd1', local: 'Destino 1', is_active: true })
    expect(getActiveStop([origin, dest])?.stop_id).toBe('d1')
  })

  it('returns null when no stop is flagged active (trip not yet loaded / fully completed)', () => {
    const origin = makeOrigin({})
    const dest = makeStop({ stop_id: 'd1', local: 'Destino 1' })
    expect(getActiveStop([origin, dest])).toBeNull()
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

// 2026-08-07 (definición de negocio): hay TMS que solo reportan horas MEDIDAS
// (van a las columnas GPS), no declaradas por el transportista. IANSA es el
// caso: su Reporte Detalle es de cumplimiento. Sin fallback, una parada ya
// visitada mostraba "llega ~" con la hora planificada en vez de la real.
describe('describeStopTiming — fallback a horas GPS cuando no hay declaradas', () => {
  function stop(overrides: Partial<TripStop>): TripStop {
    return {
      stop_id: 's', local: 'L', planning_date: null, arrival_date: null,
      departure_date: null, departure_date_prog: null, unload_start: null,
      unload_end: null, gps_arrival_date: null, gps_departure_date: null,
      on_time_status: null, destination_city: null, destination_region: null,
      s2s: null, temperature: null, milestone_status: null, ...overrides,
    }
  }

  it('un destino con solo llegada GPS dice "llegó", no "llega ~"', () => {
    const s = stop({
      planning_date: '2026-08-01 00:37:00',
      gps_arrival_date: '2026-08-01 08:28:47',
    })
    const out = describeStopTiming(s)
    expect(out).toContain('llegó')
    expect(out).not.toContain('llega ~')
  })

  it('un destino con solo salida GPS dice "salió"', () => {
    const s = stop({
      gps_arrival_date: '2026-08-01 08:28:47',
      gps_departure_date: '2026-08-01 12:20:37',
    })
    expect(describeStopTiming(s)).toContain('salió')
  })

  it('la hora declarada por el transportista sigue teniendo precedencia', () => {
    // Se compara contra el render de "solo GPS" en vez de hardcodear una
    // hora: fmtShort convierte a hora de Chile, así que una constante acá
    // ataría el test al huso horario del entorno.
    const gps = '2026-08-01 08:28:47'
    const conDeclarada = describeStopTiming(stop({ arrival_date: '2026-08-01 09:00:00', gps_arrival_date: gps }))
    const soloGps      = describeStopTiming(stop({ gps_arrival_date: gps }))
    expect(conDeclarada).toContain('llegó')
    expect(soloGps).toContain('llegó')
    expect(conDeclarada).not.toEqual(soloGps)
  })

  it('un origen con solo salida GPS dice "salió"', () => {
    const s = stop({ stop_type: 'ORIGIN', gps_departure_date: '2026-07-31 21:00:00' })
    expect(describeStopTiming(s)).toContain('salió')
  })

  it('sin ninguna hora real, sigue cayendo a la planificada', () => {
    const s = stop({ planning_date: '2026-08-01 02:46:00' })
    expect(describeStopTiming(s)).toContain('llega ~')
  })
})
