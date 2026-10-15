import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

let search = ''
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/dashboard/drivers',
  useSearchParams: () => new URLSearchParams(search),
}))
vi.mock('@/lib/api/drivers', () => ({ driversApi: { list: vi.fn() } }))
vi.mock('@/lib/api/assets', () => ({ assetsApi: { list: vi.fn() } }))
vi.mock('@/hooks/useAssetTypes', () => ({ useAssetTypes: () => ({ types: [], labelOf: () => '' }) }))

import { driversApi } from '@/lib/api/drivers'
import { FleetList } from './FleetList'

const ROW = {
  id: 'd1', full_name: 'Vidal Soto, Pedro', tax_id: '12345678-5', license_plate: null, asset_type: null,
  operation_type: null, operational_status: 'ACTIVE', carrier: null,
  compliance_summary: { worst_state: 'MISSING', can_operate: false, own: { overdue: 0, expiring: 0, missing: 1 }, fleet: null },
}

function renderList() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FleetList kind="driver" />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(driversApi.list).mockResolvedValue({
    total: 1, rows: [ROW], facets: { all: 1, without_carrier: 1, inactive: 0, documents_pending: 1 },
  } as never)
})

describe('FleetList', () => {
  it('E3: filtrando por documentos (la cola de Certificación) la fila abre la ficha en la pestaña Documentos', async () => {
    search = 'documents=pending'
    renderList()
    expect(await screen.findByRole('link', { name: 'Vidal Soto, Pedro' }))
      .toHaveAttribute('href', '/dashboard/drivers/d1?tab=documentos')
  })
})
