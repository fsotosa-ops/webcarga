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

  it('renders one dot per stop, titled with the stop name', () => {
    const stops = [
      makeStop({ stop_id: 'a', local: 'Parada A', on_time_status: 'ON TIME' }),
      makeStop({ stop_id: 'b', local: 'Parada B', on_time_status: 'OFF TIME' }),
      makeStop({ stop_id: 'c', local: 'Parada C' }),
    ]
    render(<StopProgressDots stops={stops} />)
    expect(screen.getByTitle('Parada A')).toBeInTheDocument()
    expect(screen.getByTitle('Parada B')).toBeInTheDocument()
    expect(screen.getByTitle('Parada C')).toBeInTheDocument()
  })

  it('colors ON TIME dots green and OFF TIME dots red', () => {
    const stops = [
      makeStop({ stop_id: 'a', local: 'Parada A', on_time_status: 'ON TIME' }),
      makeStop({ stop_id: 'b', local: 'Parada B', on_time_status: 'OFF TIME' }),
    ]
    render(<StopProgressDots stops={stops} />)
    expect(screen.getByTitle('Parada A')).toHaveClass('bg-green-500')
    expect(screen.getByTitle('Parada B')).toHaveClass('bg-red-500')
  })

  it('colors stops without on_time_status data gray', () => {
    const stops = [makeStop({ stop_id: 'a', local: 'Parada A' })]
    render(<StopProgressDots stops={stops} />)
    expect(screen.getByTitle('Parada A')).toHaveClass('bg-gray-200')
  })
})
