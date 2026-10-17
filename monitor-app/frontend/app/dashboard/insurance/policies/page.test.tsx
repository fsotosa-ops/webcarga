import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

let search = ''
const replace = vi.fn((url: string) => { search = url.split('?')[1] ?? '' })
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/dashboard/insurance/policies',
}))
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: () => true }))
vi.mock('@/lib/api/insurance', async orig => ({
  ...(await orig<object>()), insuranceApi: { listPolicies: vi.fn(), carrier: vi.fn() },
}))

import { insuranceApi } from '@/lib/api/insurance'
import { QuickViewContext } from '@/components/dashboard/QuickViewProvider'
import PolizasPage from './page'
import InsuranceLayout from '../layout'

const POLIZA = {
  id: 'p1', carrier_id: 'c1', carrier_name: 'Transportes Aguilera Spa', carrier_tax_id: '77573544-9',
  insurance_company: 'SURA', policy_number: '8581440-RC', valid_from: '2025-05-22', valid_to: '2026-05-22',
  has_file: false, policy_state: 'EXPIRED', expires_in_days: -146, installments_total: 11, paid_installments: 0,
  unpaid_installments: 11, overdue_installments: 11, next_due_date: '2024-06-25', has_outside_validity: true,
}
const FACETS = { total: 33, EXPIRED: 9, EXPIRING: 2, VALID: 21, NO_DATES: 1, CANCELLED: 0, RENEWED: 0, UNPAID: 17, NO_FILE: 32 }

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <QuickViewContext.Provider value={vi.fn()}><InsuranceLayout><PolizasPage /></InsuranceLayout></QuickViewContext.Provider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  search = ''
  vi.mocked(insuranceApi.listPolicies).mockResolvedValue({ data: [POLIZA], count: 1, page: 1, limit: 50, facets: FACETS } as never)
  vi.mocked(insuranceApi.carrier).mockResolvedValue({ summary: null, policies: [] })
})

describe('Seguros › Pólizas', () => {
  it('la bajada cuenta en singular cuando hay una sola póliza', async () => {
    vi.mocked(insuranceApi.listPolicies).mockResolvedValue({ data: [POLIZA], count: 1, page: 1, limit: 50, facets: { ...FACETS, total: 1 } } as never)
    renderPage()
    expect(await screen.findByText('1 póliza')).toBeInTheDocument()
  })

  it('la fila abre la ficha de la póliza, con la lista para volver', async () => {
    renderPage()
    const tabla = await screen.findByRole('table')
    expect(within(tabla).getByRole('link', { name: /SURA/ })).toHaveAttribute('href', `/dashboard/insurance/policies/p1?next=${encodeURIComponent('/dashboard/insurance/policies')}`)
    expect(within(tabla).getByText('Venció el 22/05')).toBeInTheDocument()
    expect(within(tabla).getByText('11 vencidas')).toBeInTheDocument()
  })

  it('la empresa abre su panel de Seguros, el mismo que en Empresas (E8)', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('link', { name: 'Ver empresa Transportes Aguilera Spa' }))
    expect(await screen.findByRole('dialog', { name: 'Transportes Aguilera Spa' })).toBeInTheDocument()
    expect(insuranceApi.carrier).toHaveBeenCalledWith('c1')
  })

  it('es siempre la lista por póliza: no hay "Agrupar por" (la vista por empresa es Seguros › Empresas)', async () => {
    search = 'group=carrier'
    renderPage()
    await screen.findByRole('table')
    expect(screen.queryByRole('group', { name: 'Agrupar por' })).toBeNull()
    expect(insuranceApi.listPolicies).toHaveBeenCalled()
  })

  it('la cabecera es la del kit y el buscador habla de RUT; sin "0" mientras carga', async () => {
    vi.mocked(insuranceApi.listPolicies).mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByPlaceholderText('Aseguradora, N° de póliza, empresa o RUT…')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Estado' })).getByRole('button', { name: /^Todas/ })).toHaveTextContent(/^Todas$/)
    vi.mocked(insuranceApi.listPolicies).mockResolvedValue({ data: [POLIZA], count: 1, page: 1, limit: 50, facets: FACETS } as never)
  })

  it('filtrar por estado lo pide a la API', async () => {
    renderPage()
    await screen.findByRole('table')
    fireEvent.click(within(screen.getByRole('group', { name: 'Estado' })).getByRole('button', { name: /^Vencidas/ }))
    expect(replace).toHaveBeenCalledWith('/dashboard/insurance/policies?state=EXPIRED', { scroll: false })
    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Póliza' }).className).not.toMatch(/uppercase/))
  })
})
