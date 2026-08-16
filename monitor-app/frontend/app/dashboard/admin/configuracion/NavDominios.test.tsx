import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { NavDominios } from './NavDominios'

describe('NavDominios', () => {
  // La objecion al diseno de portada era "un clic mas para lo de todos los
  // dias". Se cierra aca: desde adentro de un dominio se salta a otro sin
  // volver a la portada.
  // NOTA: el plan original tambien afirmaba sobre un link "Flota", pero ese
  // dominio no existe todavia -- lo agrega la Task 4, deliberadamente fuera
  // de esta tarea (ver dominios.ts). Afirmar sobre el no es posible sin
  // adelantar esa tarea, asi que se deja fuera de esta asercion; ver el
  // reporte de esta tarea para el detalle.
  it('ofrece los otros dominios sin volver a la portada', () => {
    render(<NavDominios activo="certificacion" />)
    expect(screen.getByRole('link', { name: /operaciones/i }))
      .toHaveAttribute('href', '/dashboard/admin/configuracion/operaciones')
  })

  it('marca cual es el dominio activo', () => {
    render(<NavDominios activo="certificacion" />)
    expect(screen.getByText('Certificación').closest('[aria-current]'))
      .toHaveAttribute('aria-current', 'page')
  })

  it('un dominio proximamente no es alcanzable', () => {
    render(<NavDominios activo="certificacion" />)
    expect(screen.queryByRole('link', { name: /facturación/i })).not.toBeInTheDocument()
  })
})
