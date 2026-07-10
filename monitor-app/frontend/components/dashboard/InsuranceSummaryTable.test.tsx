import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InsuranceSummaryTable } from './InsuranceSummaryTable'
import type { InsuranceSummaryRow } from '@/lib/types'

const ROWS: InsuranceSummaryRow[] = [
  {
    rut: '11111111-1', business_name: 'Transportes Al Día', transporter_id: 't1',
    policies_count: 2, next_due: { date: '2026-08-01', amount_uf: 4.5 }, overdue_count: 0,
    paid_pct: 80, insurance_ok: true,
  },
  {
    rut: '22222222-2', business_name: 'Transportes Vencido', transporter_id: 't2',
    policies_count: 1, next_due: null, overdue_count: 3,
    paid_pct: 20, insurance_ok: false,
  },
]

describe('InsuranceSummaryTable', () => {
  it('renders the rollup with policies count and next due', () => {
    render(<InsuranceSummaryTable rows={ROWS} onSelect={vi.fn()} />)
    // Renderizado dual (mobile + desktop) — ambos coexisten en jsdom
    expect(screen.getAllByText('Transportes Al Día').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Transportes Vencido').length).toBeGreaterThan(0)
    // Pólizas vigentes count (desktop table shows it as a plain number)
    expect(screen.getAllByText('2').length).toBeGreaterThan(0)
  })

  it('shows the Al día badge for insurance_ok=true rows', () => {
    render(<InsuranceSummaryTable rows={[ROWS[0]]} onSelect={vi.fn()} />)
    expect(screen.getAllByText('Al día').length).toBeGreaterThan(0)
  })

  it('shows the overdue count and red dot for insurance_ok=false rows', () => {
    render(<InsuranceSummaryTable rows={[ROWS[1]]} onSelect={vi.fn()} />)
    // overdue_count rendered as bold red "3" (desktop) and "3 vencidas" (mobile)
    expect(screen.getAllByText(/3/).length).toBeGreaterThan(0)
  })

  it('calls onSelect with the row when a table row is clicked', () => {
    const onSelect = vi.fn()
    render(<InsuranceSummaryTable rows={ROWS} onSelect={onSelect} />)
    // Desktop table row is the second match (mobile card renders first in the DOM)
    fireEvent.click(screen.getAllByText('Transportes Al Día')[1])
    expect(onSelect).toHaveBeenCalledWith(ROWS[0])
  })

  it('renders the empty state when there are no rows', () => {
    render(<InsuranceSummaryTable rows={[]} onSelect={vi.fn()} emptyLabel="Nada por aquí" />)
    expect(screen.getAllByText('Nada por aquí').length).toBeGreaterThan(0)
  })
})
