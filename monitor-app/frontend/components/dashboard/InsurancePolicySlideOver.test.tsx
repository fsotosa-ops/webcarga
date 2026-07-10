import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { InsurancePolicySlideOver } from './InsurancePolicySlideOver'
import { insuranceApi } from '@/lib/api/insurance'
import type { InsuranceSummaryRow, InsuranceTransporterResponse } from '@/lib/types'

vi.mock('@/lib/api/insurance', () => ({
  insuranceApi: {
    getForTransporter: vi.fn(),
    patchInstallment: vi.fn(),
    listPolicyFiles: vi.fn(),
    uploadPolicyFile: vi.fn(),
  },
}))

const row: InsuranceSummaryRow = {
  rut: '11111111-1', business_name: 'Transportes Test', transporter_id: 't1',
  policies_count: 1, next_due: { date: '2026-08-01', amount_uf: 4 }, overdue_count: 1,
  paid_pct: 50, insurance_ok: false,
}

const response: InsuranceTransporterResponse = {
  rut: '11111111-1', transporter_id: 't1',
  policies: [{
    id: 'p1', transporter_id: 't1', rut: '11111111-1', contractor_name: null, client_group: null,
    company: 'HDI Seguros', policy_number: '12345', endorsement: null, coverage: 'RC vehicular',
    plate: 'ABCD12', policy_type: 'rc_vehicular', valid_from: '2026-01-01', valid_to: '2026-12-31',
    payment_url: null, file_url: null, storage_path: null, updated_at: '2026-07-01T00:00:00Z',
    installments: [
      { id: 'i1', policy_id: 'p1', installment_number: 1, total_installments: 2, amount_uf: 4, due_date: '2026-08-01', status: 'pendiente', paid_at: null, payment_url: null, manual_override: false, updated_at: '2026-07-01T00:00:00Z' },
    ],
  }],
}

function renderSlideOver(canAdmin: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <InsurancePolicySlideOver row={row} canAdmin={canAdmin} onClose={vi.fn()} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(insuranceApi.getForTransporter).mockReset().mockResolvedValue(response)
  vi.mocked(insuranceApi.patchInstallment).mockReset()
})

describe('InsurancePolicySlideOver', () => {
  it('renders the policy and its installment', async () => {
    renderSlideOver(true)
    expect(await screen.findByText('HDI Seguros')).toBeInTheDocument()
    expect(screen.getByText(/Pendiente/)).toBeInTheDocument()
  })

  it('disables "Marcar pagada" for a non-admin user', async () => {
    renderSlideOver(false)
    const btn = await screen.findByRole('button', { name: /Marcar pagada/i }, { timeout: 10000 })
    expect(btn).toBeDisabled()
  })

  it('enables "Marcar pagada" for an admin and calls patchInstallment', async () => {
    vi.mocked(insuranceApi.patchInstallment).mockResolvedValue({
      id: 'i1', policy_id: 'p1', installment_number: 1, total_installments: 2, amount_uf: 4,
      due_date: '2026-08-01', status: 'pagada', paid_at: '2026-07-10', payment_url: null,
      manual_override: true, updated_at: '2026-07-10T00:00:00Z',
    })
    renderSlideOver(true)
    const btn = await screen.findByRole('button', { name: /Marcar pagada/i }, { timeout: 10000 })
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)
    await waitFor(() => expect(insuranceApi.patchInstallment).toHaveBeenCalledWith('i1', expect.objectContaining({ status: 'pagada' })))
  })

  it('shows a visible error next to the action when the PATCH fails', async () => {
    vi.mocked(insuranceApi.patchInstallment).mockRejectedValue(new Error('La cuota fue modificada por otro usuario'))
    renderSlideOver(true)
    const btn = await screen.findByRole('button', { name: /Marcar pagada/i }, { timeout: 10000 })
    fireEvent.click(btn)
    expect(await screen.findByText('La cuota fue modificada por otro usuario')).toBeInTheDocument()
  })
})
