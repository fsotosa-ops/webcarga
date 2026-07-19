import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TripSlideOver } from './TripSlideOver'
import { tripsApi } from '@/lib/api/trips'
import { driversApi } from '@/lib/api/drivers'
import type { Trip, TripNote } from '@/lib/types'

vi.mock('@/lib/api/trips', () => ({
  tripsApi: {
    patch: vi.fn(),
    patchStop: vi.fn(),
    resetField: vi.fn(),
    assignFleetLink: vi.fn(),
    removeFleetLink: vi.fn(),
    listNotes: vi.fn(),
    addNote: vi.fn(),
    pinNote: vi.fn(),
  },
}))
vi.mock('@/lib/api/drivers', () => ({
  driversApi: { search: vi.fn() },
}))

const baseTrip: Trip = {
  id: 't1', source_system: 'qanalytics', client_name: 'walmart', planning_date: '2026-07-02',
  status_reported_at: null, current_status: 'ORIGEN', tractor_plate: 'ABCD12', tractor_plate_tms: null, trailer_plate: null,
  driver_name: 'Juan Perez', driver_name_tms: null, driver_tax_id: null, driver_phone: null, carrier_name: null, carrier_name_tms: null,
  origin: 'CD Quilicura', cargo_type: 'FRIO', stops: [], is_active: true, is_working: false, is_assigned: true,
  is_first_leg: false, manual_status: null, notes: null, comments: null, unassigned_reason_id: null,
  fleet_link_id: null, carrier_id: null, driver_id: null, tractor_asset_id: null, trailer_asset_id: null, manually_edited_fields: [], edited_at: null,
  edited_by: null, created_at: null,
  updated_at: null, source_system_trip_id: '2000711', milestone_status: null, pipeline_updated_at: null,
}

const makeStop = (overrides: Partial<Trip['stops'][number]> = {}): Trip['stops'][number] => ({
  stop_id: 's1', local: 'Parada 1', planning_date: null, arrival_date: null, departure_date: null,
  departure_date_prog: null, unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
  on_time_status: null, destination_city: null, destination_region: null, s2s: null,
  temperature: null, milestone_status: null,
  ...overrides,
})

function renderSlideOver(trip: Trip, props: Partial<Parameters<typeof TripSlideOver>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TripSlideOver trip={trip} onClose={vi.fn()} onSaved={vi.fn()} meta={null} {...props} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(tripsApi.patch).mockReset()
  vi.mocked(tripsApi.patchStop).mockReset()
  vi.mocked(tripsApi.resetField).mockReset()
  vi.mocked(tripsApi.assignFleetLink).mockReset()
  vi.mocked(tripsApi.removeFleetLink).mockReset()
  vi.mocked(tripsApi.listNotes).mockReset().mockResolvedValue([])
  vi.mocked(tripsApi.addNote).mockReset()
  vi.mocked(driversApi.search).mockReset().mockResolvedValue([])
})

