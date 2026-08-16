import { readFile } from 'node:fs/promises'
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
  // Guardarrail del 429. Sin `prefetch={false}`, Next prefetchea cada enlace
  // que entra al viewport, cada prefetch ejecuta el layout del dashboard —que
  // va a la API de Auth— y Supabase responde 429. Medido en staging el
  // 2026-08-15: 104 llamadas a /user en un minuto, sin un solo clic.
  //
  // El prop NO llega al DOM, asi que se verifica sobre el modulo, igual que en
  // CertificationStatusTable.test.tsx. La version anterior de este test miraba
  // un atributo `data-prefetch` que next/link nunca renderiza: pasaba con
  // prefetch puesto y sin poner, o sea que no protegia nada.
  it('ningun enlace de la portada prefetchea', async () => {
    const fuente = await readFile(
      'app/dashboard/admin/configuracion/PortadaDominios.tsx', 'utf-8',
    )
    const enlaces = fuente.split('<Link').slice(1)
    expect(enlaces.length).toBeGreaterThan(0)
    for (const enlace of enlaces) {
      const props = enlace.slice(0, enlace.indexOf('>'))
      expect(props, `un <Link> quedo sin prefetch={false}: ${props.trim().slice(0, 80)}`)
        .toContain('prefetch={false}')
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
