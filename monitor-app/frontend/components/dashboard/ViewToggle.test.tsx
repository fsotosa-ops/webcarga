import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ViewToggle } from './ViewToggle'

describe('ViewToggle', () => {
  it('calls onChange with "tablero" when the tablero button is clicked', () => {
    const onChange = vi.fn()
    render(<ViewToggle value="tabla" onChange={onChange} />)
    fireEvent.click(screen.getByText('Tablero'))
    expect(onChange).toHaveBeenCalledWith('tablero')
  })

  it('calls onChange with "tabla" when the tabla button is clicked', () => {
    const onChange = vi.fn()
    render(<ViewToggle value="tablero" onChange={onChange} />)
    fireEvent.click(screen.getByText('Tabla'))
    expect(onChange).toHaveBeenCalledWith('tabla')
  })
})
