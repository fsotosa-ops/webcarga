import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { PortadaDominios } from './PortadaDominios'
import { DOMINIOS } from './dominios'

describe('PortadaDominios', () => {
  // Se afirma sobre el registro, no sobre una lista escrita a mano: si manana
  // se agrega un dominio, este test lo cubre solo. Escribir los nombres aca
  // seria una segunda fuente de verdad de lo que hay en el modulo.
  it('muestra una tarjeta por dominio, con su proposito', () => {
    render(<PortadaDominios />)
    for (const d of DOMINIOS) {
      expect(screen.getByText(d.titulo), d.clave).toBeInTheDocument()
      expect(screen.getByText(d.proposito), d.clave).toBeInTheDocument()
    }
  })

  it('cada dominio visitable enlaza a su ruta', () => {
    render(<PortadaDominios />)
    expect(screen.getByRole('link', { name: /certificación/i }))
      .toHaveAttribute('href', '/dashboard/admin/configuracion/certificacion')
  })

  // El prefetch ejecuta el layout del dashboard, que habla con Auth: eso
  // produjo un 429 en produccion (Ronda 110). No es decorativo.
  it('los enlaces no hacen prefetch', () => {
    render(<PortadaDominios />)
    for (const a of screen.getAllByRole('link')) {
      expect(a.getAttribute('data-prefetch')).not.toBe('true')
    }
  })

  it('un dominio proximamente no es un enlace', () => {
    render(<PortadaDominios />)
    expect(screen.getByText('Facturación')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /facturación/i })).not.toBeInTheDocument()
  })

  it('dice cuantas secciones tiene cada dominio', () => {
    render(<PortadaDominios />)
    const certificacion = screen.getByText('Certificación').closest('a')!
    expect(certificacion).toHaveTextContent('2 secciones')
  })
})
