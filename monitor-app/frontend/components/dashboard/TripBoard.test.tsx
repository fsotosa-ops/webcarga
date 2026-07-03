import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TripBoard } from './TripBoard'
import type { Trip } from '@/lib/types'

vi.mock('@/lib/api/trips', () => ({
  tripsApi: { patch: vi.fn().mockResolvedValue({}) },
}))

function makeTrip(id: string, currentStatus: string): Trip {
  return {
    id, source_system: 'qanalytics', client_name: 'walmart', planning_date: '2026-07-02',
    status_reported_at: null, current_status: currentStatus, tractor_plate: id.toUpperCase(), trailer_plate: null,
    driver_name: 'Conductor', driver_rut: null, driver_phone: null, transporter: null, transporter_tms: null,
    origin: null, cargo_type: null, stops: [], activo: true, trabajando: false, asignado: true,
    primera_vuelta: false, estado_manual: null, observaciones: null, comentarios: null,
    fleet_link_id: null, transporter_profile_id: null, manually_edited_fields: [], edited_at: null,
    edited_by: null, updated_at: null, created_at: null,
    source_system_trip_id: null, milestone_status: null, pipeline_updated_at: null,
  }
}

const groups = [
  { id: 'en_ruta', label: 'En Ruta', statuses: ['ORIGEN', 'RUTA'] },
  { id: 'problema', label: 'Problema', statuses: ['CANCELADO'] },
]

describe('TripBoard', () => {
  it('groups trips into the matching column by current_status', () => {
    const trips = [makeTrip('a', 'ORIGEN'), makeTrip('b', 'CANCELADO')]
    render(<TripBoard trips={trips} groups={groups} meta={null} onSaved={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText('En Ruta')).toBeInTheDocument()
    expect(screen.getByText('Problema')).toBeInTheDocument()
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
  })

  it('shows an empty-state message for a column with no trips', () => {
    render(<TripBoard trips={[]} groups={groups} meta={null} onSaved={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getAllByText('Sin viajes').length).toBe(groups.length)
  })

  it('buckets trips whose status matches no group into an "Otro" column', () => {
    const trips = [makeTrip('a', 'ESTADO_DESCONOCIDO')]
    render(<TripBoard trips={trips} groups={groups} meta={null} onSaved={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByText('Otro')).toBeInTheDocument()
    expect(screen.getByText('A')).toBeInTheDocument()
  })
})
