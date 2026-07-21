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
    deleteFile: vi.fn(),
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
    requirement_level: 'LEGAL_MANDATORY', requires_file: true, status: 'REJECTED',
    expiration_date: '2026-01-01', file_url: null, metadata: {}, is_manual_override: true,
    is_expired: true, is_expiring_soon: false, updated_at: null,
  },
]

beforeEach(() => {
  vi.mocked(complianceApi.patch).mockReset()
  vi.mocked(complianceApi.uploadFile).mockReset()
  vi.mocked(complianceApi.listFiles).mockReset().mockResolvedValue([])
  vi.mocked(complianceApi.deleteFile).mockReset()
})

describe('TransporterDocumentsPanel', () => {
  it('shows every record as a row, always visible (no collapse toggle)', () => {
    render(<TransporterDocumentsPanel records={RECORDS} canEdit={false} onChanged={vi.fn()} />)
    expect(screen.getByText('Rol SII')).toBeInTheDocument()
    expect(screen.getByText('F30')).toBeInTheDocument()
  })

  it('does not offer PENDING_REVIEW as a selectable status (no due diligence step today)', () => {
    render(<TransporterDocumentsPanel records={RECORDS} canEdit={true} onChanged={vi.fn()} />)
    const select = screen.getByLabelText('Estado de Rol SII') as HTMLSelectElement
    const values = Array.from(select.options).map(o => o.value)
    expect(values).not.toContain('PENDING_REVIEW')
  })

  it('changes status via the select and reports the update', async () => {
    vi.mocked(complianceApi.patch).mockResolvedValue({ ...RECORDS[0], status: 'REJECTED' } as never)
    const onChanged = vi.fn()
    render(<TransporterDocumentsPanel records={RECORDS} canEdit={true} onChanged={onChanged} />)
    fireEvent.change(screen.getByLabelText('Estado de Rol SII'), { target: { value: 'REJECTED' } })
    await waitFor(() => expect(complianceApi.patch).toHaveBeenCalledWith('cr1', { status: 'REJECTED' }))
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

  it('labels the expiration date so it is clear what it means', () => {
    render(<TransporterDocumentsPanel records={RECORDS} canEdit={false} onChanged={vi.fn()} />)
    expect(screen.getByText('Vence:')).toBeInTheDocument()
  })

  it('does not offer to edit the expiration date when canEdit is false', () => {
    render(<TransporterDocumentsPanel records={RECORDS} canEdit={false} onChanged={vi.fn()} />)
    expect(screen.queryByLabelText('Fecha de vencimiento de Rol SII')).not.toBeInTheDocument()
  })

  it('shows a prominent upload CTA for a MISSING record instead of just a small icon', () => {
    const missing = [{ ...RECORDS[0], status: 'MISSING' as const }]
    render(<TransporterDocumentsPanel records={missing} canEdit={true} onChanged={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Subir documento/ })).toBeInTheDocument()
  })

  it('does not show the prominent CTA once a file exists — shows the small "Reemplazar" trigger instead', () => {
    const withFile = [{ ...RECORDS[0], file_url: 'https://example.com/doc.pdf' }]
    render(<TransporterDocumentsPanel records={withFile} canEdit={true} onChanged={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Subir documento/ })).not.toBeInTheDocument()
    expect(screen.getByTitle('Reemplazar archivo')).toBeInTheDocument()
  })

  it('uploads a file via the upload control for requires_file records', async () => {
    vi.mocked(complianceApi.uploadFile).mockResolvedValue({
      status: 'APPROVED_MANUAL', storage_path: 'x/y', file_name: 'f30.pdf',
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
        is_current: false,
      },
    ])
    render(<TransporterDocumentsPanel records={RECORDS} canEdit={true} onChanged={vi.fn()} />)
    fireEvent.click(screen.getAllByTitle('Ver historial de versiones')[0])
    await waitFor(() => expect(complianceApi.listFiles).toHaveBeenCalledWith('cr1'))
    const entry = await screen.findByText(/REJECTED · reemplazado/)
    expect(entry.textContent).not.toMatch(/undefined/)
    expect(entry.textContent).toContain('01-06-26')
  })

  it('renders the current (never-replaced) version as "vigente", not "reemplazado"', async () => {
    // Bug real corregido 2026-07-21: un documento subido una sola vez no
    // aparecía en su propio historial. Ahora aparece con is_current=true.
    vi.mocked(complianceApi.listFiles).mockResolvedValue([
      {
        storage_path: 'compliance_record:cr1/current.pdf',
        status: 'APPROVED_MANUAL',
        expiry_date: null,
        replaced_at: null,
        replaced_by: null,
        url: 'https://signed.example.com/current.pdf',
        is_current: true,
      },
    ])
    render(<TransporterDocumentsPanel records={RECORDS} canEdit={true} onChanged={vi.fn()} />)
    fireEvent.click(screen.getAllByTitle('Ver historial de versiones')[0])
    await waitFor(() => expect(complianceApi.listFiles).toHaveBeenCalledWith('cr1'))
    const entry = await screen.findByText(/APPROVED_MANUAL · vigente/)
    expect(entry).toBeInTheDocument()
  })

  it('shows a "Ver archivo" trigger for a non-editor when file_url is set', () => {
    const withLink = [{ ...RECORDS[0], file_url: 'https://example.com/doc.pdf' }]
    render(<TransporterDocumentsPanel records={withLink} canEdit={false} onChanged={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Ver archivo/ })).toBeInTheDocument()
  })

  it('shows the "Ver archivo" trigger alongside the status select for an editor when file_url is set', () => {
    const withLink = [{ ...RECORDS[0], file_url: 'https://example.com/doc.pdf' }]
    render(<TransporterDocumentsPanel records={withLink} canEdit={true} onChanged={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Ver archivo/ })).toBeInTheDocument()
    expect(screen.getByLabelText('Estado de Rol SII')).toBeInTheDocument()
  })

  it('opens the preview modal when clicking "Ver archivo"', () => {
    const withLink = [{ ...RECORDS[0], file_url: 'https://example.com/doc.pdf' }]
    render(<TransporterDocumentsPanel records={withLink} canEdit={false} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Ver archivo/ }))
    expect(screen.getByLabelText('Cerrar')).toBeInTheDocument()
  })

  it('does not offer delete inside the preview modal for a non-editor', () => {
    const withLink = [{ ...RECORDS[0], file_url: 'https://example.com/doc.pdf' }]
    render(<TransporterDocumentsPanel records={withLink} canEdit={false} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Ver archivo/ }))
    expect(screen.queryByLabelText(/Eliminar/)).not.toBeInTheDocument()
  })

  it('deletes the file from the preview modal and reports the change', async () => {
    vi.mocked(complianceApi.deleteFile).mockResolvedValue({ ...RECORDS[0], status: 'MISSING', file_url: null } as never)
    const withLink = [{ ...RECORDS[0], file_url: 'https://example.com/doc.pdf' }]
    const onChanged = vi.fn()
    render(<TransporterDocumentsPanel records={withLink} canEdit={true} onChanged={onChanged} />)

    fireEvent.click(screen.getByRole('button', { name: /Ver archivo/ }))
    fireEvent.click(screen.getByLabelText('Eliminar Rol SII'))
    fireEvent.click(screen.getByText('Sí'))

    await waitFor(() => expect(complianceApi.deleteFile).toHaveBeenCalledWith('cr1'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('does not show upload controls for records that do not require a file', () => {
    const noFile = [{ ...RECORDS[0], requires_file: false }]
    render(<TransporterDocumentsPanel records={noFile} canEdit={true} onChanged={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Subir documento/ })).not.toBeInTheDocument()
    expect(screen.queryByTitle('Reemplazar archivo')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Estado de Rol SII')).toBeInTheDocument()
  })
})
