import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TripTable } from './TripTable'
import type { Trip } from '@/lib/types'

vi.mock('@/lib/api/trips', () => ({
  tripsApi: { patch: vi.fn().mockResolvedValue({}) },
}))

function makeTrip(id: string, overrides: Partial<Trip> = {}): Trip {
  return {
    id, source_system: 'qanalytics', client_name: 'walmart', planning_date: '2026-07-02',
    status_reported_at: null, current_status: 'ORIGEN', tractor_plate: 'ABCD12', trailer_plate: null,
    driver_name: 'Juan Perez', driver_rut: null, driver_phone: null, transporter: null, transporter_tms: null,
    origin: 'CD Quilicura', cargo_type: 'FRIO', stops: [], activo: true, trabajando: false, asignado: true,
    primera_vuelta: false, estado_manual: null, observaciones: null, comentarios: null,
    fleet_link_id: null, transporter_profile_id: null, manually_edited_fields: [], edited_at: null,
    edited_by: null, updated_at: null, created_at: null,
    source_system_trip_id: '2000711', milestone_status: null, pipeline_updated_at: null,
    ...overrides,
  }
}

describe('TripTable', () => {
  it('renders an "Indicadores" column with clickable dots for a manual trip', () => {
    render(<TripTable trips={[makeTrip('t1', { source_system: 'manual' })]} selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getAllByTitle('Activo').length).toBeGreaterThan(0)
  })

  it('does not render Indicadores for a TMS-sourced trip', () => {
    render(<TripTable trips={[makeTrip('t1', { source_system: 'qanalytics' })]} selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.queryByTitle('Activo')).not.toBeInTheDocument()
  })

  it('calls onSelect directly when a row is clicked (no intermediate expand step)', () => {
    const onSelect = vi.fn()
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={onSelect} onSaved={vi.fn()} meta={null} />)
    fireEvent.click(screen.getAllByText('ABCD12')[0])
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }))
  })

  it('clicking an indicator dot does not call onSelect', () => {
    const onSelect = vi.fn()
    render(<TripTable trips={[makeTrip('t1', { source_system: 'manual' })]} selectedId={null} onSelect={onSelect} onSaved={vi.fn()} meta={null} />)
    fireEvent.click(screen.getAllByTitle('Activo')[0])
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('shows an OFF TIME compliance badge when a stop is off time', () => {
    const stops: Trip['stops'] = [{
      stop_id: 's1', local: 'Parada 1', planning_date: null, arrival_date: null, departure_date: null,
      departure_date_prog: null, unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
      on_time_status: 'OFF TIME', destination_city: null, destination_region: null, s2s: null,
      temperature: null, milestone_status: null,
    }]
    render(<TripTable trips={[makeTrip('t1', { stops })]} selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getAllByText(/OFF TIME/).length).toBeGreaterThan(0)
  })

  it('does not show a compliance badge when no stop has on_time_status data', () => {
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.queryByText(/OFF TIME/)).not.toBeInTheDocument()
  })

  it('shows the ETA of the active stop next to the status', () => {
    const stops: Trip['stops'] = [{
      stop_id: 's1', local: 'Parada 1', planning_date: '2026-07-02 09:00:00', arrival_date: null, departure_date: null,
      departure_date_prog: null, unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
      on_time_status: null, destination_city: null, destination_region: null, s2s: null,
      temperature: null, milestone_status: null,
    }]
    render(<TripTable trips={[makeTrip('t1', { stops })]} selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getAllByText(/llega ~\d{2}:\d{2}/).length).toBeGreaterThan(0)
  })

  it('shows time since the last TMS report next to the status', () => {
    const trip = makeTrip('t1', { status_reported_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() })
    render(<TripTable trips={[trip]} selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getAllByText(/hace 5 min/).length).toBeGreaterThan(0)
  })
})
