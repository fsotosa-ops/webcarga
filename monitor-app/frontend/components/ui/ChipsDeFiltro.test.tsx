import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ChipsDeFiltro } from './ChipsDeFiltro'

const OPCIONES = [
  { id: 'sin-revisar', etiqueta: 'Sin revisar', n: 12 },
  { id: 'con-condicion', etiqueta: 'Con condición', n: 2 },
]

describe('ChipsDeFiltro', () => {
  it('muestra cada opcion con su cantidad', () => {
    render(<ChipsDeFiltro opciones={OPCIONES} activo={null} onElegir={vi.fn()} />)
    expect(screen.getByRole('button', { name: /sin revisar/i })).toHaveTextContent('12')
  })

  it('elegir un chip lo avisa', () => {
    const onElegir = vi.fn()
    render(<ChipsDeFiltro opciones={OPCIONES} activo={null} onElegir={onElegir} />)
    fireEvent.click(screen.getByRole('button', { name: /sin revisar/i }))
    expect(onElegir).toHaveBeenCalledWith('sin-revisar')
  })

  // Volver a apretar el chip activo lo apaga: sin esto el unico modo de quitar
  // un filtro es recargar, que es como se pierde la confianza en un filtro.
  it('volver a apretar el chip activo lo apaga', () => {
    const onElegir = vi.fn()
    render(<ChipsDeFiltro opciones={OPCIONES} activo="sin-revisar" onElegir={onElegir} />)
    fireEvent.click(screen.getByRole('button', { name: /sin revisar/i }))
    expect(onElegir).toHaveBeenCalledWith(null)
  })

  it('declara cual esta activo de forma accesible', () => {
    render(<ChipsDeFiltro opciones={OPCIONES} activo="sin-revisar" onElegir={vi.fn()} />)
    expect(screen.getByRole('button', { name: /sin revisar/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /con condición/i })).toHaveAttribute('aria-pressed', 'false')
  })

  it('un chip sin cantidad no dibuja un cero', () => {
    render(<ChipsDeFiltro opciones={[{ id: 'x', etiqueta: 'Todos' }]} activo={null} onElegir={vi.fn()} />)
    expect(screen.getByRole('button', { name: /todos/i })).not.toHaveTextContent('0')
  })
})
