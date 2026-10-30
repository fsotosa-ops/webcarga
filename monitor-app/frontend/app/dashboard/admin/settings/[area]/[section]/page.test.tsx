import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { Suspense } from 'react'

const noEncontrado = vi.fn()
const reemplazar = vi.fn()
vi.mock('next/navigation', () => ({
  notFound: () => { noEncontrado(); throw new Error('NEXT_NOT_FOUND') },
  useRouter: () => ({ replace: reemplazar }),
  useSearchParams: () => new URLSearchParams(busqueda),
}))
let busqueda = ''
let permisos: string[] = ['operations.configure']
vi.mock('@/lib/authz/PermisosProvider', () => ({ useAcceso: () => ({ permissions: permisos }) }))
vi.mock('../../paneles', () => ({
  SECCIONES_CON_LISTA: [],
  EstadosDelViajePanel: () => <div>panel estados</div>,
  EstadosOperacionalesPanel: () => null, EstadosDeEquipoPanel: () => null,
  MotivosDeConductorPanel: () => <div>panel motivos</div>,
  MotivosDeNoAsignacionPanel: () => null, MotivosDeAnulacionPanel: () => null, NombresDeRellenoPanel: () => null,
  SubtiposPanel: () => null, TiposDeOperacionPanel: () => null,
  MotivosDeBajaPanel: () => null, MotivosDeReactivacionPanel: () => null,
  MotivosDeActivacionExcepcionalPanel: () => null,
  MotivosDeVolverAOnboardingPanel: () => null,
  AlertasDeDocumentosPanel: () => null, AlertasDePolizasPanel: () => null,
  RangosDeTemperaturaPanel: () => null, UmbralesDelMonitorPanel: () => null,
}))
vi.mock('../../usuarios-tab', () => ({ UsuariosTab: () => null }))
vi.mock('../../roles-tab', () => ({ RolesTab: () => null }))

import SectionPage from './page'

async function montar(area: string, section: string) {
  await act(async () => {
    render(<Suspense fallback={null}><SectionPage params={Promise.resolve({ area, section })} /></Suspense>)
  })
}

beforeEach(() => { noEncontrado.mockClear(); reemplazar.mockClear(); permisos = ['operations.configure']; busqueda = '' })

describe('/settings/[area]/[section]', () => {
  it('dibuja la sección: su título, su propósito y su panel', async () => {
    await montar('operations', 'driver-reasons')
    expect(screen.getByRole('heading', { name: 'Motivos de conductor' })).toBeInTheDocument()
    expect(screen.getByText('Por qué un conductor no está disponible')).toBeInTheDocument()
    expect(screen.getByText('panel motivos')).toBeInTheDocument()
  })

  it('P1.8: ofrece volver al índice ("‹ Configuración") para el teléfono', async () => {
    await montar('operations', 'driver-reasons')
    expect(screen.getByRole('link', { name: /Configuración/ })).toHaveAttribute('href', '/dashboard/admin/settings')
  })

  it('P3.7: Orígenes y Clientes del TMS se mudaron: sus direcciones llevan a su lugar nuevo', async () => {
    await montar('operations', 'origins')
    expect(reemplazar).toHaveBeenCalledWith('/dashboard/pricing?origen=1')
    await montar('operations', 'tms-clients')
    expect(reemplazar).toHaveBeenCalledWith('/dashboard/clients?vista=sin-vincular')
    expect(noEncontrado).not.toHaveBeenCalled()
  })

  it('P2.5: Condiciones de documentos se mudó a Certificación › Documentos exigidos', async () => {
    await montar('certification', 'conditions')
    expect(reemplazar).toHaveBeenCalledWith('/dashboard/compliance/requirements')
    busqueda = 'doc=SOAP'
    await montar('certification', 'conditions')
    expect(reemplazar).toHaveBeenCalledWith('/dashboard/compliance/requirements?doc=SOAP')
    expect(noEncontrado).not.toHaveBeenCalled()
  })

  it('una sección inexistente o de un área que no ve es un 404', async () => {
    await expect(montar('operations', 'inventada')).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(montar('people', 'users')).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
