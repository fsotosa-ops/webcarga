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

  it('renders custom labels when provided (e.g. Empresas: Tarjetas/Tabla) without hardcoding Diario copy', () => {
    const onChange = vi.fn()
    render(<ViewToggle value="tabla" onChange={onChange} labels={{ tablero: 'Tarjetas', tabla: 'Tabla' }} />)
    expect(screen.getByText('Tarjetas')).toBeInTheDocument()
    expect(screen.queryByText('Tablero')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Tarjetas'))
    expect(onChange).toHaveBeenCalledWith('tablero')
  })

  // Es el control segmentado del kit: lo elegido en celeste claro, no en el celeste
  // lleno de la acción principal de la página (15/10).
  it('usa el control segmentado del kit', () => {
    render(<ViewToggle value="tabla" onChange={vi.fn()} />)
    const elegido = screen.getByRole('button', { name: /Tabla/ })
    expect(elegido).toHaveAttribute('aria-pressed', 'true')
    expect(elegido.className).toMatch(/text-accion/)
    expect(elegido.className).not.toMatch(/bg-accent /)
  })
})
