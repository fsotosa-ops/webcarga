import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AvisoPosteriorAlCierre } from './AvisoPosteriorAlCierre'

describe('AvisoPosteriorAlCierre', () => {
  it('no dice nada cuando no llego nada despues', () => {
    const { container } = render(<AvisoPosteriorAlCierre cantidad={0} />)
    expect(container).toBeEmptyDOMElement()
  })

  // El dia NO se reabre: la firma sigue siendo verdadera sobre lo que existia
  // cuando se firmo. Esto es un delta, y "reabierto" seria mentir sobre lo
  // que paso.
  it('no dice que el dia se reabrio', () => {
    render(<AvisoPosteriorAlCierre cantidad={2} />)
    expect(screen.queryByText(/reabiert/i)).toBeNull()
    expect(screen.getByText(/posteriores al cierre/i)).toBeInTheDocument()
  })

  it('en singular no dice "1 viajes"', () => {
    render(<AvisoPosteriorAlCierre cantidad={1} />)
    expect(screen.getByText(/1 viaje posterior al cierre/i)).toBeInTheDocument()
  })

  // Critico 2 (revision de rama, 2026-08-18): el aviso cuenta TODOS los
  // viajes del dia, pero la pestaña "Viajes" muestra otro universo (47
  // viajes del 14/08 anunciados, 0 visibles ahi). Un boton "Verlos" que
  // navegara a esa pestaña llevaria a una pantalla vacia. El Monitor no
  // puede recibir una fecha por URL hoy, asi que no se inventa un destino
  // nuevo: sin boton, solo el numero.
  it('no ofrece un boton que lleve a una pantalla sin los viajes que anuncia', () => {
    render(<AvisoPosteriorAlCierre cantidad={3} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
