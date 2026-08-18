import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AvisoPosteriorAlCierre } from './AvisoPosteriorAlCierre'

describe('AvisoPosteriorAlCierre', () => {
  it('no dice nada cuando no llego nada despues', () => {
    const { container } = render(<AvisoPosteriorAlCierre cantidad={0} onVerlos={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  // El dia NO se reabre: la firma sigue siendo verdadera sobre lo que existia
  // cuando se firmo. Esto es un delta, y "reabierto" seria mentir sobre lo
  // que paso.
  it('no dice que el dia se reabrio', () => {
    render(<AvisoPosteriorAlCierre cantidad={2} onVerlos={() => {}} />)
    expect(screen.queryByText(/reabiert/i)).toBeNull()
    expect(screen.getByText(/posteriores al cierre/i)).toBeInTheDocument()
  })

  it('en singular no dice "1 viajes"', () => {
    render(<AvisoPosteriorAlCierre cantidad={1} onVerlos={() => {}} />)
    expect(screen.getByText(/1 viaje posterior al cierre/i)).toBeInTheDocument()
  })
})
