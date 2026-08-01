import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StopProgressDots } from './StopProgressDots'
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

describe('StopProgressDots', () => {
  it('renders nothing for an empty stop list', () => {
    const { container } = render(<StopProgressDots stops={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders one dot per destination stop, titled with the stop name', () => {
    const stops = [
      makeStop({ stop_id: 'a', local: 'Parada A', is_active: true }),
      makeStop({ stop_id: 'b', local: 'Parada B' }),
      makeStop({ stop_id: 'c', local: 'Parada C' }),
    ]
    render(<StopProgressDots stops={stops} />)
    expect(screen.getByTitle('Parada A')).toBeInTheDocument()
    expect(screen.getByTitle('Parada B')).toBeInTheDocument()
    expect(screen.getByTitle('Parada C')).toBeInTheDocument()
  })

  it('filters out the ORIGIN stop — only destinations get a dot', () => {
    const stops = [
      makeStop({ stop_id: 'o', local: 'Origen', stop_type: 'ORIGIN' }),
      makeStop({ stop_id: 'a', local: 'Parada A', is_active: true }),
    ]
    render(<StopProgressDots stops={stops} />)
    expect(screen.queryByTitle('Origen')).not.toBeInTheDocument()
    expect(screen.getByTitle('Parada A')).toBeInTheDocument()
  })

  it('colors done stops green, the active stop with an accent ring, and pending gray (hito 13, mismo lenguaje que StopTimeline)', () => {
    const stops = [
      makeStop({ stop_id: 'a', local: 'Parada A', arrival_date: '2026-07-04 10:00:00', departure_date: '2026-07-04 10:30:00' }),
      makeStop({ stop_id: 'b', local: 'Parada B', is_active: true }),
      makeStop({ stop_id: 'c', local: 'Parada C' }),
    ]
    render(<StopProgressDots stops={stops} />)
    expect(screen.getByTitle('Parada A')).toHaveClass('bg-green-500')
    expect(screen.getByTitle('Parada B')).toHaveClass('border-accent')
    expect(screen.getByTitle('Parada C')).toHaveClass('bg-gray-200')
  })
})
