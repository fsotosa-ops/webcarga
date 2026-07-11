import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { InsurancePolicyModal } from './InsurancePolicyModal'
import { insuranceApi } from '@/lib/api/insurance'
import type { InsuranceSummaryRow, InsuranceTransporterResponse } from '@/lib/types'

vi.mock('@/lib/api/insurance', () => ({
  insuranceApi: {
    getForTransporter:  vi.fn(),
    patchInstallment:   vi.fn(),
    revertInstallment:  vi.fn(),
    listPolicyDocuments: vi.fn(),
    uploadDocumentFile:  vi.fn(),
  },
}))

const ROW: InsuranceSummaryRow = {
  rut: '22222222-2', business_name: 'Transportes Vencido', transporter_id: 't2',
  policies_count: 2, next_due: null, overdue_count: 1, paid_pct: 50, insurance_ok: false,
}

const TWO_POLICIES: InsuranceTransporterResponse = {
  rut: '22222222-2', transporter_id: 't2',
  policies: [
    {
      id: 'p1', transporter_id: 't2', rut: '22222222-2', contractor_name: null, client_group: null,
      company: 'Chubb Generales', policy_number: '5663040', endorsement: null, coverage: 'RC vehicular',
      plate: null, policy_type: 'otro', valid_from: '2026-03-23', valid_to: '2027-03-23',
      payment_url: null, file_url: null, storage_path: null, updated_at: '2026-07-01T00:00:00Z',
      installments: [
        { id: 'i1', policy_id: 'p1', installment_number: 1, total_installments: 2, amount_uf: 4, due_date: '2020-01-01', status: 'vencida', paid_at: null, payment_url: null, manual_override: false, updated_at: '2026-07-01T00:00:00Z' },
        { id: 'i2', policy_id: 'p1', installment_number: 2, total_installments: 2, amount_uf: 4, due_date: '2099-09-01', status: 'pendiente', paid_at: null, payment_url: null, manual_override: false, updated_at: '2026-07-01T00:00:00Z' },
      ],
    },
    {
      id: 'p2', transporter_id: 't2', rut: '22222222-2', contractor_name: null, client_group: null,
      company: 'HDI', policy_number: '89632', endorsement: null, coverage: 'RC vehicular',
      plate: null, policy_type: 'otro', valid_from: null, valid_to: null,
      payment_url: null, file_url: null, storage_path: null, updated_at: '2026-07-01T00:00:00Z',
      installments: [
        { id: 'i3', policy_id: 'p2', installment_number: 1, total_installments: 1, amount_uf: 2.5, due_date: '2026-05-01', status: 'pagada', paid_at: '2026-05-01', payment_url: null, manual_override: false, updated_at: '2026-07-01T00:00:00Z' },
      ],
    },
  ],
}

function renderModal(row: InsuranceSummaryRow | null, opts: { canAdmin?: boolean; canEdit?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <InsurancePolicyModal row={row} onClose={vi.fn()} canAdmin={opts.canAdmin ?? true} canEdit={opts.canEdit ?? true} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(insuranceApi.getForTransporter).mockReset().mockResolvedValue(TWO_POLICIES)
  vi.mocked(insuranceApi.listPolicyDocuments).mockReset().mockResolvedValue([
    { doc_code: 'poliza_firmada', label: 'Póliza firmada', has_expiry: false, id: 'd1', status: 'ok', expiry_date: null, file_url: null, storage_path: null, notes: null, manual_override: false, updated_at: '2026-07-01T00:00:00Z' },
  ])
  vi.mocked(insuranceApi.uploadDocumentFile).mockReset()
  vi.mocked(insuranceApi.patchInstallment).mockReset()
  vi.mocked(insuranceApi.revertInstallment).mockReset()
})

describe('InsurancePolicyModal', () => {
  it('renders no dialog content when row is null', () => {
    renderModal(null)
    expect(screen.queryByText('Chubb Generales')).not.toBeInTheDocument()
  })

  it('shows a policy switcher when the company has more than one policy', async () => {
    renderModal(ROW)
    expect(await screen.findByText('Chubb Generales')).toBeInTheDocument()
    expect(screen.getByText('Pólizas (2)')).toBeInTheDocument()
    expect(screen.getByText('HDI')).toBeInTheDocument()
  })

  it('spotlights the oldest overdue installment as "próxima cuota"', async () => {
    renderModal(ROW)
    await screen.findByText('Chubb Generales')
    expect(screen.getByText('Próxima cuota')).toBeInTheDocument()
    expect(screen.getByText(/Cuota 1 de 2/)).toBeInTheDocument()
  })

  it('switches the selected policy when clicking another one in the list', async () => {
    renderModal(ROW)
    await screen.findByText('Chubb Generales')
    fireEvent.click(screen.getByText('HDI'))
    await waitFor(() => expect(screen.getByText('Póliza 89632')).toBeInTheDocument())
    // HDI solo tiene una cuota, ya pagada — no hay "próxima cuota" que destacar
    expect(screen.queryByText('Próxima cuota')).not.toBeInTheDocument()
  })

  it('expands the full installment list when "Ver todas las cuotas" is clicked', async () => {
    renderModal(ROW)
    await screen.findByText('Chubb Generales')
    fireEvent.click(screen.getByText(/Ver todas las cuotas \(2\)/))
    expect(await screen.findByText(/Cuota 2 de 2/)).toBeInTheDocument()
  })

  it('fetches and renders the document checklist for the selected policy', async () => {
    renderModal(ROW)
    await screen.findByText('Chubb Generales')
    expect(await screen.findByText('Póliza firmada')).toBeInTheDocument()
    expect(insuranceApi.listPolicyDocuments).toHaveBeenCalledWith('p1')
  })

  it('shows a message when the company has no linked transporter profile', () => {
    renderModal({ ...ROW, transporter_id: null })
    expect(screen.getByText(/no tiene ficha vinculada/)).toBeInTheDocument()
  })
})
