import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ComplianceCounts } from './ComplianceCounts'
import type { ComplianceSummary } from '@/lib/states'

const base: ComplianceSummary = {
  worst_state: 'MISSING', can_operate: false,
  own: { overdue: 1, expiring: 2, missing: 3 }, fleet: { overdue: 4, expiring: 0, missing: 1 },
  blocking: { own: 4, fleet: 5 },
}

describe('ComplianceCounts', () => {
  it('suma lo propio más la flota', () => {
    render(<ComplianceCounts summary={base} />)
    expect(screen.getByTestId('counts-overdue')).toHaveTextContent('5')
    expect(screen.getByTestId('counts-expiring')).toHaveTextContent('2')
    expect(screen.getByTestId('counts-missing')).toHaveTextContent('4')
  })

  it('fleet null cuenta solo lo propio', () => {
    render(<ComplianceCounts summary={{ ...base, fleet: null }} />)
    expect(screen.getByTestId('counts-overdue')).toHaveTextContent('1')
  })

  it('el title es la etiqueta del glosario', () => {
    render(<ComplianceCounts summary={base} />)
    expect(screen.getByTestId('counts-overdue')).toHaveAttribute('title', 'Vencido')
    expect(screen.getByTestId('counts-missing')).toHaveAttribute('title', 'Falta')
    expect(screen.getByTestId('counts-expiring')).toHaveAttribute('title', 'Por vencer')
  })
})
