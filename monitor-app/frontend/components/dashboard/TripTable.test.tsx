import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TripTable } from './TripTable'
import type { Trip } from '@/lib/types'

vi.mock('@/lib/api/trips', () => ({
  tripsApi: { patch: vi.fn().mockResolvedValue({}) },
}))

function makeTrip(id: string): Trip {
  return {
    id, source_system: 'qanalytics', client_name: 'walmart', planning_date: '2026-07-02',
    status_reported_at: null, current_status: 'ORIGEN', tractor_plate: 'ABCD12', trailer_plate: null,
    driver_name: 'Juan Perez', driver_rut: null, driver_phone: null, transporter: null, transporter_tms: null,
    origin: 'CD Quilicura', cargo_type: 'FRIO', stops: [], activo: true, trabajando: false, asignado: true,
    primera_vuelta: false, estado_manual: null, observaciones: null, comentarios: null,
    fleet_link_id: null, transporter_profile_id: null, manually_edited_fields: [], edited_at: null,
    edited_by: null, created_at: null,
    updated_at: null, source_system_trip_id: '2000711', milestone_status: null, pipeline_updated_at: null,
  }
}

describe('TripTable — expand/collapse', () => {
  it('renders no expanded content by default', () => {
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.queryByText(/Ver ficha completa/)).not.toBeInTheDocument()
  })

  it('clicking a row expands it, showing the indicators and the "ver ficha completa" link', () => {
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={null} />)
    fireEvent.click(screen.getAllByText('ABCD12')[0])
    expect(screen.getAllByText(/Ver ficha completa/).length).toBeGreaterThan(0)
  })

  it('clicking the same row again collapses it', () => {
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={null} />)
    const plate = screen.getAllByText('ABCD12')[0]
    fireEvent.click(plate)
    expect(screen.getAllByText(/Ver ficha completa/).length).toBeGreaterThan(0)
    fireEvent.click(plate)
    expect(screen.queryByText(/Ver ficha completa/)).not.toBeInTheDocument()
  })

  it('calls onSelect only when "Ver ficha completa" is clicked, not when the row is clicked', () => {
    const onSelect = vi.fn()
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={onSelect} onSaved={vi.fn()} meta={null} />)
    fireEvent.click(screen.getAllByText('ABCD12')[0])
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByText(/Ver ficha completa/)[0])
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }))
  })

  it('renders an "Indicadores" column with clickable dots for each trip row', () => {
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getAllByTitle('Activo').length).toBeGreaterThan(0)
  })
})
