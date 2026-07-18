import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TransporterCard } from './TransporterCard'
import type { CarrierListItem } from '@/lib/types'

const ITEM: CarrierListItem = {
  id: 't1', tax_id: '11111111-1', country_code: 'CL', business_name: 'Transportes Test',
  operational_status: 'ACTIVE', total_requirements: 12, last_document_update: '2026-06-01',
  pending_mandatory: 0, compliance_health: 'OK',
}

describe('TransporterCard', () => {
  it('renders name, tax_id, status and an "Al día" pill when there are no pending mandatory docs', () => {
    render(<TransporterCard item={ITEM} onOpen={vi.fn()} />)
    expect(screen.getByText('Transportes Test')).toBeInTheDocument()
    expect(screen.getByText('11111111-1')).toBeInTheDocument()
    expect(screen.getByText('Activa')).toBeInTheDocument()
    expect(screen.getByText('Al día')).toBeInTheDocument()
  })

  it('shows a red pending pill with the count when compliance_health is PENDING', () => {
    render(<TransporterCard item={{ ...ITEM, compliance_health: 'PENDING', pending_mandatory: 3 }} onOpen={vi.fn()} />)
    expect(screen.getByText('3 pendientes')).toBeInTheDocument()
    expect(screen.queryByText('Al día')).not.toBeInTheDocument()
  })

  it('calls onOpen when the card is clicked', () => {
    const onOpen = vi.fn()
    render(<TransporterCard item={ITEM} onOpen={onOpen} />)
    fireEvent.click(screen.getByText('Transportes Test'))
    expect(onOpen).toHaveBeenCalledWith(ITEM)
  })

  it('does not call onOpen when "Ver ficha completa" link is clicked (navigates instead)', () => {
    const onOpen = vi.fn()
    render(<TransporterCard item={ITEM} onOpen={onOpen} />)
    fireEvent.click(screen.getByTitle('Ver ficha completa'))
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('renders a placeholder for a company with no name', () => {
    render(<TransporterCard item={{ ...ITEM, business_name: '' }} onOpen={vi.fn()} />)
    expect(screen.getByText('Sin nombre')).toBeInTheDocument()
  })

  it('shows Inactiva for legacy_inactive companies (concept exposed to the user is Activo/Inactivo, not Activo/Legacy)', () => {
    render(<TransporterCard item={{ ...ITEM, operational_status: 'LEGACY_INACTIVE' }} onOpen={vi.fn()} />)
    expect(screen.getByText('Inactiva')).toBeInTheDocument()
  })
})
