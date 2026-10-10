import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AvisoDeActualizacion, estadoDeFrescura } from './AvisoDeActualizacion'

const AHORA = new Date('2026-10-10T15:00:00Z')

describe('estadoDeFrescura', () => {
  it('sin pendiente está al día', () => {
    expect(estadoDeFrescura(null, '2026-10-10T14:00:00Z', AHORA)).toBe('al_dia')
  })
  it('pendiente hace menos de 5 minutos se está actualizando', () => {
    expect(estadoDeFrescura('2026-10-10T14:57:00Z', '2026-10-10T14:00:00Z', AHORA)).toBe('actualizando')
  })
  it('pendiente hace más de 5 minutos está atrasado', () => {
    expect(estadoDeFrescura('2026-10-10T14:50:00Z', '2026-10-10T14:00:00Z', AHORA)).toBe('atrasado')
  })
})

describe('el día sin cierre', () => {
  it('sin líneas ni cambios pendientes, el día no tiene cierre', () => {
    expect(estadoDeFrescura(null, null, AHORA)).toBe('sin_cierre')
  })
  it('lo dice en pantalla en vez de mostrar listas vacías sin explicación', () => {
    render(<AvisoDeActualizacion pendienteDesde={null} calculadoA={null} ahora={AHORA} />)
    expect(screen.getByRole('status')).toHaveTextContent('Este día no tiene cierre')
  })
})

describe('AvisoDeActualizacion', () => {
  it('no muestra nada si está al día', () => {
    const { container } = render(<AvisoDeActualizacion pendienteDesde={null} calculadoA="2026-10-10T14:00:00Z" ahora={AHORA} />)
    expect(container).toBeEmptyDOMElement()
  })
  it('dice Actualizando mientras está pendiente', () => {
    render(<AvisoDeActualizacion pendienteDesde="2026-10-10T14:58:00Z" calculadoA="2026-10-10T14:00:00Z" ahora={AHORA} />)
    expect(screen.getByRole('status')).toHaveTextContent('Actualizando')
  })
  it('dice desde cuándo no se pudo actualizar', () => {
    render(<AvisoDeActualizacion pendienteDesde="2026-10-10T14:40:00Z" calculadoA={null} ahora={AHORA} />)
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo actualizar desde 11:40')
  })
})
