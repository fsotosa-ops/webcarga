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

describe('TripSlideOver — reordenado (Enfoque A)', () => {
  beforeEach(() => {
    vi.mocked(tripsApi.patch).mockReset()
    vi.mocked(tripsApi.resetField).mockReset()
  })

  it('does not render a tab bar', () => {
    render(<TripSlideOver trip={baseTrip} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.queryByText('Empresa')).not.toBeInTheDocument() // no tab button, solo el acordeón (título distinto abajo)
  })

  it('shows Empresa as a collapsed accordion that expands on click', () => {
    render(<TripSlideOver trip={baseTrip} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    const empresaHeader = screen.getByText('Empresa transportista')
    expect(screen.queryByText('sin vincular', { exact: false })).not.toBeInTheDocument()
    fireEvent.click(empresaHeader)
    expect(screen.getByPlaceholderText(/Buscar empresa/)).toBeInTheDocument()
  })

  it('shows Bitácora always expanded, not behind an accordion toggle', () => {
    render(<TripSlideOver trip={baseTrip} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getByPlaceholderText('Novedad operativa…')).toBeInTheDocument()
  })

  it('has dialog semantics (role, aria-modal)', () => {
    render(<TripSlideOver trip={baseTrip} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('closes when Escape is pressed', () => {
    const onClose = vi.fn()
    render(<TripSlideOver trip={baseTrip} onClose={onClose} onSaved={vi.fn()} meta={null} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
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

  it('shows a visible error next to Guardar notas when saving Bitácora notes fails', async () => {
    vi.mocked(tripsApi.patch).mockRejectedValue(new Error('network down'))
    render(<TripSlideOver trip={baseTrip} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    fireEvent.click(screen.getByText('Guardar notas'))
    expect(await screen.findByText('network down')).toBeInTheDocument()
  })

  it('shows created_at in the footer', () => {
    const tripWithCreated = { ...baseTrip, created_at: '2026-06-30 08:00:00' }
    render(<TripSlideOver trip={tripWithCreated} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getByText('Ingresó al sistema')).toBeInTheDocument()
  })

  it('shows the internal trip id in the footer', () => {
    render(<TripSlideOver trip={baseTrip} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getByText('t1')).toBeInTheDocument()
  })

  it('shows the editor name in the override attribution when estado_manual is set', () => {
    const tripWithOverride = { ...baseTrip, estado_manual: 'en_seguimiento', edited_at: '2026-07-02 10:15:00', edited_by: 'Felipe Sumadots' }
    render(<TripSlideOver trip={tripWithOverride} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getByText(/Felipe Sumadots/)).toBeInTheDocument()
  })

  it('shows a consolidated sync line with relative times for TMS report and pipeline sync', () => {
    const tripSynced = { ...baseTrip, status_reported_at: new Date(Date.now() - 12 * 60 * 1000).toISOString(), pipeline_updated_at: new Date(Date.now() - 8 * 60 * 1000).toISOString() }
    render(<TripSlideOver trip={tripSynced} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getByText(/TMS reportó hace 12 min/)).toBeInTheDocument()
    expect(screen.getByText(/Pipeline sincronizó hace 8 min/)).toBeInTheDocument()
  })

  it('promotes Ruta above Datos operativos in the DOM order', () => {
    const stops: Trip['stops'] = [{
      stop_id: 's1', local: 'Parada 1', planning_date: null, arrival_date: null, departure_date: null,
      departure_date_prog: null, unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
      on_time_status: null, destination_city: null, destination_region: null, s2s: null,
      temperature: null, milestone_status: null,
    }]
    render(<TripSlideOver trip={{ ...baseTrip, stops }} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    const rutaHeading = screen.getByText(/Ruta \(1 parada/)
    const datosHeading = screen.getByText('Datos operativos')
    expect(rutaHeading.compareDocumentPosition(datosHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('does not render Indicadores for a TMS-sourced trip', () => {
    render(<TripSlideOver trip={baseTrip} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.queryByTitle('Activo')).not.toBeInTheDocument()
  })

  it('renders editable Indicadores for a manual trip', () => {
    const manualTrip = { ...baseTrip, source_system: 'manual' }
    render(<TripSlideOver trip={manualTrip} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getByTitle('Activo')).toBeInTheDocument()
  })

  it('shows a temperature badge in the header when a reading exists', () => {
    const stops: Trip['stops'] = [{
      stop_id: 's1', local: 'Parada 1', planning_date: null, arrival_date: '2026-07-02 10:00:00', departure_date: null,
      departure_date_prog: null, unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
      on_time_status: null, destination_city: null, destination_region: null, s2s: null,
      temperature: 4, milestone_status: null,
    }]
    render(<TripSlideOver trip={{ ...baseTrip, stops }} onClose={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getByText('4°C')).toBeInTheDocument()
  })
})
