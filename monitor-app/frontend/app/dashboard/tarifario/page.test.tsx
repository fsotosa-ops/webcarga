import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import TarifarioPage from './page'
import { locationsApi, shippersApi, type Shipper } from '@/lib/api/locations'
import type { Location } from '@/lib/types'

vi.mock('@/lib/api/locations', () => ({
  locationsApi: { list: vi.fn(), create: vi.fn(), patch: vi.fn(), createRate: vi.fn(), patchRate: vi.fn(), listRates: vi.fn() },
  shippersApi: { list: vi.fn() },
}))

const SHIPPER: Shipper = { id: 'shipper-1', name: 'Walmart', status: 'ACTIVE' }
const LOCATION: Location = {
  id: 'loc-1', entity_type: 'SHIPPER', entity_id: 'shipper-1', site_number: '72',
  name: 'Alameda', country_code: 'CL', format: null, address: null, region_name: null,
  region_number: null, opens_at: null, closes_at: null, operation_type: 'RM',
  operational_status: 'ACTIVE', created_at: null, updated_at: null,
  current_rate: null, current_rate_valid_from: null, current_rate_valid_to: null,
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TarifarioPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(shippersApi.list).mockReset().mockResolvedValue([SHIPPER])
  // Cubre tanto la query principal como el conteo global de "sin clasificar"
  // (incompleteTotalQuery) — ambas pasan por locationsApi.list.
  vi.mocked(locationsApi.list).mockReset().mockResolvedValue({ data: [LOCATION], count: 1, page: 1, limit: 50 })
  vi.mocked(locationsApi.createRate).mockReset()
  vi.mocked(locationsApi.create).mockReset()
  vi.mocked(locationsApi.patch).mockReset()
})

async function selectShipper() {
  renderPage()
  fireEvent.change(await screen.findByLabelText('Generador de carga'), { target: { value: 'shipper-1' } })
  await screen.findByDisplayValue('Alameda')
}

describe('TarifarioPage', () => {
  it('prompts to pick a generador de carga before showing anything', async () => {
    renderPage()
    await screen.findByText('Elegí un generador de carga para ver sus locales.')
  })

  it('lists locations for the selected shipper with include_rate and pagination requested', async () => {
    await selectShipper()
    expect(locationsApi.list).toHaveBeenCalledWith({
      entity_type: 'SHIPPER', entity_id: 'shipper-1', q: '', incomplete: false,
      include_rate: true, page: 1, limit: 50,
    })
  })

  it('searches locations via ?q=', async () => {
    await selectShipper()
    fireEvent.change(screen.getByLabelText('Buscar local'), { target: { value: 'alameda' } })
    await waitFor(() => expect(locationsApi.list).toHaveBeenCalledWith(expect.objectContaining({ q: 'alameda' })))
  })

  it('shows the "Nuevo local" trigger only once a shipper is selected (header, not gated by results)', async () => {
    renderPage()
    expect(screen.queryByText('Nuevo local')).not.toBeInTheDocument()
    fireEvent.change(await screen.findByLabelText('Generador de carga'), { target: { value: 'shipper-1' } })
    expect(await screen.findByText('Nuevo local')).toBeInTheDocument()
  })

  it('saving a tariff calls createRate, not patch, and refreshes the row', async () => {
    vi.mocked(locationsApi.createRate).mockResolvedValue({
      id: 'r1', location_id: 'loc-1', tarifa: '450.000 CLP', valid_from: '2026-07-22', valid_to: null,
      created_at: null, updated_at: null,
    })
    await selectShipper()

    fireEvent.change(screen.getByLabelText('Tarifa de Alameda'), { target: { value: '450.000 CLP' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(locationsApi.createRate).toHaveBeenCalledWith('loc-1', {
      tarifa: '450.000 CLP', valid_from: undefined, valid_to: null,
    }))
    expect(locationsApi.patchRate).not.toHaveBeenCalled()
    expect(locationsApi.patch).not.toHaveBeenCalled()
    await screen.findByText('Guardado')
  })

  // Ronda 43 (Fase C, Tarea 8): campos absorbidos de la ex-pestaña Locales
  // de Configuración — editar cualquiera de estos llama a patch, no a
  // createRate.
  it('editing an absorbed Locales field (clasificación) calls patch, not createRate', async () => {
    vi.mocked(locationsApi.patch).mockResolvedValue({ ...LOCATION, operation_type: 'Z0' })
    await selectShipper()

    fireEvent.change(screen.getByLabelText('Clasificación de Alameda'), { target: { value: 'Z0' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(locationsApi.patch).toHaveBeenCalledWith('loc-1', {
      name: 'Alameda', format: null, address: null, operation_type: 'Z0',
    }))
    expect(locationsApi.createRate).not.toHaveBeenCalled()
  })

  it('toggling Activo/Inactivo calls patch immediately, without needing Guardar', async () => {
    vi.mocked(locationsApi.patch).mockResolvedValue({ ...LOCATION, operational_status: 'INACTIVE' })
    await selectShipper()

    fireEvent.click(screen.getByLabelText('Desactivar Alameda'))

    await waitFor(() => expect(locationsApi.patch).toHaveBeenCalledWith('loc-1', { operational_status: 'INACTIVE' }))
  })

  it('lets the user create a new local from the same page', async () => {
    vi.mocked(locationsApi.create).mockResolvedValue({ ...LOCATION, id: 'loc-2', name: 'Local Nuevo' })
    await selectShipper()

    fireEvent.click(screen.getByText('Nuevo local'))
    fireEvent.change(screen.getByLabelText('Nombre del local nuevo'), { target: { value: 'Local Nuevo' } })
    fireEvent.click(screen.getByText('Crear local'))

    await waitFor(() => expect(locationsApi.create).toHaveBeenCalled())
  })
})
