import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

let search = ''
const replace = vi.fn((url: string) => { search = url.split('?')[1] ?? '' })
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/dashboard/insurance',
}))
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: () => true }))
vi.mock('@/lib/api/insurance', () => ({ insuranceApi: { listPolicies: vi.fn(), listCarriers: vi.fn() } }))

import { insuranceApi } from '@/lib/api/insurance'
import { QuickViewContext } from '@/components/dashboard/QuickViewProvider'
import PolizasPage from './page'

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
      <QuickViewContext.Provider value={vi.fn()}><PolizasPage /></QuickViewContext.Provider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  search = ''
  vi.mocked(insuranceApi.listPolicies).mockResolvedValue({ group_by: 'policy', data: [POLIZA], count: 1, page: 1, limit: 50, facets: FACETS } as never)
  vi.mocked(insuranceApi.listCarriers).mockResolvedValue({
    group_by: 'carrier', count: 1, page: 1, limit: 50,
    facets: { total: 36, NO_POLICY: 18, EXPIRED: 5, EXPIRING: 0, VALID: 13, NO_DATES: 0 },
    data: [{ carrier_id: 'c9', carrier_name: 'Hasa Spa', carrier_tax_id: '77104928-1', operational_status: 'ACTIVE', policies: 0,
             worst_state: 'NO_POLICY', unpaid_installments: 0, overdue_installments: 0, next_due_date: null, insurance_alert: null }],
  } as never)
})

describe('Seguros › Pólizas', () => {
  it('la fila abre la ficha de la póliza, con la lista para volver; la empresa abre su vista rápida', async () => {
    renderPage()
    const tabla = await screen.findByRole('table')
    expect(within(tabla).getByRole('link', { name: /SURA/ })).toHaveAttribute('href', `/dashboard/insurance/policies/p1?next=${encodeURIComponent('/dashboard/insurance')}`)
    expect(within(tabla).getByRole('link', { name: 'Ver empresa Transportes Aguilera Spa' })).toHaveAttribute('href', '/dashboard/carriers/c1')
    expect(within(tabla).getByText('Venció el 22/05')).toBeInTheDocument()
    expect(within(tabla).getByText('11 vencidas')).toBeInTheDocument()
  })

  it('S13: agrupa por Póliza o Empresa con el control segmentado; por empresa aparecen las que no tienen póliza', async () => {
    renderPage()
    await screen.findByRole('table')
    const agrupar = screen.getByRole('group', { name: 'Agrupar por' })
    expect(within(agrupar).getByRole('button', { name: 'Póliza' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(agrupar).getByRole('button', { name: 'Empresa' }))
    expect(replace).toHaveBeenCalledWith('/dashboard/insurance?group=carrier', { scroll: false })
  })

  it('agrupada por empresa, la empresa sin póliza dice "Sin póliza" y los filtros cuentan con las cifras de la API', async () => {
    search = 'group=carrier'
    renderPage()
    const tabla = await screen.findByRole('table')
    expect(within(tabla).getByText('Sin póliza')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Estado' })).getByRole('button', { name: /Sin póliza/ })).toHaveTextContent('18')
  })

  it('la cabecera es la del kit y el buscador habla de RUT; sin "0" mientras carga', async () => {
    vi.mocked(insuranceApi.listPolicies).mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByPlaceholderText('Aseguradora, N° de póliza, empresa o RUT…')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Estado' })).getByRole('button', { name: /^Todas/ })).toHaveTextContent(/^Todas$/)
    vi.mocked(insuranceApi.listPolicies).mockResolvedValue({ group_by: 'policy', data: [POLIZA], count: 1, page: 1, limit: 50, facets: FACETS } as never)
  })

  it('filtrar por estado lo pide a la API', async () => {
    renderPage()
    await screen.findByRole('table')
    fireEvent.click(within(screen.getByRole('group', { name: 'Estado' })).getByRole('button', { name: /^Vencidas/ }))
    expect(replace).toHaveBeenCalledWith('/dashboard/insurance?state=EXPIRED', { scroll: false })
    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Póliza' }).className).not.toMatch(/uppercase/))
  })
})
