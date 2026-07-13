import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TransporterCard } from './TransporterCard'
import type { TransporterListItem } from '@/lib/types'

const ITEM: TransporterListItem = {
  id: 't1', admin_id: null, business_name: 'Transportes Test', rut: '11111111-1',
  account_stage: null, driver_count: 4, vehicle_count: 6, trailer_count: 2, tracto_count: 4,
  has_manual_edits: false, has_active_alerts: false, in_admin: true, clients: ['Walmart'],
  avance_80_20: 85, avance_total: 70, compliance_pct: 85, eligible: true, insurance_ok: true,
  policies_count: 2, blocking_reasons: [],
  operational_status: 'operativa', matched_by_upload: false, admin_account_id: null,
}

describe('TransporterCard', () => {
  it('renders name, rut, counts, progress and insurance badge', () => {
    render(<TransporterCard item={ITEM} onOpen={vi.fn()} />)
    expect(screen.getByText('Transportes Test')).toBeInTheDocument()
    expect(screen.getByText('11111111-1')).toBeInTheDocument()
    expect(screen.getByText(/4 cond\./)).toBeInTheDocument()
    expect(screen.getByText(/4 tractos/)).toBeInTheDocument()
    expect(screen.getByText(/2 ramplas/)).toBeInTheDocument()
    expect(screen.getByText('85%')).toBeInTheDocument()
    expect(screen.getByText('Al día')).toBeInTheDocument()
    expect(screen.getByText('Walmart')).toBeInTheDocument()
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
    render(<TransporterCard item={{ ...ITEM, business_name: null }} onOpen={vi.fn()} />)
    expect(screen.getByText('Sin nombre')).toBeInTheDocument()
  })
})
