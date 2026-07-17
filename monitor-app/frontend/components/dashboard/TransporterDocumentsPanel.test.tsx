import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TransporterDocumentsPanel } from './TransporterDocumentsPanel'
import { complianceApi } from '@/lib/api/compliance'
import type { ComplianceRecord } from '@/lib/types'

vi.mock('@/lib/api/compliance', () => ({
  complianceApi: {
    patch:      vi.fn(),
    uploadFile: vi.fn(),
    listFiles:  vi.fn(),
  },
}))

const RECORDS: ComplianceRecord[] = [
  {
    id: 'cr1', requirement_id: 'req1', requirement_code: 'ROL_SII', name: 'Rol SII',
    requirement_level: 'LEGAL_MANDATORY', requires_file: true, status: 'APPROVED',
    expiration_date: null, file_url: null, metadata: {}, is_manual_override: false,
    is_expired: false, is_expiring_soon: false, updated_at: null,
  },
  {
    id: 'cr2', requirement_id: 'req2', requirement_code: 'F30', name: 'F30',
    requirement_level: 'LEGAL_MANDATORY', requires_file: true, status: 'PENDING_REVIEW',
    expiration_date: '2026-01-01', file_url: null, metadata: {}, is_manual_override: true,
    is_expired: true, is_expiring_soon: false, updated_at: null,
  },
]

beforeEach(() => {
  vi.mocked(complianceApi.patch).mockReset()
  vi.mocked(complianceApi.uploadFile).mockReset()
  vi.mocked(complianceApi.listFiles).mockReset().mockResolvedValue([])
})

describe('TransporterDocumentsPanel', () => {
  it('shows every record as a row, always visible (no collapse toggle)', () => {
    render(<TransporterDocumentsPanel records={RECORDS} canEdit={false} onChanged={vi.fn()} />)
    expect(screen.getByText('Rol SII')).toBeInTheDocument()
    expect(screen.getByText('F30')).toBeInTheDocument()
  })

  it('shows a manual-override badge for records edited by hand', () => {
    render(<TransporterDocumentsPanel records={RECORDS} canEdit={false} onChanged={vi.fn()} />)
    expect(screen.getByTitle('Editado manualmente — el pipeline no lo sobreescribe')).toBeInTheDocument()
  })

  it('changes status via the select and reports the update', async () => {
    vi.mocked(complianceApi.patch).mockResolvedValue({ ...RECORDS[0], status: 'PENDING_REVIEW' } as never)
    const onChanged = vi.fn()
    render(<TransporterDocumentsPanel records={RECORDS} canEdit={true} onChanged={onChanged} />)
    fireEvent.change(screen.getByLabelText('Estado de Rol SII'), { target: { value: 'PENDING_REVIEW' } })
    await waitFor(() => expect(complianceApi.patch).toHaveBeenCalledWith('cr1', { status: 'PENDING_REVIEW' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('lets an editor set the expiration date for a record without one yet', async () => {
    vi.mocked(complianceApi.patch).mockResolvedValue({ ...RECORDS[0], expiration_date: '2027-01-01' } as never)
    const onChanged = vi.fn()
    render(<TransporterDocumentsPanel records={RECORDS} canEdit={true} onChanged={onChanged} />)
    fireEvent.change(screen.getByLabelText('Fecha de vencimiento de Rol SII'), { target: { value: '2027-01-01' } })
    await waitFor(() => expect(complianceApi.patch).toHaveBeenCalledWith('cr1', { expiration_date: '2027-01-01' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('does not offer to edit the expiration date when canEdit is false', () => {
    render(<TransporterDocumentsPanel records={RECORDS} canEdit={false} onChanged={vi.fn()} />)
    expect(screen.queryByLabelText('Fecha de vencimiento de Rol SII')).not.toBeInTheDocument()
  })

  it('uploads a file via the upload control for requires_file records', async () => {
    vi.mocked(complianceApi.uploadFile).mockResolvedValue({
      status: 'PENDING_REVIEW', storage_path: 'x/y', file_name: 'f30.pdf',
      mime_type: 'application/pdf', size_bytes: 100,
    })
    const onChanged = vi.fn()
    render(<TransporterDocumentsPanel records={RECORDS} canEdit={true} onChanged={onChanged} />)
    const file = new File(['x'], 'f30.pdf', { type: 'application/pdf' })
    const fileInputs = document.querySelectorAll('input[type="file"]')
    fireEvent.change(fileInputs[0], { target: { files: [file] } })
    await waitFor(() => expect(complianceApi.uploadFile).toHaveBeenCalledWith('cr1', file))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('renders document version history with status + replaced date', async () => {
    vi.mocked(complianceApi.listFiles).mockResolvedValue([
      {
        storage_path: 'compliance_record:cr1/old.pdf',
        status: 'REJECTED',
        expiry_date: null,
        replaced_at: '2026-06-01T14:23:11.123456+00:00',
        replaced_by: 'admin@webcarga.cl',
        url: 'https://signed.example.com/old.pdf',
      },
    ])
    render(<TransporterDocumentsPanel records={RECORDS} canEdit={true} onChanged={vi.fn()} />)
    fireEvent.click(screen.getAllByTitle('Ver archivo / versiones')[0])
    await waitFor(() => expect(complianceApi.listFiles).toHaveBeenCalledWith('cr1'))
    const entry = await screen.findByText(/REJECTED · reemplazado/)
    expect(entry.textContent).not.toMatch(/undefined/)
    expect(entry.textContent).toContain('01-06-26')
  })

  it('shows a "Ver archivo" link for a non-editor when file_url is set', () => {
    const withLink = [{ ...RECORDS[0], file_url: 'https://example.com/doc.pdf' }]
    render(<TransporterDocumentsPanel records={withLink} canEdit={false} onChanged={vi.fn()} />)
    expect(screen.getByRole('link', { name: /Ver archivo/ })).toHaveAttribute('href', 'https://example.com/doc.pdf')
  })

  it('does not show upload controls for records that do not require a file', () => {
    const noFile = [{ ...RECORDS[0], requires_file: false }]
    render(<TransporterDocumentsPanel records={noFile} canEdit={true} onChanged={vi.fn()} />)
    expect(screen.queryByTitle('Subir archivo')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Estado de Rol SII')).toBeInTheDocument()
  })
})
