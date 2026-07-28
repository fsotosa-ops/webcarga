import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import TarifarioPage from './page'
import { locationsApi, shippersApi, type Shipper, type LocationListParams } from '@/lib/api/locations'
import type { Location } from '@/lib/types'

vi.mock('@/lib/api/locations', () => ({
  locationsApi: { list: vi.fn(), create: vi.fn(), patch: vi.fn(), createRate: vi.fn(), patchRate: vi.fn(), listRates: vi.fn() },
  shippersApi: { list: vi.fn() },
}))

const SHIPPER: Shipper = { id: 'shipper-1', name: 'Walmart', status: 'ACTIVE' }
const PENDING: Location = {
  id: 'loc-9', entity_type: 'SHIPPER', entity_id: 'shipper-1', site_number: null,
  name: 'Empresas Carozzi S.A.', country_code: 'CL', format: null, address: null,
  region_name: null, region_number: null, opens_at: null, closes_at: null,
  operation_type: null, operational_status: 'ACTIVE', is_manual_override: false,
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
    expect(screen.queryByText('Elegí un generador de carga')).not.toBeInTheDocument()
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
})
