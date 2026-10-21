import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import TarifarioPage from './page'
import { locationsApi, shippersApi, type ShipperRow, type LocationListParams } from '@/lib/api/locations'
import type { Location } from '@/lib/types'

vi.mock('@/lib/api/locations', () => ({
  locationsApi: { list: vi.fn(), create: vi.fn(), patch: vi.fn(), createRate: vi.fn(), patchRate: vi.fn(), listRates: vi.fn() },
  shippersApi: { list: vi.fn() },
}))
let busqueda = ''
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(busqueda) }))
vi.mock('@/hooks/useTripsMeta', () => ({ useTripsMeta: () => ({ data: { operation_types: [{ id: 'RM', label: 'RM' }] } }) }))
let canEdit = true
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: () => canEdit }))

const SHIPPER: ShipperRow = { id: 'shipper-1', name: 'Walmart', status: 'ACTIVE', operation_types: null, tms_names: 1, locations: 2, origins: 0, carriers: 1, trips_30d: 10 }
const PENDING: Location = {
  id: 'loc-9', entity_type: 'SHIPPER', entity_id: 'shipper-1', site_number: null,
  name: 'Empresas Carozzi S.A.', country_code: 'CL', format: null, address: null,
  region_name: null, region_number: null, opens_at: null, closes_at: null,
  operation_type: null, operational_status: 'ACTIVE', is_manual_override: false, is_origin: false,
  created_at: null, updated_at: null,
}
const CLASSIFIED: Location = {
  ...PENDING, id: 'loc-1', name: 'Alameda', site_number: '72', operation_type: 'RM',
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
  canEdit = true
  busqueda = ''
  vi.mocked(shippersApi.list).mockReset().mockResolvedValue([SHIPPER])
  vi.mocked(locationsApi.list).mockReset().mockImplementation(async (params?: LocationListParams) => {
    if (params?.needs_manual_classification) return { data: [PENDING], count: 1, page: 1, limit: 50 }
    return { data: [CLASSIFIED], count: 1, page: 1, limit: 50 }
  })
  vi.mocked(locationsApi.create).mockReset()
  vi.mocked(locationsApi.patch).mockReset()
})

describe('TarifarioPage', () => {
  it('shows the "Por revisar" tab by default, with no shipper selection required', async () => {
    renderPage()
    expect(await screen.findByText('Empresas Carozzi S.A.')).toBeInTheDocument()
    expect(screen.queryByText('Elige un generador de carga')).not.toBeInTheDocument()
  })

  it('"Nuevo local" is visible immediately, without picking a shipper first', async () => {
    renderPage()
    expect(await screen.findByText('Nuevo local')).toBeInTheDocument()
  })

  it('switches to "Todos los locales" and shows the full table', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Todos los locales/ }))
    expect(await screen.findByDisplayValue('Alameda')).toBeInTheDocument()
  })

  it('generador de carga is an optional filter inside "Todos los locales", not a gate', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Todos los locales/ }))
    await screen.findByDisplayValue('Alameda')
    expect(locationsApi.list).toHaveBeenCalledWith(expect.objectContaining({ entity_id: '' }))
  })

  it('clicking a pending card jumps to "Todos los locales" filtered by that location name', async () => {
    renderPage()
    fireEvent.click(await screen.findByText('Empresas Carozzi S.A.'))

    expect(await screen.findByRole('button', { name: /Todos los locales/, pressed: true })).toBeInTheDocument()
    expect(screen.getByLabelText('Buscar local')).toHaveValue('Empresas Carozzi S.A.')
  })

  it('sin commercial.edit el Tarifario se lee: sin alta de lugares y la tabla sin controles', async () => {
    canEdit = false
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Todos los locales/ }))
    expect(await screen.findByText('Alameda')).toBeInTheDocument()
    expect(screen.queryByText('Nuevo local')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Nombre de Alameda')).not.toBeInTheDocument()
  })

  it('si la lista falla se dice el error, no que no hay lugares', async () => {
    vi.mocked(locationsApi.list).mockImplementation(async (params?: LocationListParams) => {
      if (params?.entity_type) throw new Error('500')
      return { data: [PENDING], count: 1, page: 1, limit: 200 }
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Todos los locales/ }))
    expect(await screen.findByText('Error al cargar')).toBeInTheDocument()
    expect(screen.queryByText('Sin lugares para este filtro')).not.toBeInTheDocument()
  })

  it('P3.6: ?origen=1 abre Todos los locales filtrando Orígenes, con el cliente de cada uno', async () => {
    busqueda = 'origen=1'
    renderPage()
    expect(await screen.findByRole('button', { name: /Todos los locales/, pressed: true })).toBeInTheDocument()
    await waitFor(() => expect(locationsApi.list).toHaveBeenCalledWith(expect.objectContaining({ origin: true })))
    expect(within(screen.getByRole('group', { name: 'Lugares' })).getByRole('button', { name: 'Orígenes' })).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByRole('columnheader', { name: 'Cliente' })).toBeInTheDocument()
    expect(within(screen.getAllByRole('row')[1]).getByText('Walmart')).toBeInTheDocument()
  })

  it('P3.6: el filtro Orígenes se prende y se apaga desde la barra', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Todos los locales/ }))
    await screen.findByDisplayValue('Alameda')
    fireEvent.click(within(screen.getByRole('group', { name: 'Lugares' })).getByRole('button', { name: 'Orígenes' }))
    await waitFor(() => expect(locationsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ origin: true })))
  })
})
