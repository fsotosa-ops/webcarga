import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TripAssignDialog } from './TripAssignDialog'
import { tripsApi } from '@/lib/api/trips'
import { driversApi } from '@/lib/api/drivers'
import type { TripsMeta } from '@/lib/types'

vi.mock('@/lib/api/trips', () => ({
  tripsApi: { create: vi.fn(), availableDrivers: vi.fn() },
}))
vi.mock('@/lib/api/drivers', () => ({
  driversApi: { search: vi.fn() },
}))

const meta: TripsMeta = {
  statuses: [{ id: 'ASIGNADO', label: 'ASIGNADO', bg_color: '#fff', text_color: '#000', group: 'otro' }],
  tms_sources: [
    { id: 'qanalytics', label: 'QA', bg_color: '#fff', text_color: '#000' },
    { id: 'manual', label: 'Manual', bg_color: '#fff', text_color: '#000' },
  ],
  operational_states: [], alert_thresholds: [], csv_columns: [], temperature_ranges: [], unassigned_reasons: [], operation_types: [],
}

function renderCreate(props: Partial<Parameters<typeof TripAssignDialog>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TripAssignDialog open onClose={vi.fn()} onCreated={vi.fn()} meta={meta} fecha="2026-07-18" {...props} />
    </QueryClientProvider>,
  )
}

/** La mayoría de los tests de este archivo necesitan un conductor elegido
 *  antes de poder enviar el form — Crear viaje queda disabled sin
 *  form.driver_id (Ronda 26, bloqueo driver-first). */
async function pickDriver() {
  vi.mocked(driversApi.search).mockResolvedValueOnce([{
    driver_id: 'd1', driver_name: 'Juan Pérez', driver_rut: '12345678-9', driver_phone: null,
    carrier_id: 'c1', carrier_name: 'Transportes Sur Spa', tractor_asset_id: 'a1', tractor_plate: 'ABCD12',
  }])
  fireEvent.change(screen.getByLabelText('Buscar conductor'), { target: { value: 'Juan' } })
  fireEvent.click(await screen.findByText('Juan Pérez'))
}

beforeEach(() => {
  vi.mocked(tripsApi.create).mockReset()
  vi.mocked(tripsApi.availableDrivers).mockReset().mockResolvedValue([])
  vi.mocked(driversApi.search).mockReset().mockResolvedValue([])
})

