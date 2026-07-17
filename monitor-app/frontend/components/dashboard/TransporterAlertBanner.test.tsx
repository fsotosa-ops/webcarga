import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TransporterAlertBanner } from './TransporterAlertBanner'
import type { ComplianceRecord } from '@/lib/types'

function makeRecord(overrides: Partial<ComplianceRecord> = {}): ComplianceRecord {
  return {
    id: 'cr1', requirement_id: 'req1', requirement_code: 'F30', name: 'F30 Multas',
    requirement_level: 'LEGAL_MANDATORY', requires_file: true, status: 'APPROVED',
    expiration_date: null, file_url: null, metadata: {}, is_manual_override: false,
    is_expired: false, is_expiring_soon: false, updated_at: null,
    ...overrides,
  }
}

describe('TransporterAlertBanner', () => {
  it('renders nothing when there are no problem records', () => {
    const { container } = render(<TransporterAlertBanner records={[makeRecord()]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('ignores non-mandatory records even if missing', () => {
    const { container } = render(
      <TransporterAlertBanner records={[makeRecord({ requirement_level: 'CONDITIONAL_OPTIONAL', status: 'MISSING' })]} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('lists mandatory MISSING, EXPIRED and REJECTED records with their status pill', () => {
    render(
      <TransporterAlertBanner records={[
        makeRecord({ id: 'a', name: 'F30 Multas', status: 'MISSING' }),
        makeRecord({ id: 'b', name: 'Póliza RC', status: 'EXPIRED' }),
        makeRecord({ id: 'c', name: 'Cert. Antecedentes', status: 'REJECTED' }),
      ]} />,
    )
    expect(screen.getByText('F30 Multas')).toBeInTheDocument()
    expect(screen.getByText('Póliza RC')).toBeInTheDocument()
    expect(screen.getByText('Cert. Antecedentes')).toBeInTheDocument()
    expect(screen.getByText('Falta')).toBeInTheDocument()
    expect(screen.getByText('Vencido')).toBeInTheDocument()
    expect(screen.getByText('Rechazado')).toBeInTheDocument()
  })

  it('includes an approved-but-expired record (status stays Aprobado, expiry shown via relative time)', () => {
    render(
      <TransporterAlertBanner records={[
        makeRecord({ id: 'b', name: 'Póliza RC', status: 'APPROVED', is_expired: true, expiration_date: '2026-06-01' }),
      ]} />,
    )
    expect(screen.getByText('Póliza RC')).toBeInTheDocument()
    expect(screen.getByText('Aprobado')).toBeInTheDocument()
    expect(screen.getByText(/vencido hace/)).toBeInTheDocument()
  })

  it('shows the count of problem documents in the header', () => {
    render(
      <TransporterAlertBanner records={[
        makeRecord({ id: 'a', status: 'MISSING' }),
        makeRecord({ id: 'b', status: 'MISSING', name: 'Otro' }),
      ]} />,
    )
    expect(screen.getByText('2 documentos obligatorios con atención')).toBeInTheDocument()
  })

  it('shows a relative expiry label when there is an expiration_date', () => {
    render(
      <TransporterAlertBanner records={[
        makeRecord({ id: 'a', status: 'APPROVED', is_expired: true, expiration_date: '2020-01-01' }),
      ]} />,
    )
    expect(screen.getByText(/vencido hace/)).toBeInTheDocument()
  })

  it('falls back to "sin actualizar hace" when there is no expiration_date but there is updated_at', () => {
    render(
      <TransporterAlertBanner records={[
        makeRecord({ id: 'a', status: 'MISSING', expiration_date: null, updated_at: '2020-01-01T00:00:00Z' }),
      ]} />,
    )
    expect(screen.getByText(/sin actualizar hace/)).toBeInTheDocument()
  })
})