describe('TripSlideOver — hero (la historia del viaje)', () => {
  it('shows the active stop with its ETA in the hero', () => {
    const stops = [
      makeStop({ stop_id: 's1', local: 'Local 1', arrival_date: '2026-07-02 10:00:00', departure_date: '2026-07-02 10:30:00' }),
      makeStop({ stop_id: 's2', local: 'Local 2', planning_date: '2026-07-02 14:00:00' }),
    ]
    renderSlideOver({ ...baseTrip, stops })
    expect(screen.getAllByText('Local 2').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/llega ~/).length).toBeGreaterThan(0)
  })

  it('shows stop progress (N/M paradas) and badges only exceptions (no ON TIME badge)', () => {
    const stops = [
      makeStop({ stop_id: 's1', local: 'Local 1', arrival_date: '2026-07-02 10:00:00', on_time_status: 'ON TIME' }),
      makeStop({ stop_id: 's2', local: 'Local 2' }),
    ]
    renderSlideOver({ ...baseTrip, stops })
    expect(screen.getByText('1/2 paradas')).toBeInTheDocument()
    // "ON TIME" sí puede aparecer en la tabla técnica (siempre visible desde
    // este plan) — la regla de "gestión por excepción" aplica solo al hero.
    expect(within(screen.getByTestId('hero')).queryByText('ON TIME')).not.toBeInTheDocument()
  })

  it('shows the OFF TIME badge in the hero when a stop is off time', () => {
    const stops = [makeStop({ stop_id: 's1', local: 'Local 1', on_time_status: 'OFF TIME' })]
    renderSlideOver({ ...baseTrip, stops })
    expect(screen.getAllByText('OFF TIME').length).toBeGreaterThan(0)
  })

  it('degrades gracefully for a trip without stops', () => {
    renderSlideOver(baseTrip)
    expect(screen.getByText('Sin paradas registradas')).toBeInTheDocument()
  })

  it('shows a consolidated sync line with relative times', () => {
    const tripSynced = {
      ...baseTrip,
      status_reported_at: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
      pipeline_updated_at: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
    }
    renderSlideOver(tripSynced)
    expect(screen.getByText(/TMS reportó hace 12 min/)).toBeInTheDocument()
    expect(screen.getByText(/sync hace 8 min/)).toBeInTheDocument()
  })

  it('shows a temperature badge when a reading exists', () => {
    const stops = [makeStop({ arrival_date: '2026-07-02 10:00:00', temperature: 4 })]
    renderSlideOver({ ...baseTrip, stops })
    expect(screen.getAllByText('4°C').length).toBeGreaterThan(0)
  })

  it('does not render RouteProgress anymore (retirado, StopTimeline es el único timeline)', () => {
    const stops = [makeStop({ stop_id: 's1', local: 'Local 1' })]
    const { container } = renderSlideOver({ ...baseTrip, stops })
    // RouteProgress usaba nodos redondos con title=local; StopTimeline (Ruta,
    // siempre visible) usa otro layout — confirmamos que no hay 2 renders de
    // la misma parada en el hero contando cuántas veces aparece su nombre
    // fuera de la sección "Ruta" (una sola vez, no dos).
    expect(container.querySelectorAll('[title="Local 1"]').length).toBe(0)
  })
})

describe('TripSlideOver — header (IDs unificados + link a TMS)', () => {
  it('copies the external id via its own button', () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    renderSlideOver(baseTrip)
    fireEvent.click(screen.getByTitle('Copiar ID externo'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('2000711')
  })

  it('shows the internal uuid in the header with its own copy button (no footer anymore)', () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    renderSlideOver(baseTrip)
    expect(screen.getByText('t1')).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Copiar ID interno'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('t1')
  })

  it('the TMS chip links to the public login page for a TMS-sourced trip', () => {
    renderSlideOver({ ...baseTrip, source_system: 'qanalytics' })
    const link = screen.getByTitle(/Abrir en/)
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', 'https://www.qanalytics.cl/qnew/#')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('the TMS chip is not a link for a manual trip (no TMS to open)', () => {
    renderSlideOver({ ...baseTrip, source_system: 'manual' })
    expect(screen.queryByTitle(/Abrir en/)).not.toBeInTheDocument()
  })
})

