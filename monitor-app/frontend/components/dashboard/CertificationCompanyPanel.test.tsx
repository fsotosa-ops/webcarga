import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CertificationCompanyPanel } from './CertificationCompanyPanel'
import { complianceApi } from '@/lib/api/compliance'
import type { PendingComplianceRow } from '@/lib/types'

vi.mock('@/lib/api/compliance', () => ({
  complianceApi: { listPending: vi.fn(), uploadFile: vi.fn(), bulkUploadFile: vi.fn() },
}))

function makeRow(overrides: Partial<PendingComplianceRow> = {}): PendingComplianceRow {
  return {
    id: 'r1', carrier_id: 'c1', carrier_name: 'Agrocapilla Ltda', carrier_tax_id: '76217085-K',
    carrier_operation_types: ['Tractoreo'], certification_type: 'BASICA', category: 'EMPRESA',
    entity_type: 'CARRIER', entity_id: 'c1', subject_name: null,
    requirement_code: 'POLIZA', document_name: 'Póliza de Seguro Vigente',
    status: 'MISSING', expiration_date: null,
    ...overrides,
  }
}

function renderPanel(carrierId: string | null, onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CertificationCompanyPanel carrierId={carrierId} onClose={onClose} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(complianceApi.listPending).mockReset().mockResolvedValue({ total: 1, rows: [makeRow()] })
  vi.mocked(complianceApi.uploadFile).mockReset()
})

describe('CertificationCompanyPanel', () => {
  it('renders nothing when carrierId is null', () => {
    renderPanel(null)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the company name, tax id and pending documents', async () => {
    renderPanel('c1')
    expect(await screen.findByText('Agrocapilla Ltda')).toBeInTheDocument()
    expect(screen.getByText('76217085-K')).toBeInTheDocument()
    expect(screen.getByText('Póliza de Seguro Vigente')).toBeInTheDocument()
  })

  it('fetches all pending rows for that carrier via listPending', async () => {
    renderPanel('c1')
    await screen.findByText('Póliza de Seguro Vigente')
    expect(complianceApi.listPending).toHaveBeenCalledWith({ carrierId: 'c1', limit: 200 })
  })

  it('uploads a file via the per-row control', async () => {
    renderPanel('c1')
    await screen.findByText('Póliza de Seguro Vigente')
    const file = new File(['x'], 'poliza.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Subir Póliza de Seguro Vigente'), { target: { files: [file] } })
    await waitFor(() => expect(complianceApi.uploadFile).toHaveBeenCalledWith('r1', file))
  })

  it('shows "Sin documentos pendientes" when there are none', async () => {
    vi.mocked(complianceApi.listPending).mockResolvedValue({ total: 0, rows: [] })
    renderPanel('c1')
    expect(await screen.findByText('Sin documentos pendientes')).toBeInTheDocument()
  })

  it('opens the bulk upload modal scoped to this carrier', async () => {
    renderPanel('c1')
    await screen.findByText('Póliza de Seguro Vigente')
    fireEvent.click(screen.getByRole('button', { name: 'Subir masivo' }))
    expect(await screen.findByText('Empresa Agrocapilla Ltda — 76217085-K')).toBeInTheDocument()
  })

  it('disables "Subir masivo" when there are no pending rows', async () => {
    vi.mocked(complianceApi.listPending).mockResolvedValue({ total: 0, rows: [] })
    renderPanel('c1')
    await screen.findByText('Sin documentos pendientes')
    expect(screen.getByRole('button', { name: 'Subir masivo' })).toBeDisabled()
  })

  it('links to the full carrier ficha', async () => {
    renderPanel('c1')
    await screen.findByText('Póliza de Seguro Vigente')
    expect(screen.getByRole('link', { name: /Ver ficha completa/ })).toHaveAttribute('href', '/dashboard/carriers/c1')
  })

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn()
    renderPanel('c1', onClose)
    await screen.findByText('Póliza de Seguro Vigente')
    fireEvent.click(screen.getByLabelText('Cerrar'))
    expect(onClose).toHaveBeenCalled()
  })
})
