import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TransporterAlertBanner } from './TransporterAlertBanner'
import type { ComplianceRecord } from '@/lib/types'

function makeRecord(overrides: Partial<ComplianceRecord> = {}): ComplianceRecord {
  return {
    id: 'cr1', requirement_id: 'req1', requirement_code: 'F30', name: 'F30 Multas',
    requirement_level: 'LEGAL_MANDATORY', requires_file: true, status: 'APPROVED',
    expiration_date: null, file_url: null, metadata: {}, is_manual_override: false,
    is_expired: false, is_expiring_soon: false,
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

  it('lists mandatory MISSING, EXPIRED-flagged and REJECTED records', () => {
    render(
      <TransporterAlertBanner records={[
        makeRecord({ id: 'a', name: 'F30 Multas', status: 'MISSING' }),
        makeRecord({ id: 'b', name: 'Póliza RC', status: 'APPROVED', is_expired: true }),
        makeRecord({ id: 'c', name: 'Cert. Antecedentes', status: 'REJECTED' }),
      ]} />,
    )
    expect(screen.getByText(/F30 Multas — falta/)).toBeInTheDocument()
    expect(screen.getByText(/Póliza RC — vencido/)).toBeInTheDocument()
    expect(screen.getByText(/Cert. Antecedentes — rechazado/)).toBeInTheDocument()
  })
})