describe('TripSlideOver — layout y a11y', () => {
  it('has dialog semantics (role, aria-modal)', () => {
    renderSlideOver(baseTrip)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('closes when Escape is pressed', () => {
    const onClose = vi.fn()
    renderSlideOver(baseTrip, { onClose })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('shows the driver search directly in Gestión, no accordion, when no company is linked', () => {
    renderSlideOver(baseTrip)
    expect(screen.getByLabelText('Buscar conductor')).toBeInTheDocument()
  })

  it('shows "en el Diario desde" with created_at in the hero', () => {
    renderSlideOver({ ...baseTrip, created_at: '2026-06-30 08:00:00' })
    expect(screen.getByText(/en el Diario desde/)).toBeInTheDocument()
  })

  it('shows Datos operativos always visible, no accordion, without EETT TMS', () => {
    renderSlideOver({ ...baseTrip, carrier_name_tms: 'Transportes ACME (texto TMS)' })
    expect(screen.getByText('Fecha planificación')).toBeInTheDocument()
    expect(screen.queryByText('EETT TMS')).not.toBeInTheDocument()
  })

  it('shows the technical stops table always visible, no "Ver detalle técnico" toggle', () => {
    const stops = [makeStop({ stop_id: 's1', local: 'Local 1' })]
    renderSlideOver({ ...baseTrip, stops })
    expect(screen.queryByText(/Ver detalle técnico/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Desc. inicio de Local 1')).toBeInTheDocument()
  })
})

describe('TripSlideOver — Conductor y flota (FleetAssignSection, driver-first)', () => {
  it('searches a driver, then Vincular calls assignFleetLink with the picked fleet', async () => {
    // Nombre distinto al de baseTrip.driver_name ("Juan Perez") a propósito
    // — evita que el header (que siempre muestra ese nombre) haga match
    // ambiguo con la fila de resultado de la búsqueda.
    vi.mocked(driversApi.search).mockResolvedValueOnce([{
      driver_id: 'd1', driver_name: 'Ana Torres', driver_rut: '11.111.111-1', driver_phone: '+56911112222',
      carrier_id: 'c1', carrier_name: 'Transportes Sur Spa', tractor_asset_id: 'a1', tractor_plate: 'ABCD12',
    }])
    vi.mocked(tripsApi.assignFleetLink).mockResolvedValue({ ...baseTrip, carrier_id: 'c1', carrier_name: 'Transportes Sur Spa' })
    renderSlideOver(baseTrip)

    fireEvent.change(screen.getByLabelText('Buscar conductor'), { target: { value: 'Ana' } })
    fireEvent.click(await screen.findByText('Ana Torres'))
    fireEvent.click(screen.getByText('Vincular'))

    await waitFor(() =>
      expect(tripsApi.assignFleetLink).toHaveBeenCalledWith('t1', {
        carrier_id: 'c1', driver_id: 'd1', tractor_asset_id: 'a1',
        driver_name: 'Ana Torres', tractor_plate: 'ABCD12',
      }))
  })

  it('lets the operator correct the autofilled tractor plate before confirming', async () => {
    vi.mocked(driversApi.search).mockResolvedValueOnce([{
      driver_id: 'd1', driver_name: 'Ana Torres', driver_rut: null, driver_phone: null,
      carrier_id: 'c1', carrier_name: 'Transportes Sur Spa', tractor_asset_id: 'a1', tractor_plate: 'ABCD12',
    }])
    vi.mocked(tripsApi.assignFleetLink).mockResolvedValue({ ...baseTrip, carrier_id: 'c1' })
    renderSlideOver(baseTrip)

    fireEvent.change(screen.getByLabelText('Buscar conductor'), { target: { value: 'Ana' } })
    fireEvent.click(await screen.findByText('Ana Torres'))
    fireEvent.change(screen.getByLabelText('Patente tracto'), { target: { value: 'zxzx99' } })
    fireEvent.click(screen.getByText('Vincular'))

    await waitFor(() =>
      expect(tripsApi.assignFleetLink).toHaveBeenCalledWith('t1', expect.objectContaining({ tractor_plate: 'ZXZX99' })))
  })

  it('does not show Vincular until a driver is picked', () => {
    renderSlideOver(baseTrip)
    expect(screen.queryByText('Vincular')).not.toBeInTheDocument()
  })

  it('shows the linked carrier as a compact card (not FleetAssignSection) and unlinks via removeFleetLink', async () => {
    vi.mocked(tripsApi.removeFleetLink).mockResolvedValue({ ok: true })
    renderSlideOver({ ...baseTrip, carrier_id: 'c1', carrier_name: 'Transportes Sur Spa' })
    expect(screen.getByText('Transportes Sur Spa')).toBeInTheDocument()
    expect(screen.queryByLabelText('Buscar conductor')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Desvincular'))
    await waitFor(() => expect(tripsApi.removeFleetLink).toHaveBeenCalledWith('t1'))
  })

  it('shows the driver search again after unlinking, with a clean draft', async () => {
    vi.mocked(tripsApi.removeFleetLink).mockResolvedValue({ ok: true })
    const onSaved = vi.fn()
    renderSlideOver({ ...baseTrip, carrier_id: 'c1', carrier_name: 'Transportes Sur Spa' }, { onSaved })
    fireEvent.click(screen.getByText('Desvincular'))
    await waitFor(() => expect(tripsApi.removeFleetLink).toHaveBeenCalled())
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ carrier_id: null }))
  })

  it('shows a reconciliation banner including carrier divergence, and reverts via "Usar dato del TMS"', async () => {
    vi.mocked(tripsApi.removeFleetLink).mockResolvedValue({ ok: true })
    renderSlideOver({
      ...baseTrip,
      fleet_link_id: 'fl1', carrier_id: 'c1', carrier_name: 'Transportes Sur Spa',
      carrier_name_tms: 'Transportes ACME SPA',
    })
    expect(screen.getByText(/TMS reporta empresa/)).toBeInTheDocument()
    expect(screen.getByText('Transportes ACME SPA')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Usar dato del TMS'))
    await waitFor(() => expect(tripsApi.removeFleetLink).toHaveBeenCalledWith('t1'))
  })

  it('does not show the reconciliation banner when TMS and linked carrier match', () => {
    renderSlideOver({
      ...baseTrip,
      fleet_link_id: 'fl1', carrier_id: 'c1', carrier_name: 'Transportes Sur Spa',
      carrier_name_tms: 'Transportes Sur Spa',
    })
    expect(screen.queryByText(/TMS reporta empresa/)).not.toBeInTheDocument()
  })
})

describe('TripSlideOver — override de estado', () => {
  it('shows an inline "set manual override" affordance', () => {
    renderSlideOver(baseTrip)
    expect(screen.getByText(/Establecer estado operativo/)).toBeInTheDocument()
  })

  it('shows a microcopy clarifying it mirrors the header when there is no manual override', () => {
    renderSlideOver(baseTrip)
    expect(screen.getByText(/mismo estado que se muestra en el encabezado/)).toBeInTheDocument()
  })

  it('shows attribution with editor name and a revert control when manual_status is set', () => {
    renderSlideOver({ ...baseTrip, manual_status: 'en_seguimiento', edited_at: '2026-07-02 10:15:00', edited_by: 'Felipe Sumadots' })
    expect(screen.getByText(/confirmado manualmente/)).toBeInTheDocument()
    expect(screen.getByText(/Felipe Sumadots/)).toBeInTheDocument()
  })

  it('reverting the override calls tripsApi.resetField with manual_status', async () => {
    vi.mocked(tripsApi.resetField).mockResolvedValue({ ok: true, field: 'manual_status' })
    renderSlideOver({ ...baseTrip, manual_status: 'en_seguimiento' })
    fireEvent.click(screen.getByTitle('Revertir a valor del TMS'))
    await waitFor(() => expect(tripsApi.resetField).toHaveBeenCalledWith('t1', 'manual_status'))
  })

  it('shows a visible error when reverting the override fails', async () => {
    vi.mocked(tripsApi.resetField).mockRejectedValue(new Error('network down'))
    renderSlideOver({ ...baseTrip, manual_status: 'en_seguimiento' })
    fireEvent.click(screen.getByTitle('Revertir a valor del TMS'))
    expect(await screen.findByText('network down')).toBeInTheDocument()
  })
})

describe('TripSlideOver — indicadores', () => {
  it('renders editable Indicadores for a TMS-sourced trip', () => {
    renderSlideOver(baseTrip)
    expect(screen.getByTitle('Activo')).toBeInTheDocument()
  })

  it('renders editable Indicadores for a manual trip', () => {
    renderSlideOver({ ...baseTrip, source_system: 'manual' })
    expect(screen.getByTitle('Activo')).toBeInTheDocument()
  })
})

describe('TripSlideOver — Bitácora (feed con historial)', () => {
  const note: TripNote = {
    id: 'n1', trip_id: 't1', author_id: 'u1', author_name: 'Operador Uno',
    body: 'Conductor confirmó por teléfono', note_type: 'llamada', pinned: false,
    created_at: '2026-07-05 12:00:00', attachments: [],
  }

  it('renders existing notes with author and type chip', async () => {
    vi.mocked(tripsApi.listNotes).mockResolvedValue([note])
    renderSlideOver(baseTrip)
    expect(await screen.findByText('Conductor confirmó por teléfono')).toBeInTheDocument()
    expect(screen.getByText('Operador Uno')).toBeInTheDocument()
    expect(screen.getAllByText('Llamada').length).toBeGreaterThan(0)
  })

  it('adds a note through the composer with the selected type', async () => {
    vi.mocked(tripsApi.addNote).mockResolvedValue({ ...note, id: 'n2', body: 'nueva nota', note_type: 'incidente' })
    renderSlideOver(baseTrip)
    fireEvent.click(screen.getByTitle('Incidente'))
    fireEvent.change(screen.getByPlaceholderText(/Registrar novedad/), { target: { value: 'nueva nota' } })
    fireEvent.click(screen.getByText('Agregar nota'))
    await waitFor(() =>
      expect(tripsApi.addNote).toHaveBeenCalledWith('t1', { body: 'nueva nota', note_type: 'incidente', files: [] }))
    expect(await screen.findByText('nueva nota')).toBeInTheDocument()
  })

  it('shows a visible error when adding a note fails', async () => {
    vi.mocked(tripsApi.addNote).mockRejectedValue(new Error('network down'))
    renderSlideOver(baseTrip)
    fireEvent.change(screen.getByPlaceholderText(/Registrar novedad/), { target: { value: 'x' } })
    fireEvent.click(screen.getByText('Agregar nota'))
    expect(await screen.findByText('network down')).toBeInTheDocument()
  })

  it('shows legacy notes/comments as a read-only entry (retiro es del Plan 5, no de este)', () => {
    renderSlideOver({ ...baseTrip, notes: 'obs vieja', comments: 'comentario viejo' })
    expect(screen.getByText(/Nota anterior/)).toBeInTheDocument()
    expect(screen.getByText(/obs vieja/)).toBeInTheDocument()
    expect(screen.getByText(/comentario viejo/)).toBeInTheDocument()
  })

  it('renders pinned notes in a Destacadas section above the feed', async () => {
    vi.mocked(tripsApi.listNotes).mockResolvedValue([
      { ...note, id: 'n1', body: 'nota normal' },
      { ...note, id: 'n2', body: 'nota fijada', pinned: true },
    ])
    renderSlideOver(baseTrip)
    expect(await screen.findByText('Destacadas')).toBeInTheDocument()
    const destacadas = screen.getByText('Destacadas')
    const fijada = screen.getByText('nota fijada')
    const normal = screen.getByText('nota normal')
    expect(destacadas.compareDocumentPosition(fijada) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(fijada.compareDocumentPosition(normal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('pinning a note calls tripsApi.pinNote', async () => {
    vi.mocked(tripsApi.listNotes).mockResolvedValue([note])
    vi.mocked(tripsApi.pinNote).mockResolvedValue({ ok: true, pinned: true })
    renderSlideOver(baseTrip)
    await screen.findByText('Conductor confirmó por teléfono')
    fireEvent.click(screen.getByTitle('Destacar nota'))
    await waitFor(() => expect(tripsApi.pinNote).toHaveBeenCalledWith('t1', 'n1', true))
  })

  it('renders system events as compact one-line entries without a pin control', async () => {
    vi.mocked(tripsApi.listNotes).mockResolvedValue([
      { ...note, id: 'n3', note_type: 'sistema', body: 'Estableció estado operativo manual: en_seguimiento' },
    ])
    renderSlideOver(baseTrip)
    expect(await screen.findByText(/estableció estado operativo manual/)).toBeInTheDocument()
    expect(screen.queryByTitle('Destacar nota')).not.toBeInTheDocument()
  })

  it('filters the feed by note type', async () => {
    vi.mocked(tripsApi.listNotes).mockResolvedValue([
      { ...note, id: 'n1', note_type: 'llamada', body: 'nota de llamada' },
      { ...note, id: 'n2', note_type: 'incidente', body: 'nota de incidente' },
    ])
    renderSlideOver(baseTrip)
    await screen.findByText('nota de llamada')
    fireEvent.click(screen.getAllByText('Incidente')[0])
    expect(screen.queryByText('nota de llamada')).not.toBeInTheDocument()
    expect(screen.getByText('nota de incidente')).toBeInTheDocument()
  })

  it('renders attachments and lists them in the Documentos view', async () => {
    vi.mocked(tripsApi.listNotes).mockResolvedValue([
      {
        ...note,
        attachments: [{ id: 'a1', file_name: 'guia.pdf', mime_type: 'application/pdf', size_bytes: 2048, url: 'https://signed/x' }],
      },
    ])
    renderSlideOver(baseTrip)
    expect(await screen.findByText('guia.pdf')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Documentos'))
    expect(screen.getByText('guia.pdf')).toBeInTheDocument()
    expect(screen.getByText(/2 KB/)).toBeInTheDocument()
  })

  it('attaching a file enables sending a note without body', async () => {
    vi.mocked(tripsApi.addNote).mockResolvedValue({
      ...note, id: 'n9', body: '',
      attachments: [{ id: 'a2', file_name: 'foto.png', mime_type: 'image/png', size_bytes: 10, url: 'https://signed/y' }],
    })
    renderSlideOver(baseTrip)
    const file = new File(['x'], 'foto.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('Adjuntar archivos'), { target: { files: [file] } })
    expect(await screen.findByText('foto.png')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Agregar nota'))
    await waitFor(() =>
      expect(tripsApi.addNote).toHaveBeenCalledWith('t1', { body: '', note_type: 'observacion', files: [file] }))
  })
})

describe('TripSlideOver — campos híbridos de fecha (Carga/Desc. Inicio-Fin) — tabla técnica siempre visible', () => {
  it('saves Carga inicio of the ORIGIN stop via tripsApi.patchStop on blur', async () => {
    vi.mocked(tripsApi.patchStop).mockResolvedValue(baseTrip)
    const stops = [makeStop({ stop_id: 'origin1', local: 'CD Origen', stop_type: 'ORIGIN' })]
    renderSlideOver({ ...baseTrip, stops })
    const input = screen.getByLabelText('Carga inicio de CD Origen') as HTMLInputElement
    fireEvent.change(input, { target: { value: '2026-07-17T09:00' } })
    fireEvent.blur(input)
    await waitFor(() =>
      expect(tripsApi.patchStop).toHaveBeenCalledWith('t1', 'origin1', { desc_inicio: '2026-07-17T09:00' }))
  })

  it('saves Carga fin of the ORIGIN stop via tripsApi.patchStop on blur', async () => {
    vi.mocked(tripsApi.patchStop).mockResolvedValue(baseTrip)
    const stops = [makeStop({ stop_id: 'origin1', local: 'CD Origen', stop_type: 'ORIGIN' })]
    renderSlideOver({ ...baseTrip, stops })
    const input = screen.getByLabelText('Carga fin de CD Origen') as HTMLInputElement
    fireEvent.change(input, { target: { value: '2026-07-17T09:30' } })
    fireEvent.blur(input)
    await waitFor(() =>
      expect(tripsApi.patchStop).toHaveBeenCalledWith('t1', 'origin1', { desc_fin: '2026-07-17T09:30' }))
  })

  it('shows an ORIGEN badge for the origin stop in the technical table', () => {
    const stops = [makeStop({ stop_id: 'origin1', local: 'CD Origen', stop_type: 'ORIGIN' })]
    renderSlideOver({ ...baseTrip, stops })
    expect(screen.getAllByText('ORIGEN').length).toBeGreaterThan(0)
  })

  it('saves Desc. inicio of a stop via tripsApi.patchStop on blur', async () => {
    vi.mocked(tripsApi.patchStop).mockResolvedValue(baseTrip)
    const stops = [makeStop({ stop_id: 's1', local: 'Local 1' })]
    renderSlideOver({ ...baseTrip, stops })
    const input = screen.getByLabelText('Desc. inicio de Local 1') as HTMLInputElement
    fireEvent.change(input, { target: { value: '2026-07-17T10:00' } })
    fireEvent.blur(input)
    await waitFor(() =>
      expect(tripsApi.patchStop).toHaveBeenCalledWith('t1', 's1', { desc_inicio: '2026-07-17T10:00' }))
  })

  it('marks a stop\'s Desc. inicio/fin inputs as manual when desc_manual is true', () => {
    const stops = [makeStop({ stop_id: 's1', local: 'Local 1', desc_manual: true })]
    renderSlideOver({ ...baseTrip, stops })
    const input = screen.getByLabelText('Desc. inicio de Local 1') as HTMLInputElement
    expect(input.className).toMatch(/text-accent/)
  })
})

describe('TripSlideOver — clasificación RM/Zona Cero por parada (H2.6, catálogo de locales)', () => {
  it('shows the classification badge next to a stop in the technical table when operation_type resolved', () => {
    const stops = [makeStop({ stop_id: 's1', local: 'ALAMEDA - 72', operation_type: 'RM' })]
    const meta = {
      statuses: [], tms_sources: [], operational_states: [], alert_thresholds: [], csv_columns: [],
      temperature_ranges: [], unassigned_reasons: [],
      operation_types: [{ id: 'RM', label: 'RM', bg_color: '#e8eeff', text_color: '#053bfa' }],
    }
    renderSlideOver({ ...baseTrip, stops }, { meta: meta as never })
    expect(screen.getByText('RM')).toBeInTheDocument()
  })

  it('does not show a classification badge when the stop has no operation_type resolved', () => {
    const stops = [makeStop({ stop_id: 's1', local: 'CD LO AGUIRRE', operation_type: null })]
    renderSlideOver({ ...baseTrip, stops })
    expect(screen.queryByText('RM')).not.toBeInTheDocument()
  })
})

describe('TripSlideOver — Ubicación de origen (solo operation_type, sin región/ciudad)', () => {
  const metaWithOpTypes = {
    statuses: [], tms_sources: [], operational_states: [], alert_thresholds: [], csv_columns: [],
    temperature_ranges: [], unassigned_reasons: [],
    operation_types: [{ id: 'RM', label: 'RM', bg_color: '#e8eeff', text_color: '#053bfa' }],
  } as never

  it('shows the operation_type badge when resolved', () => {
    renderSlideOver({ ...baseTrip, origin_operation_type: 'RM' }, { meta: metaWithOpTypes })
    expect(screen.getByText('RM')).toBeInTheDocument()
  })

  it('shows "Sin clasificar" instead of an empty section when origin_operation_type is null', () => {
    renderSlideOver({ ...baseTrip, origin_operation_type: null })
    expect(screen.getByText('Sin clasificar')).toBeInTheDocument()
  })

  it('no longer shows a región/ciudad picker for the origin', () => {
    renderSlideOver(baseTrip)
    expect(screen.queryByLabelText('Región de origen')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Ciudad de origen')).not.toBeInTheDocument()
  })
})

describe('TripSlideOver — motivo de no asignación (Fase 1.5d)', () => {
  const metaWithReasons = {
    statuses: [], tms_sources: [], operational_states: [], alert_thresholds: [],
    csv_columns: [], temperature_ranges: [],
    unassigned_reasons: [{ id: 'pana', label: 'Pana' }, { id: 'sin_conductor', label: 'Sin conductor' }],
  } as never

  it('shows the reason dropdown when the trip is not is_assigned and saves via tripsApi.patch', async () => {
    vi.mocked(tripsApi.patch).mockResolvedValue(baseTrip)
    renderSlideOver({ ...baseTrip, is_assigned: false }, { meta: metaWithReasons })

    fireEvent.change(screen.getByDisplayValue('— Sin especificar —'), { target: { value: 'pana' } })

    await waitFor(() =>
      expect(tripsApi.patch).toHaveBeenCalledWith('t1', { unassigned_reason_id: 'pana' }))
  })

  it('hides the reason dropdown once the trip is is_assigned', () => {
    renderSlideOver({ ...baseTrip, is_assigned: true }, { meta: metaWithReasons })
    expect(screen.queryByText('Motivo de no asignación')).not.toBeInTheDocument()
  })
})
