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
    status_reported_at: null, current_status: currentStatus, tractor_plate: id.toUpperCase(), tractor_plate_tms: null, trailer_plate: null,
    driver_name: 'Conductor', driver_name_tms: null, driver_tax_id: null, driver_phone: null, carrier_name: null, carrier_name_tms: null,
    origin: null, cargo_type: null, stops: [], is_active: true, is_working: false, is_assigned: true,
    is_first_leg: false, manual_status: null, notes: null, comments: null, unassigned_reason_id: null,
    fleet_link_id: null, carrier_id: null, driver_id: null, tractor_asset_id: null, trailer_asset_id: null, manually_edited_fields: [], edited_at: null,
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

  it('folds unmatched trips into an existing "otro" group instead of rendering a duplicate column', () => {
    const groupsWithOtro = [
      { id: 'en_ruta', label: 'En Ruta', statuses: ['ORIGEN', 'RUTA'] },
      { id: 'otro', label: 'Otro', statuses: ['SIN_INFO'] },
    ]
    const trips = [makeTrip('a', 'ESTADO_DESCONOCIDO')]
    render(<TripBoard trips={trips} groups={groupsWithOtro} meta={null} onSaved={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getAllByText('Otro').length).toBe(1)
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('buckets a manual override (estado operacional) into its group instead of Otro', () => {
    const meta = {
      statuses: [{ id: 'ORIGEN', label: 'ORIGEN', bg_color: '#fff', text_color: '#000', group: 'en_ruta' }],
      operational_states: [{ id: 'op-uuid-1', label: 'En panne confirmada', bg_color: '#fee', text_color: '#b00', group: 'problema' }],
      tms_sources: [], alert_thresholds: [], csv_columns: [], temperature_ranges: [], unassigned_reasons: [], operation_types: [],
    }
    const trip = { ...makeTrip('a', 'ORIGEN'), manual_status: 'op-uuid-1' }
    render(<TripBoard trips={[trip]} groups={groups} meta={meta} onSaved={vi.fn()} onSelect={vi.fn()} />)
    // cae en Problema (grupo del estado operacional), no en la columna sintética Otro
    expect(screen.queryByText('Otro')).not.toBeInTheDocument()
    expect(screen.getByText('A')).toBeInTheDocument()
  })
})
