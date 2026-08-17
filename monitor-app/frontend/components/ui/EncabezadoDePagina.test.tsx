import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EncabezadoDePagina } from './EncabezadoDePagina'

/**
 * Catorce <h1> escritos a mano con SIETE combinaciones distintas de clases
 * (auditoria 2026-08-16). El encabezado es lo primero que ve el usuario en
 * cada modulo: que cada uno se vea distinto es la version mas visible de
 * "no hay sistema".
 */
describe('EncabezadoDePagina', () => {
  it('el titulo es el h1 de la pagina', () => {
    render(<EncabezadoDePagina titulo="Certificación" />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Certificación')
  })

  it('la bajada es opcional y no deja un parrafo vacio', () => {
    const { container } = render(<EncabezadoDePagina titulo="Seguros" />)
    expect(container.querySelector('p')).toBeNull()
  })

  it('muestra la bajada cuando la hay', () => {
    render(<EncabezadoDePagina titulo="Seguros" bajada="Pólizas y cuotas" />)
    expect(screen.getByText('Pólizas y cuotas')).toBeInTheDocument()
  })

  it('las acciones van a la derecha, no dentro del titulo', () => {
    render(
      <EncabezadoDePagina titulo="Tarifario">
        <button>Nueva tarifa</button>
      </EncabezadoDePagina>,
    )
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).not.toContainElement(screen.getByRole('button', { name: 'Nueva tarifa' }))
  })

  it('usa el token de la escala, no un tamano suelto', () => {
    render(<EncabezadoDePagina titulo="Empresas" />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveClass('text-cifra')
  })
})
