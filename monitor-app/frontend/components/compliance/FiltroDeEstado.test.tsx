import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { FiltroDeEstado } from './FiltroDeEstado'

describe('FiltroDeEstado', () => {
  it('marca cuál está activo, de forma accesible', () => {
    render(<FiltroDeEstado valor="falta" onCambiar={vi.fn()} />)
    expect(screen.getByRole('button', { name: /falta/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /al día/i })).toHaveAttribute('aria-pressed', 'false')
  })

  it('avisa cuál se eligió', () => {
    const onCambiar = vi.fn()
    render(<FiltroDeEstado valor="falta" onCambiar={onCambiar} />)
    fireEvent.click(screen.getByRole('button', { name: /al día/i }))
    expect(onCambiar).toHaveBeenCalledWith('al_dia')
  })

  it('muestra el conteo cuando lo tiene', () => {
    render(<FiltroDeEstado valor="todos" onCambiar={vi.fn()} conteos={{ todos: 33, falta: 10 }} />)
    expect(screen.getByRole('button', { name: /todo.*33/i })).toBeInTheDocument()
  })

  it('NO inventa un cero cuando el conteo todavía no llegó', () => {
    // Regla del proyecto: una cifra derivada no se muestra hasta tener el dato.
    // Un `?? 0` afirma algo falso mientras la consulta esta en vuelo — ya paso
    // en Certificacion, que mostraba "0 documentos por cubrir" y despues
    // saltaba a 2.360.
    render(<FiltroDeEstado valor="todos" onCambiar={vi.fn()} />)
    expect(screen.getByRole('button', { name: /^Todo$/ })).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })
})
