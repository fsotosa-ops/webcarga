import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

let search = ''
const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/dashboard/insurance/installments',
}))
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: () => true }))
vi.mock('@/lib/api/insurance', async orig => ({
  ...(await orig<object>()), insuranceApi: { listInstallments: vi.fn(), pay: vi.fn(), unpay: vi.fn(), carrier: vi.fn() },
}))

import { insuranceApi } from '@/lib/api/insurance'
import { QuickViewContext } from '@/components/dashboard/QuickViewProvider'
import CuotasPage from './page'
import InsuranceLayout from '../layout'

const CUOTA = {
  id: 'i1', policy_id: 'p1', carrier_id: 'c1', carrier_name: 'Transportes Aguilera Spa', insurance_company: 'SURA',
  policy_number: '8581440-RC', installment_number: 8, installments_total: 11, due_date: '2025-01-25', due_in_days: -628,
  amount_uf: 2.1, installment_state: 'OVERDUE', paid: false, paid_on: null, paid_by: null, outside_validity: false,
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <QuickViewContext.Provider value={vi.fn()}><InsuranceLayout><CuotasPage /></InsuranceLayout></QuickViewContext.Provider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  search = ''
  vi.mocked(insuranceApi.listInstallments).mockResolvedValue({
    data: [CUOTA], count: 150, page: 1, limit: 100, facets: { OVERDUE: 150, DUE_30: 12, PAID: 60, ALL: 294 },
  } as never)
})

describe('Seguros › Cuotas', () => {
  it('abre en las vencidas, de todas las pólizas, con empresa y póliza enlazadas', async () => {
    renderPage()
    await waitFor(() => expect(insuranceApi.listInstallments).toHaveBeenCalledWith(expect.objectContaining({ state: 'OVERDUE' })))
    const tabla = await screen.findByRole('table')
    expect(within(tabla).getByRole('link', { name: 'Ver empresa Transportes Aguilera Spa' })).toBeInTheDocument()
    expect(within(tabla).getByRole('link', { name: /SURA/ })).toHaveAttribute('href',
      `/dashboard/insurance/policies/p1?next=${encodeURIComponent('/dashboard/insurance/installments')}`)
    expect(within(screen.getByRole('group', { name: 'Cuotas' })).getByRole('button', { name: /^Vencidas/ })).toHaveTextContent('150')
  })

  it('cambia de filtro por la URL', async () => {
    renderPage()
    await screen.findByRole('table')
    fireEvent.click(within(screen.getByRole('group', { name: 'Cuotas' })).getByRole('button', { name: /^Próximos 30 días/ }))
    expect(replace).toHaveBeenCalledWith('/dashboard/insurance/installments?state=DUE_30', { scroll: false })
  })

  it('sin cuotas en el filtro lo dice, sin tabla vacía', async () => {
    vi.mocked(insuranceApi.listInstallments).mockResolvedValue({ data: [], count: 0, page: 1, limit: 100, facets: { OVERDUE: 0, DUE_30: 0, PAID: 0, ALL: 0 } } as never)
    renderPage()
    expect(await screen.findByText('No hay cuotas vencidas')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
