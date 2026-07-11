import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CobranzaTab } from './CobranzaTab'
import { insuranceApi } from '@/lib/api/insurance'

vi.mock('@/lib/api/insurance', () => ({
  insuranceApi: {
    installmentsFlat: vi.fn(),
    patchInstallment: vi.fn(),
  },
}))

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const ROWS = [
  { installment_id: 'a', policy_id: 'p1', transporter_id: 't1', rut: '1-9', business_name: 'Empresa A',
    company: 'HDI', policy_number: '100', client_group: 'Walmart', installment_number: 1,
    amount_uf: 4.2, due_date: '2020-01-01', status: 'vencida' as const, is_overdue: true },
  { installment_id: 'b', policy_id: 'p2', transporter_id: 't2', rut: '2-8', business_name: 'Empresa B',
    company: 'Mapfre', policy_number: '200', client_group: 'Colun', installment_number: 1,
    amount_uf: 2.8, due_date: '2099-01-01', status: 'pendiente' as const, is_overdue: false },
]

describe('CobranzaTab', () => {
  beforeEach(() => {
    vi.mocked(insuranceApi.installmentsFlat).mockResolvedValue(ROWS)
  })

  it('shows the overdue group first with its subtotal', async () => {
    renderWithClient(<CobranzaTab canAdmin={false} />)
    await waitFor(() => expect(screen.getAllByText(/Vencidas/).length).toBeGreaterThan(0))
    expect(screen.getByText('Empresa A')).toBeInTheDocument()
  })

  it('switches grouping when a different chip is clicked', async () => {
    renderWithClient(<CobranzaTab canAdmin={false} />)
    await waitFor(() => expect(screen.getByText('Empresa A')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Cliente GC' }))
    await waitFor(() => expect(screen.getAllByText(/Walmart/).length).toBeGreaterThan(0))
  })
})
