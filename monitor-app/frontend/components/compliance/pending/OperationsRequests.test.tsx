import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/lib/api/certificationRequests', () => ({ certificationRequestsApi: { listOpen: vi.fn(), resolve: vi.fn() } }))
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: () => true }))

import { certificationRequestsApi } from '@/lib/api/certificationRequests'
import { QuickViewContext } from '@/components/dashboard/QuickViewProvider'
import { OperationsRequests } from './OperationsRequests'

describe('OperationsRequests', () => {
  // N2 (Entrega 1 de fichas): a quién se le pide y su empresa llevan a su vista rápida.
  it('N2: el conductor y la empresa del pedido son enlaces a su ficha', async () => {
    vi.mocked(certificationRequestsApi.listOpen).mockResolvedValue({ rows: [{
      id: 'q1', entity_type: 'DRIVER', entity_id: 'd1', entity_name: 'Vidal Soto, Pedro',
      carrier_id: 'c1', carrier_name: 'Transportes Andes', requirement_name: 'Licencia de conducir',
      created_by_name: 'Olga', created_at: '2026-10-15T10:00:00Z', closure_date: null, trip_number: null, note: null,
    }] } as never)
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <QuickViewContext.Provider value={vi.fn()}><OperationsRequests /></QuickViewContext.Provider>
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('link', { name: 'Ver conductor Vidal Soto, Pedro' })).toHaveAttribute('href', '/dashboard/drivers/d1')
    expect(screen.getByRole('link', { name: 'Ver empresa Transportes Andes' })).toHaveAttribute('href', '/dashboard/carriers/c1')
  })
})
