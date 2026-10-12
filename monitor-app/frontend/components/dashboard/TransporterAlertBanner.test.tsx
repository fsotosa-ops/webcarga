import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TransporterAlertBanner } from './TransporterAlertBanner'
import type { ComplianceRecord } from '@/lib/types'
import { recordStateFields } from '@/lib/states.fixtures'

function makeRecord(overrides: Partial<ComplianceRecord> = {}): ComplianceRecord {
  return {
    id: 'cr1', requirement_id: 'req1', requirement_code: 'F30', name: 'F30 Multas',
    requirement_level: 'LEGAL_MANDATORY', requires_file: true, status: 'APPROVED',
    expiration_date: null, file_url: null, metadata: {}, is_manual_override: false,
    is_expired: false, is_expiring_soon: false, ...recordStateFields(), updated_at: null,
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
      <TransporterAlertBanner records={[makeRecord({ requirement_level: 'CONDITIONAL_OPTIONAL', status: 'MISSING', ...recordStateFields('MISSING') })]} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('lista lo obligatorio que la API dice vencido o faltante, con la palabra del glosario', () => {
    render(<TransporterAlertBanner records={[
      makeRecord({ id: 'a', name: 'F30', status: 'APPROVED_MANUAL', ...recordStateFields('OVERDUE') }),
      makeRecord({ id: 'b', name: 'Escritura', status: 'MISSING', ...recordStateFields('MISSING') }),
    ]} />)
    expect(screen.getByText('F30')).toBeInTheDocument()
    expect(screen.getByText('Vencido')).toBeInTheDocument()
    expect(screen.getByText('Escritura')).toBeInTheDocument()
    expect(screen.getByText('Falta')).toBeInTheDocument()
    // El estado guardado es historial, no estado (conflicto 10).
    expect(screen.queryByText('Aprobado (manual)')).not.toBeInTheDocument()
  })

  it('no lista lo que todavía no se exige ni lo que solo está por vencer', () => {
    const { container } = render(<TransporterAlertBanner records={[
      makeRecord({ status: 'MISSING', ...recordStateFields('NOT_REQUIRED') }),
      makeRecord({ id: 'c', status: 'APPROVED_MANUAL', ...recordStateFields('EXPIRING') }),
    ]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('dice cuánto falta con los días de la API', () => {
    render(<TransporterAlertBanner records={[
      makeRecord({ status: 'APPROVED_MANUAL', expiration_date: '2026-10-01', ...recordStateFields('OVERDUE'), days_to_expiry: -11 }),
    ]} />)
    expect(screen.getByText('vencido hace 11 días')).toBeInTheDocument()
  })

  it('shows the count of problem documents in the header', () => {
    render(
      <TransporterAlertBanner records={[
        makeRecord({ id: 'a', status: 'MISSING', ...recordStateFields('MISSING') }),
        makeRecord({ id: 'b', status: 'MISSING', name: 'Otro', ...recordStateFields('MISSING') }),
      ]} />,
    )
    expect(screen.getByText('2 documentos obligatorios con atención')).toBeInTheDocument()
  })

  it('shows a relative expiry label when there is an expiration_date', () => {
    render(
      <TransporterAlertBanner records={[
        makeRecord({ id: 'a', status: 'APPROVED', expiration_date: '2020-01-01', ...recordStateFields('OVERDUE'), days_to_expiry: -2000 }),
      ]} />,
    )
    expect(screen.getByText(/vencido hace/)).toBeInTheDocument()
  })

  it('falls back to "sin actualizar hace" when there is no expiration_date but there is updated_at', () => {
    render(
      <TransporterAlertBanner records={[
        makeRecord({ id: 'a', status: 'MISSING', ...recordStateFields('MISSING'), expiration_date: null, updated_at: '2020-01-01T00:00:00Z' }),
      ]} />,
    )
    expect(screen.getByText(/sin actualizar hace/)).toBeInTheDocument()
  })
})
