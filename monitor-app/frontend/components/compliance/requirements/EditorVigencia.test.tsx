import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EditorVigencia } from './EditorVigencia'
import { SelectorExigibilidad } from './SelectorExigibilidad'
import type { Vigencia } from '@/lib/vigencia'

const F30_1: Vigencia = {
  politica: 'CALENDAR_PERIOD', frequency_months: 1, cutoff_day: 18,
  period_offset_months: 1, warning_days: 5, grace_days: 0,
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 8))
})
afterEach(() => vi.useRealTimers())

describe('EditorVigencia', () => {
  it('muestra la regla con su ejemplo de fechas', () => {
    render(<EditorVigencia value={F30_1} onChange={vi.fn()} />)
    expect(screen.getByRole('radio', { name: /se renueva cada período/i })).toBeChecked()
    expect(screen.getByText(/el de septiembre se pide el 18\/10 y sirve hasta el 18\/11/))
      .toBeInTheDocument()
  })

  it('cada tipo muestra solo sus campos', () => {
    const { rerender } = render(<EditorVigencia value={F30_1} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Día tope')).toBeInTheDocument()
    expect(screen.queryByLabelText('Meses que dura')).not.toBeInTheDocument()

    rerender(<EditorVigencia value={{ politica: 'ISSUE_PLUS_MONTHS', validity_months: 12 }} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Meses que dura')).toHaveValue(12)
    expect(screen.queryByLabelText('Día tope')).not.toBeInTheDocument()

    rerender(<EditorVigencia value={{ politica: 'NONE' }} onChange={vi.fn()} />)
    expect(screen.queryByLabelText('Días de aviso')).not.toBeInTheDocument()
  })

  it('cambiar de tipo deja solo los parámetros del tipo nuevo', () => {
    const onChange = vi.fn()
    render(<EditorVigencia value={F30_1} onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: /dura un plazo desde que se emite/i }))
    expect(onChange).toHaveBeenCalledWith({
      politica: 'ISSUE_PLUS_MONTHS', validity_months: 12, warning_days: 5, grace_days: 0,
    })
  })

  it('editar un campo de la frase cambia solo ese parámetro', () => {
    const onChange = vi.fn()
    render(<EditorVigencia value={F30_1} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Día tope'), { target: { value: '15' } })
    expect(onChange).toHaveBeenCalledWith({ ...F30_1, cutoff_day: 15 })
  })

  it('un campo vaciado queda en null y el ejemplo dice qué falta', () => {
    const onChange = vi.fn()
    const { rerender } = render(<EditorVigencia value={F30_1} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Día tope'), { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith({ ...F30_1, cutoff_day: null })
    rerender(<EditorVigencia value={{ ...F30_1, cutoff_day: null }} onChange={onChange} />)
    expect(screen.getByText('Falta el día tope.')).toBeInTheDocument()
  })

  it('la fecha del documento elige entre obligatoria y opcional', () => {
    const onChange = vi.fn()
    render(<EditorVigencia value={{ politica: 'REQUIRED' }} onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Fecha opcional' }))
    expect(onChange).toHaveBeenCalledWith({ politica: 'OPTIONAL' })
  })

  it('sin permiso se ve la regla pero no se edita', () => {
    render(<EditorVigencia value={F30_1} onChange={vi.fn()} disabled />)
    expect(screen.getByRole('radio', { name: /se renueva cada período/i })).toBeDisabled()
    expect(screen.getByLabelText('Día tope')).toBeDisabled()
    expect(screen.getByText(/sirve hasta el 18\/11/)).toBeInTheDocument()
  })
})

describe('SelectorExigibilidad', () => {
  it('al ingreso y a pedido valen para cualquier entidad', () => {
    render(<SelectorExigibilidad value="ON_ENTITY_START" onChange={vi.fn()} entidad="CARRIER" />)
    expect(screen.getByRole('radio', { name: /solo cuando se le solicita/i })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /mes siguiente/i })).not.toBeInTheDocument()
  })

  it('mes siguiente y al término solo para conductores', () => {
    const onChange = vi.fn()
    render(<SelectorExigibilidad value="ON_ENTITY_START" onChange={onChange} entidad="DRIVER" />)
    fireEvent.click(screen.getByRole('radio', { name: /mes siguiente al ingreso/i }))
    expect(onChange).toHaveBeenCalledWith('MONTH_AFTER_START')
    expect(screen.getByRole('radio', { name: /deja la empresa/i })).toBeInTheDocument()
  })
})
