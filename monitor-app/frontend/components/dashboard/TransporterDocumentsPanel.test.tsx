import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TransporterDocumentsPanel } from './TransporterDocumentsPanel'
import { complianceApi } from '@/lib/api/compliance'
import type { ComplianceRecord } from '@/lib/types'

vi.mock('@/lib/api/compliance', () => ({
  complianceApi: {
    listFiles: vi.fn(),
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
  vi.mocked(complianceApi.listFiles).mockReset().mockResolvedValue([])
})

describe('TransporterDocumentsPanel', () => {
  it('shows every record as a row, always visible (no collapse toggle)', () => {
    render(<TransporterDocumentsPanel records={RECORDS} carrierId="c1" />)
    expect(screen.getByText('Rol SII')).toBeInTheDocument()
    expect(screen.getByText('F30')).toBeInTheDocument()
  })

  it('links out to Certificación, scoped to this carrier, instead of offering to upload here', () => {
    render(<TransporterDocumentsPanel records={RECORDS} carrierId="c1" />)
    const link = screen.getByRole('link', { name: /Subir en Certificación/ })
    expect(link).toHaveAttribute('href', '/dashboard/certification?carrier_id=c1')
    expect(screen.queryByRole('button', { name: /Subir documento/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Estado de/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Fecha de vencimiento de/)).not.toBeInTheDocument()
  })

  it('labels the expiration date so it is clear what it means', () => {
    render(<TransporterDocumentsPanel records={RECORDS} carrierId="c1" />)
    expect(screen.getByText('Vence:')).toBeInTheDocument()
  })

  it('shows a "Ver archivo" trigger when file_url is set', () => {
    const withLink = [{ ...RECORDS[0], file_url: 'https://example.com/doc.pdf' }]
    render(<TransporterDocumentsPanel records={withLink} carrierId="c1" />)
    expect(screen.getByRole('button', { name: /Ver archivo/ })).toBeInTheDocument()
  })

  it('opens the preview modal when clicking "Ver archivo", without a delete option', () => {
    const withLink = [{ ...RECORDS[0], file_url: 'https://example.com/doc.pdf' }]
    render(<TransporterDocumentsPanel records={withLink} carrierId="c1" />)
    fireEvent.click(screen.getByRole('button', { name: /Ver archivo/ }))
    expect(screen.getByLabelText('Cerrar')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Eliminar/)).not.toBeInTheDocument()
  })

  it('renders document version history with status + replaced date, available without edit rights', async () => {
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
    render(<TransporterDocumentsPanel records={RECORDS} carrierId="c1" />)
    fireEvent.click(screen.getAllByTitle('Ver historial de versiones')[0])
    await waitFor(() => expect(complianceApi.listFiles).toHaveBeenCalledWith('cr1'))
    const entry = await screen.findByText(/REJECTED · reemplazado/)
    expect(entry.textContent).not.toMatch(/undefined/)
    expect(entry.textContent).toContain('01-06-26')
  })

  it('renders the current (never-replaced) version as "vigente", not "reemplazado"', async () => {
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
    render(<TransporterDocumentsPanel records={RECORDS} carrierId="c1" />)
    fireEvent.click(screen.getAllByTitle('Ver historial de versiones')[0])
    await waitFor(() => expect(complianceApi.listFiles).toHaveBeenCalledWith('cr1'))
    const entry = await screen.findByText(/APPROVED_MANUAL · vigente/)
    expect(entry).toBeInTheDocument()
  })

  it('does not show the version history trigger for records that do not require a file', () => {
    const noFile = [{ ...RECORDS[0], requires_file: false }]
    render(<TransporterDocumentsPanel records={noFile} carrierId="c1" />)
    expect(screen.queryByTitle('Ver historial de versiones')).not.toBeInTheDocument()
  })

  it('shows "Sin datos" when there are no records', () => {
    render(<TransporterDocumentsPanel records={[]} carrierId="c1" />)
    expect(screen.getByText('Sin datos')).toBeInTheDocument()
  })
})
