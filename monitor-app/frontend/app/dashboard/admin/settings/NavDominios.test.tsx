import { readFile } from 'node:fs/promises'
import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
// Quien administra personas: ve todos los dominios (Personas y accesos exige users.manage).
const acceso = vi.hoisted(() => ({ permissions: ['users.manage'] as string[] }))
vi.mock('@/lib/authz/PermisosProvider', () => ({ useAcceso: () => acceso }))
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
    render(<NavDominios activo="certification" />)
    expect(screen.getByRole('link', { name: /operaciones/i }))
      .toHaveAttribute('href', '/dashboard/admin/settings/operations')
  })

  it('marca cual es el dominio activo', () => {
    render(<NavDominios activo="certification" />)
    expect(screen.getByText('Certificación').closest('[aria-current]'))
      .toHaveAttribute('aria-current', 'page')
  })

  it('un dominio proximamente no es alcanzable', () => {
    render(<NavDominios activo="certification" />)
    expect(screen.queryByRole('link', { name: /facturación/i })).not.toBeInTheDocument()
  })

  // Mismo guardarrail del 429 que la portada: esta barra se dibuja en cada
  // pagina de dominio, asi que un <Link> sin prefetch={false} aca se multiplica
  // por todas ellas. El prop no llega al DOM; se verifica sobre el modulo.
  it('ningun enlace de la barra prefetchea', async () => {
    const fuente = await readFile(
      'app/dashboard/admin/settings/NavDominios.tsx', 'utf-8',
    )
    const enlaces = fuente.split('<Link').slice(1)
    expect(enlaces.length).toBeGreaterThan(0)
    for (const enlace of enlaces) {
      const props = enlace.slice(0, enlace.indexOf('>'))
      expect(props, `un <Link> quedo sin prefetch={false}: ${props.trim().slice(0, 80)}`)
        .toContain('prefetch={false}')
    }
  })

  it('sin users.manage no ofrece Personas y accesos (la API daría 403)', () => {
    acceso.permissions = ['operations.configure']
    render(<NavDominios activo="operations" />)
    expect(screen.queryByRole('link', { name: 'Personas y accesos' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Operaciones' })).toBeInTheDocument()
    acceso.permissions = ['users.manage']
  })
})
