import { describe, it, expect } from 'vitest'
import { deriveKpis, matchesKpi, DEFAULT_ALERT_RULES, isOpenTrip, dwellStatus } from './kpis'
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
    status_reported_at: null, current_status: 'RUTA', tractor_plate: 'ABCD12', tractor_plate_tms: null, trailer_plate: null,
    driver_name: 'Juan', driver_name_tms: null, driver_tax_id: null, driver_phone: null, carrier_name: null, carrier_name_tms: null,
    origin: null, cargo_type: 'FRIO', cargo_delivered: false, temp_status: null, stops: [], is_active: true, is_working: false, is_assigned: true,
    is_first_leg: false, manual_status: null, notes: null, comments: null, unassigned_reason_id: null,
    fleet_link_id: null, carrier_id: null, driver_id: null, tractor_asset_id: null, trailer_asset_id: null, manually_edited_fields: [], edited_at: null,
    edited_by: null, updated_at: null, created_at: null,
    source_system_trip_id: '1', milestone_status: null, pipeline_updated_at: null,
    ...overrides,
  }
}

const NOW = Date.parse('2026-07-04T18:00:00Z')
const RANGES: TemperatureRangeMeta[] = [{ cargo_type: 'FRIO', label: 'Frío', min_c: 2, max_c: 5 }]
const RULES = DEFAULT_ALERT_RULES // dwell_yellow_min: 60, dwell_orange_min: 90, dwell_red_min: 120

describe('isOpenTrip', () => {
  it('terminal statuses are not open', () => {
    expect(isOpenTrip(makeTrip('a', { current_status: 'CERRADO FINALIZADO' }))).toBe(false)
    expect(isOpenTrip(makeTrip('b', { current_status: 'CANCELADO' }))).toBe(false)
    expect(isOpenTrip(makeTrip('c', { current_status: 'RUTA' }))).toBe(true)
  })
})

