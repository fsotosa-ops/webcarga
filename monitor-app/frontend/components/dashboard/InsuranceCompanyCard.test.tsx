import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { InsuranceCompanyCard } from './InsuranceCompanyCard'
import { insuranceApi } from '@/lib/api/insurance'
import type { InsuranceSummaryRow, InsuranceTransporterResponse } from '@/lib/types'

vi.mock('@/lib/api/insurance', () => ({
  insuranceApi: {
    getForTransporter: vi.fn(),
    patchInstallment: vi.fn(),
    listPolicyDocuments: vi.fn(),
    uploadDocumentFile: vi.fn(),
  },
}))

const rowOk: InsuranceSummaryRow = {
  rut: '11111111-1', business_name: 'Transportes Al Día', transporter_id: 't1',
  policies_count: 2, next_due: { date: '2026-08-01', amount_uf: 4.5 }, overdue_count: 0,
  paid_pct: 80, insurance_ok: true,
}

const rowOverdue: InsuranceSummaryRow = {
  rut: '22222222-2', business_name: 'Transportes Vencido', transporter_id: 't2',
  policies_count: 1, next_due: null, overdue_count: 3,
  paid_pct: 20, insurance_ok: false,
}

const response: InsuranceTransporterResponse = {
  rut: '22222222-2', transporter_id: 't2',
  policies: [{
    id: 'p1', transporter_id: 't2', rut: '22222222-2', contractor_name: null, client_group: null,
    company: 'HDI Seguros', policy_number: '12345', endorsement: null, coverage: 'RC vehicular',
    plate: 'ABCD12', policy_type: 'rc_vehicular', valid_from: '2026-01-01', valid_to: '2026-12-31',
    payment_url: null, file_url: null, storage_path: null, updated_at: '2026-07-01T00:00:00Z',
    installments: [
      { id: 'i1', policy_id: 'p1', installment_number: 1, total_installments: 2, amount_uf: 4, due_date: '2020-01-01', status: 'vencida', paid_at: null, payment_url: null, manual_override: false, updated_at: '2026-07-01T00:00:00Z' },
      { id: 'i2', policy_id: 'p1', installment_number: 2, total_installments: 2, amount_uf: 4, due_date: '2026-09-01', status: 'pendiente', paid_at: null, payment_url: null, manual_override: false, updated_at: '2026-07-01T00:00:00Z' },
    ],
  }],
}

function renderCard(row: InsuranceSummaryRow, opts: { expanded?: boolean; canAdmin?: boolean; onToggle?: () => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <InsuranceCompanyCard
        row={row}
        expanded={opts.expanded ?? false}
        onToggle={opts.onToggle ?? vi.fn()}
        canAdmin={opts.canAdmin ?? false}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(insuranceApi.getForTransporter).mockReset().mockResolvedValue(response)
  vi.mocked(insuranceApi.patchInstallment).mockReset()
  vi.mocked(insuranceApi.listPolicyDocuments).mockReset().mockResolvedValue([
    {
      doc_code: 'poliza_firmada', label: 'Póliza firmada', has_expiry: false, id: 'd1',
      status: 'ok', expiry_date: null, file_url: null, storage_path: null,
      notes: null, manual_override: false, updated_at: '2026-07-01T00:00:00Z',
    },
  ])
  vi.mocked(insuranceApi.uploadDocumentFile).mockReset()
})

