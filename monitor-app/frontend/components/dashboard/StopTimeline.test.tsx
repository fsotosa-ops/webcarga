import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StopTimeline } from './StopTimeline'
import type { TripStop } from '@/lib/types'

function makeStop(overrides: Partial<TripStop>): TripStop {
  return {
    stop_id: 's1', local: 'Parada Test', planning_date: null,
    arrival_date: null, departure_date: null, departure_date_prog: null,
    unload_start: null, unload_end: null,
    gps_arrival_date: null, gps_departure_date: null, on_time_status: null,
    destination_city: null, destination_region: null, s2s: null,
    temperature: null, milestone_status: null,
    ...overrides,
  }
}

describe('StopTimeline', () => {
  it('returns nothing when there are no stops', () => {
    const { container } = render(<StopTimeline stops={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders one row per stop with its name', () => {
    const stops = [
      makeStop({ stop_id: 'a', local: 'Parada A', arrival_date: '2026-07-02 10:00:00', departure_date: '2026-07-02 11:00:00' }),
      makeStop({ stop_id: 'b', local: 'Parada B' }),
    ]
    render(<StopTimeline stops={stops} />)
    expect(screen.getByText('Parada A')).toBeInTheDocument()
    expect(screen.getByText('Parada B')).toBeInTheDocument()
  })

  it('marks the stop flagged is_active by the backend as active, the ones before it as done, the ones after as pending', () => {
    const stops = [
      makeStop({ stop_id: 'a', local: 'Hecha', arrival_date: '2026-07-02 10:00:00' }),
      makeStop({ stop_id: 'b', local: 'Activa', is_active: true }),
      makeStop({ stop_id: 'c', local: 'Pendiente' }),
    ]
    render(<StopTimeline stops={stops} />)
    // el estado "done" se señala con el ícono Check (lucide), no con el carácter ✓
    expect(screen.getByText(/llegó/)).toBeInTheDocument()
    expect(screen.getByText('en camino')).toBeInTheDocument()
    expect(screen.getByText('pendiente')).toBeInTheDocument()
  })

  it('never badges ON TIME/OFF TIME (2026-08-01: concepto retirado de toda la app)', () => {
    const stops = [makeStop({ stop_id: 'a', local: 'Parada A', on_time_status: 'ON TIME' })]
    render(<StopTimeline stops={stops} />)
    expect(screen.queryByText('ON TIME')).not.toBeInTheDocument()
    expect(screen.queryByText('OFF TIME')).not.toBeInTheDocument()
  })

  it('shows the milestone_status badge when present', () => {
    const stops = [makeStop({ stop_id: 'a', local: 'Parada A', milestone_status: 'CERRADO SAP' })]
    render(<StopTimeline stops={stops} />)
    expect(screen.getByText('CERRADO SAP')).toBeInTheDocument()
  })

  it('shows the planned arrival (ETA) for a pending stop when planning_date is present', () => {
    const stops = [
      makeStop({ stop_id: 'a', local: 'Hecha', arrival_date: '2026-07-02 10:00:00' }),
      makeStop({ stop_id: 'b', local: 'Con ETA', planning_date: '2026-07-02 14:00:00' }),
    ]
    render(<StopTimeline stops={stops} />)
    expect(screen.getByText(/llega ~\d{2}:\d{2}/)).toBeInTheDocument()
  })

  it('shows the planned arrival (ETA) for the active stop when planning_date is present', () => {
    const stops = [makeStop({ stop_id: 'a', local: 'Activa', planning_date: '2026-07-02 09:00:00', is_active: true })]
    render(<StopTimeline stops={stops} />)
    expect(screen.getByText(/llega ~\d{2}:\d{2}/)).toBeInTheDocument()
    expect(screen.queryByText('en camino')).not.toBeInTheDocument()
  })

  it('shows the planned departure for a completed stop when there is no real departure yet', () => {
    const stops = [makeStop({ stop_id: 'a', local: 'Parada', arrival_date: '2026-07-02 10:00:00', departure_date_prog: '2026-07-02 12:00:00' })]
    render(<StopTimeline stops={stops} />)
    expect(screen.getByText(/sale ~\d{2}:\d{2}/)).toBeInTheDocument()
  })

  it('still falls back to "pendiente" when a pending stop has no timing data at all', () => {
    const stops = [
      makeStop({ stop_id: 'a', local: 'Hecha', arrival_date: '2026-07-02 10:00:00' }),
      makeStop({ stop_id: 'b', local: 'Activa', is_active: true }),
      makeStop({ stop_id: 'c', local: 'Sin datos' }),
    ]
    render(<StopTimeline stops={stops} />)
    expect(screen.getByText('pendiente')).toBeInTheDocument()
  })

  it('shows "completada" instead of the contradictory "pendiente" for a done stop with no timing data', () => {
    // "done" acá es puramente posicional (antes de is_active) — no depende
    // de que la propia parada tenga arrival_date ni ningún otro campo.
    const stops = [
      makeStop({ stop_id: 'a', local: 'Sin fechas' }),
      makeStop({ stop_id: 'b', local: 'Activa', is_active: true }),
    ]
    render(<StopTimeline stops={stops} />)
    expect(screen.getByText(/completada/)).toBeInTheDocument()
  })

  // FIX 2026-08-01: "quién está activo" pasó a ser una decisión 100% del
  // backend (_mark_active_stop, trips.py) — este componente solo pinta el
  // pulsing dot en la parada que venga con is_active=true, sin importar si
  // es el origen o un destino, ni qué campos de fecha tenga. El bug real
  // (pelotita pegada en el origen para QAnalytics/Sodimac) se prueba del
  // lado del backend ahora — ver test_trip_hybrid_fields.py.
  it('renders the pulsing dot on whichever stop the backend flags is_active, even if it is the origin', () => {
    const stops = [
      makeStop({ stop_id: 'origin', stop_type: 'ORIGIN', local: 'CD Origen', is_active: true }),
      makeStop({ stop_id: 'd1', local: 'Destino 1' }),
    ]
    render(<StopTimeline stops={stops} />)
    const originRow = screen.getByText('CD Origen').closest('.relative')
    const destRow = screen.getByText('Destino 1').closest('.relative')
    expect(originRow?.querySelector('.animate-pulse')).not.toBeNull()
    expect(destRow?.querySelector('.animate-pulse')).toBeNull()
  })

  it('renders the pulsing dot on a destination when the backend flags it active instead of the origin', () => {
    const stops = [
      makeStop({ stop_id: 'origin', stop_type: 'ORIGIN', local: 'CD Origen' }),
      makeStop({ stop_id: 'd1', local: 'Destino activo', is_active: true }),
    ]
    render(<StopTimeline stops={stops} />)
    const originRow = screen.getByText('CD Origen').closest('.relative')
    const destRow = screen.getByText('Destino activo').closest('.relative')
    expect(originRow?.querySelector('.animate-pulse')).toBeNull()
    expect(destRow?.querySelector('.animate-pulse')).not.toBeNull()
  })
})
