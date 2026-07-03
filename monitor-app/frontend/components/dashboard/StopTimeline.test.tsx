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

  it('marks the first stop without arrival_date/gps_arrival_date/on_time_status as active, the rest before it as done, the rest after as pending', () => {
    const stops = [
      makeStop({ stop_id: 'a', local: 'Hecha', arrival_date: '2026-07-02 10:00:00' }),
      makeStop({ stop_id: 'b', local: 'Activa' }),
      makeStop({ stop_id: 'c', local: 'Pendiente' }),
    ]
    render(<StopTimeline stops={stops} />)
    expect(screen.getByText(/✓ llegó/)).toBeInTheDocument()
    expect(screen.getByText('en camino')).toBeInTheDocument()
    expect(screen.getByText('pendiente')).toBeInTheDocument()
  })

  it('shows an ON TIME badge for a stop with on_time_status ON TIME', () => {
    const stops = [makeStop({ stop_id: 'a', local: 'Parada A', on_time_status: 'ON TIME' })]
    render(<StopTimeline stops={stops} />)
    expect(screen.getByText('ON TIME')).toBeInTheDocument()
  })

  it('shows an OFF TIME badge for a stop with on_time_status OFF TIME', () => {
    const stops = [makeStop({ stop_id: 'a', local: 'Parada A', on_time_status: 'OFF TIME' })]
    render(<StopTimeline stops={stops} />)
    expect(screen.getByText('OFF TIME')).toBeInTheDocument()
  })

  it('shows the milestone_status badge when present', () => {
    const stops = [makeStop({ stop_id: 'a', local: 'Parada A', milestone_status: 'CERRADO SAP' })]
    render(<StopTimeline stops={stops} />)
    expect(screen.getByText('CERRADO SAP')).toBeInTheDocument()
  })
})