describe('matchesKpi — alertas vigentes (2026-08-01: set reducido)', () => {
  it('stale: umbral configurable y excluye viajes cerrados', () => {
    const old    = makeTrip('a', { status_reported_at: '2026-07-04 15:00:00' }) // 3h antes
    const closed = makeTrip('b', { status_reported_at: '2026-07-04 10:00:00', current_status: 'CERRADO FINALIZADO' })
    expect(matchesKpi(old, 'stale', RANGES, RULES, NOW)).toBe(true)
    expect(matchesKpi(old, 'stale', RANGES, { ...RULES, stale_report_hours: 4 }, NOW)).toBe(false)
    expect(matchesKpi(closed, 'stale', RANGES, RULES, NOW)).toBe(false)
  })

  it('temp_out: fuera de rango configurado (temp_status ya viene clasificado del backend)', () => {
    const hot = makeTrip('a', { temp_status: 'out_of_range', stops: [makeStop({ temperature: 11, is_active: true })] })
    expect(matchesKpi(hot, 'temp_out', RANGES, RULES, NOW)).toBe(true)
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

describe('dwellStatus (Hito 14: semáforo de tiempo en el local activo)', () => {
  it('null cuando no hay parada activa', () => {
    const trip = makeTrip('a', { stops: [makeStop({ arrival_date: '2026-07-04 17:00:00' })] })
    expect(dwellStatus(trip, RULES, NOW)).toBeNull()
  })

  it('null cuando la parada activa todavía no llega (en ruta hacia ella)', () => {
    const trip = makeTrip('a', { stops: [makeStop({ is_active: true })] })
    expect(dwellStatus(trip, RULES, NOW)).toBeNull()
  })

  it('null cuando la parada activa ya salió (dato desactualizado, no debería pasar en la práctica)', () => {
    const trip = makeTrip('a', {
      stops: [makeStop({ is_active: true, arrival_date: '2026-07-04 15:00:00', departure_date: '2026-07-04 15:30:00' })],
    })
    expect(dwellStatus(trip, RULES, NOW)).toBeNull()
  })

  it('null cuando el viaje está cerrado', () => {
    const trip = makeTrip('a', {
      current_status: 'CERRADO FINALIZADO',
      stops: [makeStop({ is_active: true, arrival_date: '2026-07-04 15:00:00' })],
    })
    expect(dwellStatus(trip, RULES, NOW)).toBeNull()
  })

  it('verde: menos de dwell_yellow_min (60min) en la parada activa', () => {
    const trip = makeTrip('a', { stops: [makeStop({ is_active: true, arrival_date: '2026-07-04 17:30:00' })] }) // 30min
    expect(dwellStatus(trip, RULES, NOW)?.severity).toBe('green')
  })

  it('amarillo: entre dwell_yellow_min y dwell_orange_min', () => {
    const trip = makeTrip('a', { stops: [makeStop({ is_active: true, arrival_date: '2026-07-04 16:55:00' })] }) // 65min
    expect(dwellStatus(trip, RULES, NOW)?.severity).toBe('yellow')
  })

  it('naranja: entre dwell_orange_min y dwell_red_min', () => {
    const trip = makeTrip('a', { stops: [makeStop({ is_active: true, arrival_date: '2026-07-04 16:20:00' })] }) // 100min
    expect(dwellStatus(trip, RULES, NOW)?.severity).toBe('orange')
  })

  it('rojo: dwell_red_min (120min) o más', () => {
    const trip = makeTrip('a', { stops: [makeStop({ is_active: true, arrival_date: '2026-07-04 15:30:00' })] }) // 150min
    const status = dwellStatus(trip, RULES, NOW)
    expect(status?.severity).toBe('red')
    expect(status?.label).toContain('en local')
  })

  it('umbrales configurables: un dwell_red_min más alto puede bajar la severidad', () => {
    const trip = makeTrip('a', { stops: [makeStop({ is_active: true, arrival_date: '2026-07-04 15:30:00' })] }) // 150min
    expect(dwellStatus(trip, { ...RULES, dwell_red_min: 200 }, NOW)?.severity).toBe('orange')
  })

  it('FIX GPS-primero: usa gps_arrival_date por sobre arrival_date (TR), igual que el backend', () => {
    const trip = makeTrip('a', {
      stops: [makeStop({
        is_active: true,
        gps_arrival_date: '2026-07-04 15:30:00', // 150min → rojo
        arrival_date: '2026-07-04 17:45:00',      // 15min → hubiera dado verde si TR ganara
      })],
    })
    expect(dwellStatus(trip, RULES, NOW)?.severity).toBe('red')
  })

  // FIX 2026-08-02 (pedido explícito: "¿qué pasa con los que permanecen
  // mucho tiempo en el origen?"): el origen nunca tiene arrival_date, así
  // que antes esta función siempre devolvía null mientras is_active
  // apuntaba al origen — un camión parado horas sin salir no disparaba
  // ninguna alerta. Ahora usa planning_date como referencia, mismo
  // criterio que transitTime (stopStats.ts).
  describe('origen (is_active apunta al origen, sin salida real)', () => {
    it('usa planning_date como referencia cuando la parada activa es el origen', () => {
      const trip = makeTrip('a', {
        stops: [makeStop({ stop_type: 'ORIGIN', is_active: true, planning_date: '2026-07-04 15:30:00' })], // 150min
      })
      const status = dwellStatus(trip, RULES, NOW)
      expect(status?.severity).toBe('red')
      expect(status?.label).toContain('desde despacho')
    })

    it('null si el origen tampoco tiene planning_date', () => {
      const trip = makeTrip('a', {
        stops: [makeStop({ stop_type: 'ORIGIN', is_active: true })],
      })
      expect(dwellStatus(trip, RULES, NOW)).toBeNull()
    })

    it('verde cuando lleva poco tiempo desde el despacho planificado', () => {
      const trip = makeTrip('a', {
        stops: [makeStop({ stop_type: 'ORIGIN', is_active: true, planning_date: '2026-07-04 17:30:00' })], // 30min
      })
      expect(dwellStatus(trip, RULES, NOW)?.severity).toBe('green')
    })
  })
})

describe('matchesKpi — dwell_severity', () => {
  it('solo cuenta como alerta lo anómalo (amarillo/naranja/rojo), no verde', () => {
    const green = makeTrip('a', { stops: [makeStop({ is_active: true, arrival_date: '2026-07-04 17:50:00' })] }) // 10min
    const red   = makeTrip('b', { stops: [makeStop({ is_active: true, arrival_date: '2026-07-04 15:30:00' })] }) // 150min
    expect(matchesKpi(green, 'dwell_severity', RANGES, RULES, NOW)).toBe(false)
    expect(matchesKpi(red, 'dwell_severity', RANGES, RULES, NOW)).toBe(true)
  })
})

describe('deriveKpis', () => {
  it('cuenta las 4 excepciones vigentes de forma independiente', () => {
    const trips = [
      makeTrip('a', { temp_status: 'out_of_range', stops: [makeStop({ temperature: 11, is_active: true })] }),
      makeTrip('b', { status_reported_at: '2026-07-04 14:00:00' }),
      makeTrip('c', { fleet_match_status: 'UNMATCHED' }),
      makeTrip('d', { stops: [makeStop({ is_active: true, arrival_date: '2026-07-04 15:30:00' })] }), // 150min, rojo
      makeTrip('e'),
    ]
    const kpis = deriveKpis(trips, RANGES, RULES, NOW)
    expect(kpis.stale).toBe(1)
    expect(kpis.temp_out).toBe(1)
    expect(kpis.fleet_unmatched).toBe(1)
    expect(kpis.dwell_severity).toBe(1)
  })
})

/** "Fuera de rango" solo muestra los que ya fallaron. Para vigilar la cadena
 *  de frio hace falta ver TODOS los que la llevan. */
describe('temp_reported — los viajes que si reportan temperatura', () => {
  it('matchea cuando alguna parada trae temperatura, este o no en rango', () => {
    const trip = makeTrip('a', { temp_status: null, stops: [
      makeStop({ temperature: null }),
      makeStop({ temperature: -18 }),
    ] })
    expect(matchesKpi(trip, 'temp_reported', [])).toBe(true)
  })

  it('incluye los que estan FUERA de rango — no es lo contrario de temp_out', () => {
    const trip = makeTrip('a', { temp_status: 'out_of_range', stops: [makeStop({ temperature: 12 })] })
    expect(matchesKpi(trip, 'temp_reported', [])).toBe(true)
    expect(matchesKpi(trip, 'temp_out', [])).toBe(true)
  })

  it('no matchea cuando ninguna parada la reporta', () => {
    const trip = makeTrip('a', { temp_status: null, stops: [makeStop({ temperature: null })] })
    expect(matchesKpi(trip, 'temp_reported', [])).toBe(false)
  })
})

// ── "El TMS dejó de reportarlo" (Ronda 126) ──────────────────────────────────
// El booleano lo resuelve el backend (_tms_dropped, trips.py) porque el umbral
// vive en la base y la comparación necesita la última corrida de cada TMS. Acá
// se verifica que el KPI lo lee y que no lo confunde con `stale`, que es la
// señal contigua y mide otra cosa.
describe('kpi tms_dropped', () => {
  it('marca el viaje cuando el backend lo resolvió como dejado de reportar', () => {
    const t = makeTrip('a', { tms_dropped: true })
    expect(matchesKpi(t, 'tms_dropped', RANGES, RULES, NOW)).toBe(true)
  })

  it('no marca cuando el backend lo resolvió como false', () => {
    expect(matchesKpi(makeTrip('b', { tms_dropped: false }), 'tms_dropped', RANGES, RULES, NOW)).toBe(false)
  })

  it('no marca cuando el campo no viene (API vieja): se apaga, no se asume', () => {
    expect(matchesKpi(makeTrip('c'), 'tms_dropped', RANGES, RULES, NOW)).toBe(false)
  })

  it('es independiente de stale: un viaje puede estar dejado de reportar sin estar stale', () => {
    // status_reported_at recién ahora → stale = false. Pero el backend marcó
    // tms_dropped, que compara contra la última corrida de la TMS, no contra ahora.
    const t = makeTrip('d', { status_reported_at: '2026-07-04T18:00:00Z', tms_dropped: true })
    expect(matchesKpi(t, 'stale', RANGES, RULES, NOW)).toBe(false)
    expect(matchesKpi(t, 'tms_dropped', RANGES, RULES, NOW)).toBe(true)
  })

  it('deriveKpis lo cuenta como una señal más', () => {
    const trips = [makeTrip('a', { tms_dropped: true }), makeTrip('b', { tms_dropped: true }), makeTrip('c')]
    expect(deriveKpis(trips, RANGES, RULES, NOW).tms_dropped).toBe(2)
  })
})
