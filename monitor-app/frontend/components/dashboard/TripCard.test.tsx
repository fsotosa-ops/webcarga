import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TripCard } from './TripCard'
import type { Trip } from '@/lib/types'

vi.mock('@/lib/api/trips', () => ({
  tripsApi: { patch: vi.fn().mockResolvedValue({}) },
}))

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 't1', source_system: 'qanalytics', client_name: 'walmart', planning_date: '2026-07-02',
    status_reported_at: null, current_status: 'ORIGEN', tractor_plate: 'DRZT17', trailer_plate: null,
    driver_name: 'Navarro Piñango', driver_rut: null, driver_phone: null, transporter: null, transporter_tms: null,
    origin: 'CD Quilicura', cargo_type: 'FRIO', stops: [], activo: true, trabajando: false, asignado: true,
    primera_vuelta: false, estado_manual: null, observaciones: null, comentarios: null,
    fleet_link_id: null, transporter_profile_id: null, manually_edited_fields: [], edited_at: null,
    edited_by: null, updated_at: null, created_at: null,
    source_system_trip_id: '2000711', milestone_status: null, pipeline_updated_at: null,
    ...overrides,
  }
}

describe('TripCard', () => {
  it('renders the plate and driver name', () => {
    render(<TripCard trip={makeTrip()} meta={null} onSaved={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText('DRZT17')).toBeInTheDocument()
    expect(screen.getByText('Navarro Piñango')).toBeInTheDocument()
  })

  it('calls onSelect when the card is clicked', () => {
    const onSelect = vi.fn()
    render(<TripCard trip={makeTrip()} meta={null} onSaved={vi.fn()} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('DRZT17'))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }))
  })

  it('renders Indicadores for a manual trip and clicking a dot does not call onSelect', () => {
    const onSelect = vi.fn()
    render(<TripCard trip={makeTrip({ source_system: 'manual' })} meta={null} onSaved={vi.fn()} onSelect={onSelect} />)
    fireEvent.click(screen.getAllByTitle('Activo')[0])
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('also renders Indicadores for a TMS-sourced trip', () => {
    render(<TripCard trip={makeTrip({ source_system: 'qanalytics' })} meta={null} onSaved={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getAllByTitle('Activo').length).toBeGreaterThan(0)
  })

  it('shows an OFF TIME badge when the trip has a compliance problem', () => {
    const stops: Trip['stops'] = [{
      stop_id: 's1', local: 'Parada 1', planning_date: null, arrival_date: null, departure_date: null,
      departure_date_prog: null, unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
      on_time_status: 'OFF TIME', destination_city: null, destination_region: null, s2s: null,
      temperature: null, milestone_status: null,
    }]
    render(<TripCard trip={makeTrip({ stops })} meta={null} onSaved={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText('OFF TIME')).toBeInTheDocument()
  })

  it('does not show an OFF TIME badge when there is no compliance problem', () => {
    render(<TripCard trip={makeTrip()} meta={null} onSaved={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.queryByText('OFF TIME')).not.toBeInTheDocument()
  })

  it('shows a TMS chip and the client name', () => {
    render(<TripCard trip={makeTrip()} meta={null} onSaved={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText('QAN')).toBeInTheDocument()
    expect(screen.getByText(/walmart/)).toBeInTheDocument()
  })

  it('shows the ETA of the active stop', () => {
    const stops: Trip['stops'] = [{
      stop_id: 's1', local: 'Parada 1', planning_date: '2026-07-02 09:00:00', arrival_date: null, departure_date: null,
      departure_date_prog: null, unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
      on_time_status: null, destination_city: null, destination_region: null, s2s: null,
      temperature: null, milestone_status: null,
    }]
    render(<TripCard trip={makeTrip({ stops })} meta={null} onSaved={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText(/llega ~\d{2}:\d{2}/)).toBeInTheDocument()
  })

  it('shows time since the last TMS report', () => {
    const trip = makeTrip({ status_reported_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() })
    render(<TripCard trip={trip} meta={null} onSaved={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText(/hace 5 min/)).toBeInTheDocument()
  })
})
