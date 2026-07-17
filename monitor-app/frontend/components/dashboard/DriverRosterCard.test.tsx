// components/dashboard/DriverRosterCard.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DriverRosterCard } from './DriverRosterCard'
import type { CarrierDriverRosterItem } from '@/lib/types'

const DRIVER: CarrierDriverRosterItem = {
  id: 'd1', tax_id: '11111111-1', full_name: 'Juan Pérez',
  operational_status: 'ACTIVE', total_requirements: 12, last_document_update: '2026-06-01',
  pending_mandatory: 0, compliance_health: 'OK',
}

describe('DriverRosterCard', () => {
  it('renders the name and an "Al día" pill when there are no pending mandatory docs', () => {
    render(<DriverRosterCard driver={DRIVER} onOpen={vi.fn()} />)
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByText('Al día')).toBeInTheDocument()
  })

  it('calls onOpen when clicked', () => {
    const onOpen = vi.fn()
    render(<DriverRosterCard driver={DRIVER} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalled()
  })

  it('shows a red pending pill with the count when compliance_health is PENDING', () => {
    render(<DriverRosterCard driver={{ ...DRIVER, compliance_health: 'PENDING', pending_mandatory: 2 }} onOpen={vi.fn()} />)
    expect(screen.getByText('2 pendientes')).toBeInTheDocument()
    expect(screen.queryByText('Al día')).not.toBeInTheDocument()
  })

  it('uses singular wording for a single pending document', () => {
    render(<DriverRosterCard driver={{ ...DRIVER, compliance_health: 'PENDING', pending_mandatory: 1 }} onOpen={vi.fn()} />)
    expect(screen.getByText(/1 pendiente(?!s)/)).toBeInTheDocument()
  })
})
