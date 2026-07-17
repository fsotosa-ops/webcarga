// components/dashboard/DriverRosterCard.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DriverRosterCard } from './DriverRosterCard'
import type { CarrierDriverRosterItem } from '@/lib/types'

const DRIVER: CarrierDriverRosterItem = {
  id: 'd1', tax_id: '11111111-1', full_name: 'Juan Pérez',
  operational_status: 'ACTIVE', total_requirements: 12, last_document_update: '2026-06-01',
}

describe('DriverRosterCard', () => {
  it('renders the name and requirement count', () => {
    render(<DriverRosterCard driver={DRIVER} onOpen={vi.fn()} />)
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByText(/12 requisitos/)).toBeInTheDocument()
  })

  it('calls onOpen when clicked', () => {
    const onOpen = vi.fn()
    render(<DriverRosterCard driver={DRIVER} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalled()
  })

  it('uses singular wording for a single requirement', () => {
    render(<DriverRosterCard driver={{ ...DRIVER, total_requirements: 1 }} onOpen={vi.fn()} />)
    expect(screen.getByText(/1 requisito(?!s)/)).toBeInTheDocument()
  })
})
