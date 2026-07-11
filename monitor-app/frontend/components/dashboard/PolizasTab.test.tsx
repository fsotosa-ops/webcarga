import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'next/navigation'
import { PolizasTab } from './PolizasTab'
import { insuranceApi } from '@/lib/api/insurance'

vi.mock('next/navigation', () => ({ useSearchParams: vi.fn() }))
vi.mock('@/lib/api/insurance', () => ({
  insuranceApi: {
    summary: vi.fn(),
    kpis: vi.fn(),
    getForTransporter: vi.fn(),
    listPolicyDocuments: vi.fn(),
  },
}))

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PolizasTab canAdmin={true} canEdit={true} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams() as ReturnType<typeof useSearchParams>)
  vi.mocked(insuranceApi.summary).mockReset().mockResolvedValue({
    data: [{
      rut: '11111111-1', business_name: 'Transportes Al Día', transporter_id: 't1',
      policies_count: 1, next_due: null, overdue_count: 0, paid_pct: 100, insurance_ok: true,
    }],
  })
  vi.mocked(insuranceApi.kpis).mockReset().mockResolvedValue({ expiring_30d: 1, without_policies: 3, incomplete_docs: 2 })
})

describe('PolizasTab', () => {
  it('renders the donut, the actionable KPIs and the informational stats inside one panel', async () => {
    renderTab()
    await waitFor(() => expect(screen.getByText('Transportes Al Día')).toBeInTheDocument())
    expect(screen.getByText('Empresas con seguro al día')).toBeInTheDocument()
    expect(screen.getByText(/pólizas vencen en 30 días/)).toBeInTheDocument()
  })

  it('opens the InsurancePolicyModal when a company row is clicked', async () => {
    vi.mocked(insuranceApi.getForTransporter).mockResolvedValue({ rut: '11111111-1', transporter_id: 't1', policies: [] })
    renderTab()
    const row = await screen.findByText('Transportes Al Día')
    row.click()
    await waitFor(() => expect(insuranceApi.getForTransporter).toHaveBeenCalledWith('t1'))
  })
})
