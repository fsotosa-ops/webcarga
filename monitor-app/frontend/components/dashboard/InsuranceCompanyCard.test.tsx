import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InsuranceCompanyCard } from './InsuranceCompanyCard'
import type { InsuranceSummaryRow } from '@/lib/types'

const rowOk: InsuranceSummaryRow = {
  rut: '11111111-1', business_name: 'Transportes Al Día', transporter_id: 't1',
  policies_count: 2, next_due: { date: '2026-08-01', amount_uf: 4.5 }, overdue_count: 0,
  paid_pct: 80, insurance_ok: true,
}

const rowOverdue: InsuranceSummaryRow = {
  rut: '22222222-2', business_name: 'Transportes Vencido', transporter_id: 't2',
  policies_count: 1, next_due: null, overdue_count: 3,
  paid_pct: 20, insurance_ok: false,
}

function renderCard(row: InsuranceSummaryRow, opts: { active?: boolean; onOpen?: () => void } = {}) {
  return render(
    <InsuranceCompanyCard row={row} active={opts.active ?? false} onOpen={opts.onOpen ?? vi.fn()} />,
  )
}

describe('InsuranceCompanyCard', () => {
  it('renders the row with an "Al día" badge when there are no overdue installments', () => {
    renderCard(rowOk)
    expect(screen.getByText('Transportes Al Día')).toBeInTheDocument()
    expect(screen.getByText('Al día')).toBeInTheDocument()
  })

  it('renders a "N vencidas" badge when overdue_count > 0', () => {
    renderCard(rowOverdue)
    expect(screen.getByText('Transportes Vencido')).toBeInTheDocument()
    expect(screen.getByText('3 vencidas')).toBeInTheDocument()
  })

  it('shows a "Sin información" badge for a company with no policies', () => {
    renderCard({ ...rowOk, policies_count: 0, overdue_count: 0, next_due: null, paid_pct: null })
    expect(screen.getByText('Sin información')).toBeInTheDocument()
  })

  it('calls onOpen when the row is clicked', () => {
    const onOpen = vi.fn()
    renderCard(rowOk, { onOpen })
    fireEvent.click(screen.getByText('Transportes Al Día'))
    expect(onOpen).toHaveBeenCalled()
  })
})