describe('TripAssignDialog', () => {
  it('has dialog semantics and closes with Escape', () => {
    const onClose = vi.fn()
    renderCreate({ onClose })
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('defaults planning_date to today', () => {
    renderCreate()
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
    expect(screen.getByDisplayValue(today)).toBeInTheDocument()
  })

  it('Crear viaje queda deshabilitado hasta elegir un conductor del directorio', () => {
    renderCreate()
    expect(screen.getByText('Crear viaje')).toBeDisabled()
  })

  it('picks a driver, autofills empresa/vehículo (editables), and sends driver_id + carrier_id + tractor_asset_id on create', async () => {
    vi.mocked(tripsApi.create).mockResolvedValue({ id: 't-new' } as never)
    renderCreate()

    await pickDriver()

    expect(screen.getByDisplayValue('Transportes Sur Spa')).toBeInTheDocument()
    expect(screen.getByDisplayValue('ABCD12')).toBeInTheDocument()
    expect(screen.getByText('Crear viaje')).not.toBeDisabled()

    fireEvent.click(screen.getByText('Crear viaje'))
    await waitFor(() => expect(tripsApi.create).toHaveBeenCalled())
    const payload = vi.mocked(tripsApi.create).mock.calls[0][0]
    expect(payload.driver_id).toBe('d1')
    expect(payload.carrier_id).toBe('c1')
    expect(payload.tractor_asset_id).toBe('a1')
    expect(payload.transporter_name).toBe('Transportes Sur Spa')
  })

  it('shows a warning with a link to Empresas when the driver search has no matches', async () => {
    renderCreate()
    fireEvent.change(screen.getByLabelText('Buscar conductor'), { target: { value: 'Nadie Real' } })
    expect(await screen.findByText(/no se puede crear el viaje sin un conductor vinculado/)).toBeInTheDocument()
  })

  it('lets clearing the picked driver ("Cambiar") to search again', async () => {
    renderCreate()
    await pickDriver()
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Cambiar'))
    expect(screen.getByLabelText('Buscar conductor')).toBeInTheDocument()
    expect(screen.getByText('Crear viaje')).toBeDisabled()
  })

  it('submits with Enter (form submit) and sends stops + origin', async () => {
    vi.mocked(tripsApi.create).mockResolvedValue({ id: 't-new', planning_date: '2026-07-06' } as never)
    const onCreated = vi.fn()
    renderCreate({ onCreated })
    await pickDriver()

    // Agregar un destino
    fireEvent.click(screen.getByText('Agregar destino'))
    fireEvent.change(screen.getByLabelText('Nombre destino 1'), { target: { value: 'Local Maipú' } })

    // Enviar el form
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!)
    await waitFor(() => expect(tripsApi.create).toHaveBeenCalled())
    const payload = vi.mocked(tripsApi.create).mock.calls[0][0]
    expect(payload.stops).toEqual([{ local: 'Local Maipú', planning_date: null }])
    expect(payload.origin_tms).toBeUndefined() // modo "Sin TMS"
    expect(onCreated).toHaveBeenCalled()
  })

  it('shows TMS selector and reconciliation hint when origin is a mapped TMS', () => {
    renderCreate()
    fireEvent.click(screen.getByText('TMS integrado'))
    fireEvent.change(screen.getByLabelText('TMS de origen'), { target: { value: 'qanalytics' } })
    fireEvent.change(screen.getByPlaceholderText('1994062'), { target: { value: '555' } })
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'walmart' } })
    expect(screen.getByText(/Se vinculará automáticamente/)).toBeInTheDocument()
  })

  it('cliente es dropdown con canónicos y "Otro cliente" revela texto libre', async () => {
    vi.mocked(tripsApi.create).mockResolvedValue({ id: 't-new' } as never)
    renderCreate()
    await pickDriver()
    const select = screen.getByLabelText('Cliente') as HTMLSelectElement
    const values = Array.from(select.options).map(o => o.value)
    expect(values).toEqual(expect.arrayContaining(['walmart', 'sodimac', 'colun', 'iansa', 'otro']))

    // Sin nombre → se envía el genérico 'otro'
    fireEvent.change(select, { target: { value: 'otro' } })
    expect(screen.getByLabelText(/Nombre del cliente/i)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Crear viaje'))
    await waitFor(() => expect(tripsApi.create).toHaveBeenCalled())
    expect(vi.mocked(tripsApi.create).mock.calls[0][0].client_name).toBe('otro')

    // Con nombre → se envía el texto
    vi.mocked(tripsApi.create).mockClear()
    fireEvent.change(screen.getByLabelText(/Nombre del cliente/i), { target: { value: 'Agrosuper' } })
    fireEvent.click(screen.getByText('Crear viaje'))
    await waitFor(() => expect(tripsApi.create).toHaveBeenCalled())
    expect(vi.mocked(tripsApi.create).mock.calls[0][0].client_name).toBe('Agrosuper')
  })

  it('tipo de carga es dropdown con SECO/FRIO/CONGELADO', () => {
    renderCreate()
    const select = screen.getByLabelText('Tipo de carga') as HTMLSelectElement
    const values = Array.from(select.options).map(o => o.value)
    expect(values).toEqual(expect.arrayContaining(['SECO', 'FRIO', 'CONGELADO']))
  })

  it('modo Sin TMS permite anotar un ID de seguimiento y lo envía sin origin_tms', async () => {
    vi.mocked(tripsApi.create).mockResolvedValue({ id: 't-new' } as never)
    renderCreate()
    await pickDriver()
    fireEvent.change(screen.getByPlaceholderText(/Guía, hoja de ruta/), { target: { value: 'FAC-50' } })
    fireEvent.click(screen.getByText('Crear viaje'))
    await waitFor(() => expect(tripsApi.create).toHaveBeenCalled())
    const payload = vi.mocked(tripsApi.create).mock.calls[0][0]
    expect(payload.source_system_trip_id).toBe('FAC-50')
    expect(payload.origin_tms).toBeUndefined()
  })

  it('el selector de TMS integrado no ofrece "manual" como opción', () => {
    renderCreate()
    fireEvent.click(screen.getByText('TMS integrado'))
    const select = screen.getByLabelText('TMS de origen') as HTMLSelectElement
    const values = Array.from(select.options).map(o => o.value)
    expect(values).toContain('qanalytics')
    expect(values).not.toContain('manual')
  })

  it('shows a visible error when the backend rejects (409 duplicado)', async () => {
    vi.mocked(tripsApi.create).mockRejectedValue(new Error('Ya registraste el viaje 555 de Walmart'))
    renderCreate()
    await pickDriver()
    fireEvent.click(screen.getByText('Crear viaje'))
    expect(await screen.findByText(/Ya registraste el viaje/)).toBeInTheDocument()
  })

  it('envía región/ciudad de origen y de cada destino en el payload', async () => {
    vi.mocked(tripsApi.create).mockResolvedValue({ id: 't-new' } as never)
    renderCreate()
    await pickDriver()

    fireEvent.change(screen.getByLabelText('Región de origen'), { target: { value: 'Biobío' } })
    fireEvent.change(screen.getByLabelText('Ciudad de origen'), { target: { value: 'Concepción' } })

    fireEvent.click(screen.getByText('Agregar destino'))
    fireEvent.change(screen.getByLabelText('Nombre destino 1'), { target: { value: 'CD El Peñón' } })
    fireEvent.change(screen.getByLabelText('Región destino 1'), { target: { value: 'Región Metropolitana de Santiago' } })
    fireEvent.change(screen.getByLabelText('Ciudad destino 1'), { target: { value: 'San Bernardo' } })

    fireEvent.click(screen.getByText('Crear viaje'))
    await waitFor(() => expect(tripsApi.create).toHaveBeenCalled())
    const payload = vi.mocked(tripsApi.create).mock.calls[0][0]
    expect(payload.origin_region).toBe('Biobío')
    expect(payload.origin_city).toBe('Concepción')
    expect(payload.stops?.[0]).toMatchObject({
      local: 'CD El Peñón',
      destination_region: 'Región Metropolitana de Santiago',
      destination_city: 'San Bernardo',
    })
  })

  it('destinos can be removed', () => {
    renderCreate()
    fireEvent.click(screen.getByText('Agregar destino'))
    expect(screen.getByLabelText('Nombre destino 1')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Quitar destino 1'))
    expect(screen.queryByLabelText('Nombre destino 1')).not.toBeInTheDocument()
  })

  it('shows the "Disponibles hoy" suggested list from availableDrivers when the search field is empty', async () => {
    vi.mocked(tripsApi.availableDrivers).mockResolvedValue([{
      driver_id: 's1', driver_name: 'Pedro Soto', driver_rut: null, driver_phone: null,
      carrier_id: 'c2', carrier_name: 'TransCargo', tractor_asset_id: null, tractor_plate: null,
      trips_total: 0, last_report_at: null,
    }])
    renderCreate()
    expect(await screen.findByText('Pedro Soto')).toBeInTheDocument()
    expect(driversApi.search).not.toHaveBeenCalled()
  })
})
