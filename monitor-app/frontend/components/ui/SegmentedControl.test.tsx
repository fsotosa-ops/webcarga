import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { SegmentedControl } from './SegmentedControl'

const OPCIONES = [
  { id: 'overdue', label: 'Vencidos', badge: '9' },
  { id: 'expiring', label: 'Por vencer', badge: '4' },
] as const

describe('SegmentedControl', () => {
  it('es un grupo con nombre y marca la opción elegida', () => {
    render(<SegmentedControl label="Estado" options={[...OPCIONES]} value="overdue" onChange={vi.fn()} />)
    expect(screen.getByRole('group', { name: 'Estado' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Vencidos/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Por vencer/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('avisa la opción tocada', () => {
    const onChange = vi.fn()
    render(<SegmentedControl label="Estado" options={[...OPCIONES]} value="overdue" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Por vencer/ }))
    expect(onChange).toHaveBeenCalledWith('expiring')
  })
})
