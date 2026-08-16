import { act, render, screen } from '@testing-library/react'
import { Suspense } from 'react'
import { describe, it, expect, vi } from 'vitest'

// Los paneles reales piden datos; acá sólo importa el marco del dominio.
vi.mock('../estados-tabs', () => ({
  EstadosTmsTab: () => <div>panel estados tms</div>,
  EstadosOperacionalesTab: () => <div>panel operacionales</div>,
  EstadosEquipoTab: () => <div>panel equipo</div>,
  TaxonomyTab: () => <div>panel taxonomia</div>,
}))
vi.mock('../umbrales-tabs', () => ({
  AlertasVencimientoTab: () => <div>panel vencimientos</div>,
  RangosTemperaturaTab: () => <div>panel temperaturas</div>,
  AlertasMonitorTab: () => <div>panel umbrales</div>,
}))
vi.mock('../condiciones-tab', () => ({
  CondicionesDocumentosTab: () => <div>panel condiciones</div>,
}))
vi.mock('../flota-tabs', () => ({
  SubtiposVehiculoTab: () => <div>panel subtipos</div>,
  TiposOperacionTab: () => <div>panel tipos de operacion</div>,
  MotivosConductorTab: () => <div>panel motivos</div>,
}))
vi.mock('../usuarios-tab', () => ({ UsuariosTab: () => <div>panel usuarios</div> }))

const noEncontrado = vi.fn()
vi.mock('next/navigation', () => ({ notFound: () => { noEncontrado(); throw new Error('NEXT_NOT_FOUND') } }))

import DominioPage from './page'

// `params` llega como PROMESA (Next 15+). Los tests que le pasan un objeto
// plano no ejercitan el contrato real: asi fue como esta pagina llego a
// produccion llamando a notFound() para TODOS los dominios, con tsc y el build
// en verde. El helper existe para que nadie vuelva a pasar un objeto.
async function montar(dominio: string) {
  // `use()` suspende hasta que la promesa resuelve, asi que el montaje va
  // dentro de act: sin esto React avisa que se suspendio fuera de un act.
  await act(async () => {
    render(
      <Suspense fallback={<div>cargando</div>}>
        <DominioPage params={Promise.resolve({ dominio })} />
      </Suspense>,
    )
  })
}

describe('página de dominio', () => {
  it('con params como promesa dibuja el dominio, no un 404', async () => {
    await montar('flota')
    expect(screen.getByRole('heading', { name: 'Flota' })).toBeInTheDocument()
    expect(noEncontrado).not.toHaveBeenCalled()
  })

  it('muestra las secciones del dominio y abre la primera', async () => {
    await montar('flota')
    expect(screen.getByRole('tab', { name: /subtipos de vehículo/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /tipos de operación/i })).toBeInTheDocument()
    expect(screen.getByText('panel subtipos')).toBeInTheDocument()
  })

  it('ofrece los otros dominios sin volver a la portada', async () => {
    await montar('flota')
    expect(screen.getByRole('link', { name: 'Operaciones' })).toBeInTheDocument()
  })

  it('un dominio reservado no es visitable', async () => {
    await montar('facturacion').catch(() => {})
    expect(noEncontrado).toHaveBeenCalled()
  })
})
