import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BulkDocumentUploadModal } from './BulkDocumentUploadModal'
import { complianceApi } from '@/lib/api/compliance'
import type { PendingComplianceRow, BulkUploadResult } from '@/lib/types'

vi.mock('@/lib/api/compliance', () => ({
  complianceApi: { bulkUploadFile: vi.fn() },
}))

function makeSlot(overrides: Partial<PendingComplianceRow> = {}): PendingComplianceRow {
  return {
    id: 'r1', carrier_id: 'c1', carrier_name: 'Transportes Sur Spa', carrier_tax_id: '76.111.111-1',
    carrier_operation_types: ['Tractoreo'], certification_type: 'BASICA', category: 'CHOFER',
    entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Perez',
    requirement_code: 'LICENCIA_CONDUCIR', document_name: 'Licencia conducir',
    status: 'MISSING', expiration_date: null,
    ...overrides,
  }
}

const SLOTS = [
  makeSlot({ id: 'r1', document_name: 'Licencia conducir', subject_name: 'Juan Perez' }),
  makeSlot({ id: 'r2', document_name: 'Padrón', subject_name: 'ABCD12', category: 'EQUIPO' }),
]

function renderModal(props: Partial<Parameters<typeof BulkDocumentUploadModal>[0]> = {}) {
  return render(
    <BulkDocumentUploadModal
      open carrierId="c1" carrierName="Transportes Sur Spa" carrierTaxId="76.111.111-1"
      pendingSlots={SLOTS} onClose={vi.fn()} onSaved={vi.fn()}
      {...props}
    />,
  )
}

beforeEach(() => {
  vi.mocked(complianceApi.bulkUploadFile).mockReset()
})

describe('BulkDocumentUploadModal', () => {
  it('renders nothing when open=false', () => {
    renderModal({ open: false })
    expect(screen.queryByText('Subir masivo')).not.toBeInTheDocument()
  })

  it('shows the company name and tax id in the header', () => {
    renderModal()
    expect(screen.getByText(/Transportes Sur Spa — 76.111.111-1|76\.111\.111-1/)).toBeInTheDocument()
  })

  it('adding a file via the hidden input stages it with an auto-assigned free slot', async () => {
    renderModal()
    const file = new File(['x'], 'licencia.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Archivos a subir'), { target: { files: [file] } })
    expect(await screen.findByText('licencia.pdf')).toBeInTheDocument()
    expect(screen.getByLabelText('Documento correspondiente a licencia.pdf')).toHaveValue('r1')
  })

  it('adding two files auto-assigns each to a different free slot', async () => {
    renderModal()
    const f1 = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    const f2 = new File(['y'], 'b.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Archivos a subir'), { target: { files: [f1, f2] } })
    await screen.findByText('a.pdf')
    expect(screen.getByLabelText('Documento correspondiente a a.pdf')).toHaveValue('r1')
    expect(screen.getByLabelText('Documento correspondiente a b.pdf')).toHaveValue('r2')
  })

  it('shows a warning and keeps GUARDAR usable when a 3rd file has no free slot left (unassigned)', async () => {
    renderModal()
    const files = [
      new File(['a'], 'a.pdf', { type: 'application/pdf' }),
      new File(['b'], 'b.pdf', { type: 'application/pdf' }),
      new File(['c'], 'c.pdf', { type: 'application/pdf' }),
    ]
    fireEvent.change(screen.getByLabelText('Archivos a subir'), { target: { files } })
    await screen.findByText('c.pdf')
    expect(screen.getByLabelText('Documento correspondiente a c.pdf')).toHaveValue('')
    expect(screen.getByText(/1 archivo sin documento asignado/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /GUARDAR/ })).toBeEnabled()
  })

  it('disables GUARDAR when there are files but none assigned', async () => {
    renderModal({ pendingSlots: [] })
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Archivos a subir'), { target: { files: [file] } })
    await screen.findByText('a.pdf')
    expect(screen.getByRole('button', { name: /GUARDAR/ })).toBeDisabled()
  })

  it('removing a staged file drops it from the list', async () => {
    renderModal()
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Archivos a subir'), { target: { files: [file] } })
    await screen.findByText('a.pdf')
    fireEvent.click(screen.getByLabelText('Quitar a.pdf'))
    expect(screen.queryByText('a.pdf')).not.toBeInTheDocument()
  })

  it('GUARDAR calls bulkUploadFile with only the assigned pairs and shows the result', async () => {
    const result: BulkUploadResult = {
      uploaded: [{ record_id: 'r1', status: 'APPROVED_MANUAL', file_name: 'a.pdf', storage_path: 'x', mime_type: 'application/pdf', size_bytes: 1 }],
      errors: [],
    }
    vi.mocked(complianceApi.bulkUploadFile).mockResolvedValue(result)
    const onSaved = vi.fn()
    renderModal({ onSaved })
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Archivos a subir'), { target: { files: [file] } })
    await screen.findByText('a.pdf')
    fireEvent.click(screen.getByRole('button', { name: /GUARDAR/ }))
    await waitFor(() => expect(complianceApi.bulkUploadFile).toHaveBeenCalledWith('c1', [{ recordId: 'r1', file }]))
    expect(await screen.findByText('1 documento subido')).toBeInTheDocument()
    expect(onSaved).toHaveBeenCalledWith(result)
  })

  it('shows partial errors without discarding the successful uploads', async () => {
    const result: BulkUploadResult = {
      uploaded: [{ record_id: 'r1', status: 'APPROVED_MANUAL', file_name: 'a.pdf', storage_path: 'x', mime_type: 'application/pdf', size_bytes: 1 }],
      errors: [{ record_id: 'r2', file_name: 'b.exe', error: 'Tipo de archivo no permitido' }],
    }
    vi.mocked(complianceApi.bulkUploadFile).mockResolvedValue(result)
    renderModal()
    const f1 = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    const f2 = new File(['y'], 'b.exe', { type: 'application/x-msdownload' })
    fireEvent.change(screen.getByLabelText('Archivos a subir'), { target: { files: [f1, f2] } })
    await screen.findByText('a.pdf')
    fireEvent.click(screen.getByRole('button', { name: /GUARDAR/ }))
    expect(await screen.findByText('1 documento subido')).toBeInTheDocument()
    expect(screen.getByText('1 con error')).toBeInTheDocument()
    expect(screen.getByText('Tipo de archivo no permitido')).toBeInTheDocument()
  })

  it('clicking Cancelar calls onClose', () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onClose).toHaveBeenCalled()
  })
})
