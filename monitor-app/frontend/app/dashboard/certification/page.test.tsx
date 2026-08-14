import { render } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const redirectMock = vi.fn()
vi.mock('next/navigation', () => ({ redirect: (u: string) => redirectMock(u) }))

import CertificationRedirect from './page'

describe('redirección de la ruta vieja de Certificación', () => {
  beforeEach(() => redirectMock.mockClear())

  it('preserva el carrier_id al redirigir', () => {
    // ?carrier_id= es un contrato en uso desde la Ronda 88: lo emiten los links
    // de salida de la ficha de empresa, del panel de conductor y del de vehículo.
    render(<CertificationRedirect searchParams={{ carrier_id: 'c1' }} />)
    expect(redirectMock).toHaveBeenCalledWith('/dashboard/compliance?carrier_id=c1')
  })

  it('redirige sin query cuando no hay parámetros', () => {
    render(<CertificationRedirect searchParams={{}} />)
    expect(redirectMock).toHaveBeenCalledWith('/dashboard/compliance')
  })
})
