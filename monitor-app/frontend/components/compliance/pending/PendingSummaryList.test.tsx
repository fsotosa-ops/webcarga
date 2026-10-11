import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { PendingSummaryList } from './PendingSummaryList'
import type { PendingSummaryRow } from '@/lib/types'

const F30: PendingSummaryRow = {
  key: 'req-f30', label: 'F30-1', requirement_code: 'F30_1', target_entity: 'CARRIER',
  expiration_policy: 'CALENDAR_PERIOD',
  vigencia: { frequency_months: 1, cutoff_day: 18, period_offset_months: 1, warning_days: 5 } as never,
  overdue: 9, expiring: 4, missing: 21,
}
const LIC: PendingSummaryRow = { ...F30, key: 'req-lic', label: 'Licencia de Conducir', requirement_code: 'LIC',
  target_entity: 'DRIVER', expiration_policy: 'REQUIRED', vigencia: null, overdue: 4, expiring: 3, missing: 68 }

describe('PendingSummaryList', () => {
  it('muestra cada documento con su regla y sus tres cifras', () => {
    render(<PendingSummaryList rows={[F30]} groupBy="requirement" selectedKey="req-f30" onSelect={vi.fn()} />)
    const opcion = screen.getByRole('option', { name: /F30-1/ })
    expect(opcion).toHaveAttribute('aria-selected', 'true')
    expect(opcion).toHaveTextContent('Mensual · tope día 18')
    // Las tres cifras, cada una con lo que significa (no sólo un número suelto).
    expect(opcion).toHaveTextContent('9')
    expect(opcion).toHaveTextContent('4')
    expect(opcion).toHaveTextContent('21')
    expect(opcion.querySelector('[aria-label="9 vencidos, 4 por vencer, 21 faltan"]')).not.toBeNull()
  })

  it('se navega con las flechas', () => {
    const onSelect = vi.fn()
    render(<PendingSummaryList rows={[F30, LIC]} groupBy="requirement" selectedKey="req-f30" onSelect={onSelect} />)
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' })
    expect(onSelect).toHaveBeenCalledWith('req-lic')
  })

  it('la flecha arriba vuelve al anterior y no pasa del primero', () => {
    const onSelect = vi.fn()
    const { rerender } = render(
      <PendingSummaryList rows={[F30, LIC]} groupBy="requirement" selectedKey="req-lic" onSelect={onSelect} />)
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowUp' })
    expect(onSelect).toHaveBeenLastCalledWith('req-f30')

    rerender(<PendingSummaryList rows={[F30, LIC]} groupBy="requirement" selectedKey="req-f30" onSelect={onSelect} />)
    onSelect.mockClear()
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowUp' })
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('un clic elige', () => {
    const onSelect = vi.fn()
    render(<PendingSummaryList rows={[F30, LIC]} groupBy="requirement" selectedKey="req-f30" onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('option', { name: /Licencia de Conducir/ }))
    expect(onSelect).toHaveBeenCalledWith('req-lic')
  })

  it('por empresa se llama Empresas y no inventa una regla', () => {
    const empresa: PendingSummaryRow = { ...F30, key: 'c1', label: 'Transportes Cordillera SpA',
      requirement_code: null, target_entity: null, expiration_policy: null, vigencia: null }
    render(<PendingSummaryList rows={[empresa]} groupBy="carrier" selectedKey="c1" onSelect={vi.fn()} />)
    expect(screen.getByRole('listbox', { name: 'Empresas' })).toBeInTheDocument()
    expect(screen.getByRole('option')).not.toHaveTextContent('tope')
  })
})