describe('InsuranceCompanyCard', () => {
  it('renders the collapsed header with an "Al día" badge when there are no overdue installments', () => {
    renderCard(rowOk)
    expect(screen.getByText('Transportes Al Día')).toBeInTheDocument()
    expect(screen.getByText('Al día')).toBeInTheDocument()
  })

  it('renders the collapsed header with a "N vencidas" badge when overdue_count > 0', () => {
    renderCard(rowOverdue)
    expect(screen.getByText('Transportes Vencido')).toBeInTheDocument()
    expect(screen.getByText('3 vencidas')).toBeInTheDocument()
  })

  it('shows a "Sin información" badge for a company with no policies', () => {
    renderCard({ ...rowOk, policies_count: 0, overdue_count: 0, next_due: null, paid_pct: null })
    expect(screen.getByText('Sin información')).toBeInTheDocument()
  })

  it('calls onToggle when the header is clicked', () => {
    const onToggle = vi.fn()
    renderCard(rowOk, { onToggle })
    fireEvent.click(screen.getByText('Transportes Al Día'))
    expect(onToggle).toHaveBeenCalled()
  })

  it('fetches and renders policies with a timeline node per installment when expanded', async () => {
    renderCard(rowOverdue, { expanded: true })
    expect(await screen.findByText('HDI Seguros')).toBeInTheDocument()
    expect(screen.getByText('#1')).toBeInTheDocument()
    expect(screen.getByText('#2')).toBeInTheDocument()
    // Vencida installment renders a "Pagar" action (disabled — not admin)
    expect(screen.getAllByRole('button', { name: /Pagar/i }).length).toBe(2)
  })

  it('fetches and renders the document checklist for a policy when expanded', async () => {
    renderCard(rowOverdue, { expanded: true })
    expect(await screen.findByText('Póliza firmada')).toBeInTheDocument()
    expect(insuranceApi.listPolicyDocuments).toHaveBeenCalledWith('p1')
  })

  it('uploads a document file and invalidates the checklist query for an admin', async () => {
    renderCard(rowOverdue, { expanded: true, canAdmin: true })
    await screen.findByText('Póliza firmada')
    const input = screen.getByLabelText('Subir Póliza firmada')
    const file = new File(['contenido'], 'poliza.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(insuranceApi.uploadDocumentFile).toHaveBeenCalledWith('p1', 'poliza_firmada', file))
    await waitFor(() => expect(insuranceApi.listPolicyDocuments).toHaveBeenCalledTimes(2))
  })

  it('shows a visible error below the checklist when the document upload fails', async () => {
    vi.mocked(insuranceApi.uploadDocumentFile).mockRejectedValue(new Error('Formato de archivo no permitido'))
    renderCard(rowOverdue, { expanded: true, canAdmin: true })
    await screen.findByText('Póliza firmada')
    const input = screen.getByLabelText('Subir Póliza firmada')
    const file = new File(['contenido'], 'poliza.exe', { type: 'application/octet-stream' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(await screen.findByText('Formato de archivo no permitido')).toBeInTheDocument()
  })

  it('disables "Pagar" for a non-admin user', async () => {
    renderCard(rowOverdue, { expanded: true, canAdmin: false })
    const btns = await screen.findAllByRole('button', { name: /Pagar/i })
    btns.forEach(b => expect(b).toBeDisabled())
  })

  it('enables "Pagar" for an admin and calls patchInstallment', async () => {
    vi.mocked(insuranceApi.patchInstallment).mockResolvedValue({
      id: 'i1', policy_id: 'p1', installment_number: 1, total_installments: 2, amount_uf: 4,
      due_date: '2020-01-01', status: 'pagada', paid_at: '2026-07-10', payment_url: null,
      manual_override: true, updated_at: '2026-07-10T00:00:00Z',
    })
    renderCard(rowOverdue, { expanded: true, canAdmin: true })
    const btns = await screen.findAllByRole('button', { name: /Pagar/i })
    expect(btns[0]).not.toBeDisabled()
    fireEvent.click(btns[0])
    await waitFor(() => expect(insuranceApi.patchInstallment).toHaveBeenCalledWith('i1', expect.objectContaining({ status: 'pagada' })))
  })

  it('shows a visible error next to the timeline node when the PATCH fails', async () => {
    vi.mocked(insuranceApi.patchInstallment).mockRejectedValue(new Error('La cuota fue modificada por otro usuario'))
    renderCard(rowOverdue, { expanded: true, canAdmin: true })
    const btns = await screen.findAllByRole('button', { name: /Pagar/i })
    fireEvent.click(btns[0])
    expect(await screen.findByText('La cuota fue modificada por otro usuario')).toBeInTheDocument()
  })

  it('shows a message when the company has no linked transporter profile', () => {
    renderCard({ ...rowOverdue, transporter_id: null }, { expanded: true })
    expect(screen.getByText(/no tiene ficha vinculada/)).toBeInTheDocument()
  })
})
