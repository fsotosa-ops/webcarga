import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TripSlideOver } from './TripSlideOver'
import { tripsApi } from '@/lib/api/trips'
import type { Trip } from '@/lib/types'

vi.mock('@/lib/api/trips', () => ({
  tripsApi: {
    patch: vi.fn(),
    resetField: vi.fn(),
    removeFleetLink: vi.fn(),
  },
}))
vi.mock('@/lib/api/transporters', () => ({
  transportersApi: { list: vi.fn().mockResolvedValue({ data: [] }) },
}))

const baseTrip: Trip = {
  id: 't1', source_system: 'qanalytics', client_name: 'walmart', planning_date: '2026-07-02',
  status_reported_at: null, current_status: 'ORIGEN', tractor_plate: 'ABCD12', trailer_plate: null,
  driver_name: 'Juan Perez', driver_rut: null, driver_phone: null, transporter: null, transporter_tms: null,
  origin: 'CD Quilicura', cargo_type: 'FRIO', stops: [], activo: true, trabajando: false, asignado: true,
  primera_vuelta: false, estado_manual: null, observaciones: null, comentarios: null,
  fleet_link_id: null, transporter_profile_id: null, manually_edited_fields: [], edited_at: null,
  edited_by: null, created_at: null,
  updated_at: null, source_system_trip_id: '2000711', milestone_status: null, pipeline_updated_at: null,
}

describe('TripSlideOver — sin tabs', () => {
  beforeEach(() => {
    vi.mocked(tripsApi.patch).mockReset()
    vi.mocked(tripsApi.resetField).mockReset()
  })

  it('does not render a tab bar', () => {
    render(<TripSlideOver trip={baseTrip} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.queryByText('Empresa')).not.toBeInTheDocument() // no tab button, solo el acordeón (título distinto abajo)
  })

  it('shows Empresa and Bitácora as collapsed accordions that expand on click', () => {
    render(<TripSlideOver trip={baseTrip} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    const empresaHeader = screen.getByText('Empresa transportista')
    expect(screen.queryByText('sin vincular', { exact: false })).not.toBeInTheDocument()
    fireEvent.click(empresaHeader)
    expect(screen.getByPlaceholderText(/Buscar empresa/)).toBeInTheDocument()
  })

  it('shows an inline "set manual override" affordance next to the status, not inside a hidden tab', () => {
    render(<TripSlideOver trip={baseTrip} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getByText(/Establecer estado operativo/)).toBeInTheDocument()
  })

  it('shows attribution and a revert control when estado_manual is set', () => {
    const tripWithOverride = { ...baseTrip, estado_manual: 'en_seguimiento', edited_at: '2026-07-02 10:15:00' }
    render(<TripSlideOver trip={tripWithOverride} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getByText(/confirmado manualmente/)).toBeInTheDocument()
  })

  it('reverting the override calls tripsApi.resetField with estado_manual', async () => {
    vi.mocked(tripsApi.resetField).mockResolvedValue({ ok: true, field: 'estado_manual' })
    const tripWithOverride = { ...baseTrip, estado_manual: 'en_seguimiento' }
    render(<TripSlideOver trip={tripWithOverride} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    fireEvent.click(screen.getByTitle('Revertir a valor del TMS'))
    await waitFor(() => expect(tripsApi.resetField).toHaveBeenCalledWith('t1', 'estado_manual'))
  })

  it('shows a visible error when reverting the override fails', async () => {
    vi.mocked(tripsApi.resetField).mockRejectedValue(new Error('network down'))
    const tripWithOverride = { ...baseTrip, estado_manual: 'en_seguimiento' }
    render(<TripSlideOver trip={tripWithOverride} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    fireEvent.click(screen.getByTitle('Revertir a valor del TMS'))
    expect(await screen.findByText('network down')).toBeInTheDocument()
  })
})
