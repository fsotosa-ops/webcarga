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
    resolveNote: vi.fn(),
  },
}))
vi.mock('@/lib/api/drivers', () => ({
  driversApi: { search: vi.fn(), fuzzyMatch: vi.fn() },
}))
vi.mock('@/lib/api/locations', () => ({
  locationsApi: { list: vi.fn() },
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
  vi.mocked(tripsApi.resolveNote).mockReset()
  vi.mocked(driversApi.search).mockReset().mockResolvedValue([])
  vi.mocked(driversApi.fuzzyMatch).mockReset().mockResolvedValue([])
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

  it('shows "N incidente(s) abierto(s)" badge in the hero when there are open incident notes', async () => {
    vi.mocked(tripsApi.listNotes).mockResolvedValue([
      { id: 'n1', trip_id: 't1', author_id: 'u1', author_name: 'Op', body: 'x', note_type: 'incidente', pinned: false, created_at: '2026-07-05 12:00:00', attachments: [], resolved_at: null },
      { id: 'n2', trip_id: 't1', author_id: 'u1', author_name: 'Op', body: 'y', note_type: 'incidente', pinned: false, created_at: '2026-07-05 12:00:00', attachments: [], resolved_at: '2026-07-05 13:00:00' },
    ])
    renderSlideOver(baseTrip)
    expect(await within(screen.getByTestId('hero')).findByText('1 incidente abierto')).toBeInTheDocument()
  })

  it('does not show the incidents badge when all incidents are resolved', async () => {
    vi.mocked(tripsApi.listNotes).mockResolvedValue([
      { id: 'n1', trip_id: 't1', author_id: 'u1', author_name: 'Op', body: 'x', note_type: 'incidente', pinned: false, created_at: '2026-07-05 12:00:00', attachments: [], resolved_at: '2026-07-05 13:00:00' },
    ])
    renderSlideOver(baseTrip)
    await waitFor(() => expect(tripsApi.listNotes).toHaveBeenCalled())
    expect(within(screen.getByTestId('hero')).queryByText(/incidente/i)).not.toBeInTheDocument()
  })
})

describe('TripSlideOver — header (IDs unificados + link a TMS)', () => {
  it('copies the external id via its own button', () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    renderSlideOver(baseTrip)
    fireEvent.click(screen.getByTitle('Copiar ID externo'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('2000711')
  })

  it('shows the internal uuid in the header with its own copy button', () => {
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
  })

  it('the TMS chip is not a link for a manual trip', () => {
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

  it('shows the linked carrier as a compact card and unlinks via removeFleetLink', async () => {
    vi.mocked(tripsApi.removeFleetLink).mockResolvedValue({ ok: true })
    renderSlideOver({ ...baseTrip, carrier_id: 'c1', carrier_name: 'Transportes Sur Spa' })
    expect(screen.getByText('Transportes Sur Spa')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Desvincular'))
    await waitFor(() => expect(tripsApi.removeFleetLink).toHaveBeenCalledWith('t1'))
  })

  it('shows a reconciliation banner including carrier divergence, and reverts via "Usar dato del TMS"', async () => {
    vi.mocked(tripsApi.removeFleetLink).mockResolvedValue({ ok: true })
    renderSlideOver({
      ...baseTrip,
      fleet_link_id: 'fl1', carrier_id: 'c1', carrier_name: 'Transportes Sur Spa',
      carrier_name_tms: 'Transportes ACME SPA',
    })
    expect(screen.getByText(/TMS reporta empresa/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Usar dato del TMS'))
    await waitFor(() => expect(tripsApi.removeFleetLink).toHaveBeenCalledWith('t1'))
  })

  // ── HU-06/HU-05 (Fase 3): fuzzy match + gatillo de creación ──────────────

  it('shows fuzzy-match candidates by TMS name and picking one fills the draft', async () => {
    vi.mocked(driversApi.fuzzyMatch).mockResolvedValue([{
      driver_id: 'd9', driver_name: 'Hernandez Contreras Ulices Alfredo', driver_rut: '9-9', driver_phone: null,
      carrier_id: 'c9', carrier_name: 'Transportes Norte', tractor_asset_id: null, tractor_plate: null,
      similarity: 0.87,
    }])
    renderSlideOver({ ...baseTrip, driver_name_tms: 'HERNANDEZ CONTRERAS EULICES ALFREDO' })

    expect(await screen.findByText('Posibles coincidencias (nombre TMS)')).toBeInTheDocument()
    expect(screen.getByText('Hernandez Contreras Ulices Alfredo')).toBeInTheDocument()
    expect(screen.getByText('87%')).toBeInTheDocument()
    expect(driversApi.fuzzyMatch).toHaveBeenCalledWith('HERNANDEZ CONTRERAS EULICES ALFREDO')

    fireEvent.click(screen.getByText('Hernandez Contreras Ulices Alfredo'))
    expect(screen.getByLabelText('Empresa de transporte')).toHaveValue('Transportes Norte')
  })

  it('shows a "create in Empresas" trigger when the TMS name has no fuzzy match', async () => {
    vi.mocked(driversApi.fuzzyMatch).mockResolvedValue([])
    renderSlideOver({ ...baseTrip, driver_name_tms: 'NOMBRE SIN CRUCE' })

    expect(await screen.findByText(/Sin coincidencias — dar de alta empresa\/conductor\/equipo/)).toBeInTheDocument()
  })

  // Ronda 43 (Hallazgo F): el link de alta pre-carga los 3 datos que ya
  // reportó el TMS (razón social, conductor, patente) para no re-tipearlos.
  it('the "create in Empresas" trigger carries TMS-reported data as query params', async () => {
    vi.mocked(driversApi.fuzzyMatch).mockResolvedValue([])
    renderSlideOver({
      ...baseTrip,
      driver_name_tms: 'NOMBRE SIN CRUCE',
      carrier_name_tms: 'TRANSPORTES SAN EXPEDITO',
      tractor_plate_tms: 'XYZW12',
    })

    const link = await screen.findByText(/Sin coincidencias — dar de alta empresa\/conductor\/equipo/)
    const href = link.closest('a')!.getAttribute('href')!
    const params = new URLSearchParams(href.split('?')[1])
    expect(params.get('create')).toBe('1')
    expect(params.get('business_name')).toBe('TRANSPORTES SAN EXPEDITO')
    expect(params.get('driver_name')).toBe('NOMBRE SIN CRUCE')
    expect(params.get('tractor_plate')).toBe('XYZW12')
  })

  it('does not query fuzzy-match when the trip already has a carrier linked', () => {
    renderSlideOver({ ...baseTrip, carrier_id: 'c1', carrier_name: 'Transportes Sur Spa', driver_name_tms: 'ALGUIEN' })
    expect(driversApi.fuzzyMatch).not.toHaveBeenCalled()
  })

  // Fase B (ítem 5, feedback post-weekly 2026-07-22): tracto/conductor sin
  // ningún cruce contra empresa (transcript-meeting.md). Label "Sin
  // identificar" (corregido Ronda 43 — "Equipo OVNI" fue la forma
  // coloquial en que Pablo lo explicó en la reunión, no un término de
  // producto ni nomenclatura estándar de industria/logtech).
  it('shows "Sin identificar" when fleet_match_status is UNMATCHED', () => {
    renderSlideOver({ ...baseTrip, fleet_match_status: 'UNMATCHED', driver_name_tms: 'ALGUIEN SIN CRUCE' })
    expect(screen.getByText(/Sin identificar/)).toBeInTheDocument()
  })

  it('does not show "Sin identificar" when fleet_match_status is MATCHED or unset', () => {
    renderSlideOver({ ...baseTrip, driver_name_tms: 'ALGUIEN' })
    expect(screen.queryByText(/Sin identificar/)).not.toBeInTheDocument()
  })

  // Gap cerrado 2026-07-22: documentación LEGAL_MANDATORY de conductor/
  // tracto/empresa — antes solo Seguros tenía esta prominencia en el Diario.
  it('shows a pending-docs badge per domain, labeled so it is not ambiguous which entity it refers to', () => {
    renderSlideOver({
      ...baseTrip, carrier_id: 'c1', carrier_name: 'Transportes Sur Spa',
      driver_pending_docs: 2, tractor_pending_docs: 7, carrier_pending_docs: 11,
    })
    expect(screen.getByText('Conductor: 2 pendientes')).toBeInTheDocument()
    expect(screen.getByText('Tracto: 7 pendientes')).toBeInTheDocument()
    expect(screen.getByText('Empresa: 11 pendientes')).toBeInTheDocument()
  })

  it('shows a critical banner when the driver is missing Licencia de Conducir or Carnet, with a real link to Empresas', () => {
    renderSlideOver({
      ...baseTrip, carrier_id: 'c1', carrier_name: 'Transportes Sur Spa',
      driver_pending_docs: 2, driver_pending_docs_critical: true,
    })
    expect(screen.getByText(/Falta Licencia de Conducir o Carnet del conductor/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'revisar en Empresas' })).toHaveAttribute(
      'href', '/dashboard/carriers/c1?tab=conductores',
    )
  })

  it('links "revisar en Seguros" to the carrier\'s Seguros tab when the policy is expired', () => {
    renderSlideOver({
      ...baseTrip, carrier_id: 'c1', carrier_name: 'Transportes Sur Spa', insurance_alert: 'EXPIRED',
    })
    expect(screen.getByText(/Póliza vencida para esta empresa/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'revisar en Seguros' })).toHaveAttribute(
      'href', '/dashboard/carriers/c1?tab=seguros',
    )
  })

  it('links "revisar en Empresas" to the conductores tab on a fleet mismatch', () => {
    renderSlideOver({
      ...baseTrip, carrier_id: 'c1', carrier_name: 'Transportes Sur Spa',
      fleet_match_status: 'MISMATCH', fleet_match_driver_home_carrier: 'Otra Transportista Spa',
    })
    expect(screen.getByText(/distinta de la empresa de este viaje/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'revisar en Empresas' })).toHaveAttribute(
      'href', '/dashboard/carriers/c1?tab=conductores',
    )
  })

  it('does not show the critical banner when pending docs are non-critical', () => {
    renderSlideOver({
      ...baseTrip, carrier_id: 'c1', carrier_name: 'Transportes Sur Spa',
      driver_pending_docs: 2, driver_pending_docs_critical: false,
    })
    expect(screen.queryByText(/Falta Licencia de Conducir o Carnet del conductor/)).not.toBeInTheDocument()
  })
})

describe('TripSlideOver — override de estado', () => {
  it('shows an inline "set manual override" affordance', () => {
    renderSlideOver(baseTrip)
    expect(screen.getByText(/Establecer estado operativo/)).toBeInTheDocument()
  })

  it('reverting the override calls tripsApi.resetField with manual_status', async () => {
    vi.mocked(tripsApi.resetField).mockResolvedValue({ ok: true, field: 'manual_status' })
    renderSlideOver({ ...baseTrip, manual_status: 'en_seguimiento' })
    fireEvent.click(screen.getByTitle('Revertir a valor del TMS'))
    await waitFor(() => expect(tripsApi.resetField).toHaveBeenCalledWith('t1', 'manual_status'))
  })
})

describe('TripSlideOver — indicadores (switches, Fase 2 Plan 5)', () => {
  it('renders Activo/Trabajando/Asignado as switches, without "1ra Vuelta"', () => {
    renderSlideOver(baseTrip)
    expect(screen.getByRole('switch', { name: 'Activo' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Trabajando' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Asignado' })).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: '1ra Vuelta' })).not.toBeInTheDocument()
  })

  it('toggles a switch via tripsApi.patch', async () => {
    // baseTrip.is_working arranca en false — el click debería togglearlo a true
    vi.mocked(tripsApi.patch).mockResolvedValue({ ...baseTrip, is_working: true })
    renderSlideOver(baseTrip)
    fireEvent.click(screen.getByRole('switch', { name: 'Trabajando' }))
    await waitFor(() => expect(tripsApi.patch).toHaveBeenCalledWith('t1', { is_working: true }))
  })

  it('shows explicit override attribution text and a revert control when a field is manually edited', () => {
    renderSlideOver({ ...baseTrip, manually_edited_fields: ['is_assigned'], edited_by: 'Felipe Sumadots', edited_at: '2026-07-02 10:15:00' })
    expect(screen.getByText(/Editado manualmente por Felipe Sumadots/)).toBeInTheDocument()
    expect(screen.getByText('Revertir a automático')).toBeInTheDocument()
  })
})

describe('TripSlideOver — Bitácora (feed con historial)', () => {
  const note: TripNote = {
    id: 'n1', trip_id: 't1', author_id: 'u1', author_name: 'Operador Uno',
    body: 'Conductor confirmó por teléfono', note_type: 'llamada', pinned: false,
    created_at: '2026-07-05 12:00:00', attachments: [], resolved_at: null,
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

  it('no longer shows a legacy notes/comments block (retirado, Fase 2 Plan 5)', async () => {
    renderSlideOver({ ...baseTrip, notes: 'obs vieja', comments: 'comentario viejo' })
    await waitFor(() => expect(tripsApi.listNotes).toHaveBeenCalled())
    expect(screen.queryByText(/Nota anterior/)).not.toBeInTheDocument()
    expect(screen.queryByText('obs vieja')).not.toBeInTheDocument()
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

  it('shows an "Abierto" chip and "Marcar resuelto" action for an unresolved incident note', async () => {
    vi.mocked(tripsApi.listNotes).mockResolvedValue([
      { ...note, id: 'n1', note_type: 'incidente', body: 'sobreestadía', resolved_at: null },
    ])
    renderSlideOver(baseTrip)
    expect(await screen.findByText('Abierto')).toBeInTheDocument()
    expect(screen.getByText('Marcar resuelto')).toBeInTheDocument()
  })

  it('marking an incident resolved calls tripsApi.resolveNote', async () => {
    vi.mocked(tripsApi.listNotes).mockResolvedValue([
      { ...note, id: 'n1', note_type: 'incidente', body: 'sobreestadía', resolved_at: null },
    ])
    vi.mocked(tripsApi.resolveNote).mockResolvedValue({ ok: true, resolved: true })
    renderSlideOver(baseTrip)
    await screen.findByText('sobreestadía')
    fireEvent.click(screen.getByText('Marcar resuelto'))
    await waitFor(() => expect(tripsApi.resolveNote).toHaveBeenCalledWith('t1', 'n1', true))
  })

  it('shows a "Resuelto" chip and "Reabrir" action for a resolved incident note', async () => {
    vi.mocked(tripsApi.listNotes).mockResolvedValue([
      { ...note, id: 'n1', note_type: 'incidente', body: 'sobreestadía', resolved_at: '2026-07-06 09:00:00' },
    ])
    renderSlideOver(baseTrip)
    expect(await screen.findByText('Resuelto')).toBeInTheDocument()
    expect(screen.getByText('Reabrir')).toBeInTheDocument()
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

describe('TripSlideOver — Ubicación de origen (solo operation_type)', () => {
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

describe('TripSlideOver — focusNotes (badge de bitácora, 2026-07-28)', () => {
  it('scrolls the Bitácora section into view when focusNotes is true', () => {
    const scrollIntoViewMock = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoViewMock

    renderSlideOver(baseTrip, { focusNotes: true })

    expect(scrollIntoViewMock).toHaveBeenCalled()
  })

  it('does not scroll when focusNotes is false or omitted', () => {
    const scrollIntoViewMock = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoViewMock

    renderSlideOver(baseTrip)

    expect(scrollIntoViewMock).not.toHaveBeenCalled()
  })
})
