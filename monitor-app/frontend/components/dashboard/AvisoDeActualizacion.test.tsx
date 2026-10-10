import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AvisoDeActualizacion, estadoDeFrescura } from './AvisoDeActualizacion'

const AHORA = new Date('2026-10-10T15:00:00Z')

describe('estadoDeFrescura', () => {
  it('sin pendiente está al día', () => {
    expect(estadoDeFrescura(null, AHORA)).toBe('al_dia')
  })
  it('pendiente hace menos de 5 minutos se está actualizando', () => {
    expect(estadoDeFrescura('2026-10-10T14:57:00Z', AHORA)).toBe('actualizando')
  })
  it('pendiente hace más de 5 minutos está atrasado', () => {
    expect(estadoDeFrescura('2026-10-10T14:50:00Z', AHORA)).toBe('atrasado')
  })
})

describe('AvisoDeActualizacion', () => {
  it('no muestra nada si está al día', () => {
    const { container } = render(<AvisoDeActualizacion pendienteDesde={null} ahora={AHORA} />)
    expect(container).toBeEmptyDOMElement()
  })
  it('dice Actualizando mientras está pendiente', () => {
    render(<AvisoDeActualizacion pendienteDesde="2026-10-10T14:58:00Z" ahora={AHORA} />)
    expect(screen.getByRole('status')).toHaveTextContent('Actualizando')
  })
  it('dice desde cuándo no se pudo actualizar', () => {
    render(<AvisoDeActualizacion pendienteDesde="2026-10-10T14:40:00Z" ahora={AHORA} />)
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo actualizar desde 11:40')
  })
})
