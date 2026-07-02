import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TripRowExpanded } from './TripRowExpanded'
import type { Trip } from '@/lib/types'

const baseTrip: Trip = {
  id: 't1', source_system: 'qanalytics', client_name: null, planning_date: null,
  status_reported_at: null, current_status: null, tractor_plate: null, trailer_plate: null,
  driver_name: null, driver_rut: null, driver_phone: null, transporter: null, transporter_tms: null,
  origin: null, cargo_type: 'FRIO',
  stops: [{
    stop_id: 's1', local: 'Parada 1', planning_date: null, arrival_date: null, departure_date: null,
    unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
    on_time_status: null, destination_city: null, destination_region: null, s2s: null,
    temperature: 11, milestone_status: null,
  }],
  activo: true, trabajando: false, asignado: true, primera_vuelta: false,
  estado_manual: null, observaciones: null, comentarios: null,
  fleet_link_id: null, transporter_profile_id: null, manually_edited_fields: [], edited_at: null,
  edited_by: null, created_at: null,
  updated_at: null, source_system_trip_id: null, milestone_status: null, pipeline_updated_at: null,
}

describe('TripRowExpanded', () => {
  it('shows the latest temperature reading', () => {
    render(<TripRowExpanded trip={baseTrip} meta={null} onSaved={vi.fn()} onOpenFull={vi.fn()} />)
    expect(screen.getByText('11°C')).toBeInTheDocument()
  })

  it('renders the stop timeline', () => {
    render(<TripRowExpanded trip={baseTrip} meta={null} onSaved={vi.fn()} onOpenFull={vi.fn()} />)
    expect(screen.getByText('Parada 1')).toBeInTheDocument()
  })

  it('renders the indicator dots', () => {
    render(<TripRowExpanded trip={baseTrip} meta={null} onSaved={vi.fn()} onOpenFull={vi.fn()} />)
    expect(screen.getByTitle('Activo')).toBeInTheDocument()
    expect(screen.getByTitle('Asignado')).toBeInTheDocument()
  })

  it('calls onOpenFull when "Ver ficha completa" is clicked, without bubbling to a parent onClick', () => {
    const onOpenFull = vi.fn()
    const parentClick = vi.fn()
    render(
      <div onClick={parentClick}>
        <TripRowExpanded trip={baseTrip} meta={null} onSaved={vi.fn()} onOpenFull={onOpenFull} />
      </div>
    )
    fireEvent.click(screen.getByText(/Ver ficha completa/))
    expect(onOpenFull).toHaveBeenCalledTimes(1)
    expect(parentClick).not.toHaveBeenCalled()
  })
})
