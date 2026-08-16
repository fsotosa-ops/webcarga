import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

import AreaNoEncontrada from './not-found'

describe('area de configuracion no encontrada', () => {
  // Antes esto era el 404 pelado de Next: sin la app alrededor y sin salida.
  it('ofrece la vuelta al inventario', () => {
    render(<AreaNoEncontrada />)
    expect(screen.getByRole('link', { name: /^Configuración/ }))
      .toHaveAttribute('href', '/dashboard/admin/settings')
  })

  // La salida util no es "volver", es la lista de lo que si existe: quien
  // teclea /facturacion tiene que poder ir a donde queria de un clic.
  it('nombra las areas que si existen', () => {
    render(<AreaNoEncontrada />)
    expect(screen.getByRole('link', { name: 'Certificación' }))
      .toHaveAttribute('href', '/dashboard/admin/settings/certification')
    expect(screen.getByRole('link', { name: 'Operaciones' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Flota' })).toBeInTheDocument()
  })

  // Facturacion es un dominio reservado: listarlo aca seria ofrecer otra vez
  // la puerta que acaba de no abrir.
  it('no ofrece un area reservada', () => {
    render(<AreaNoEncontrada />)
    expect(screen.queryByRole('link', { name: 'Facturación' })).not.toBeInTheDocument()
  })
})
