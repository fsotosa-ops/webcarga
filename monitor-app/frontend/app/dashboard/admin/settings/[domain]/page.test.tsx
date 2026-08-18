import { act, render, screen } from '@testing-library/react'
import { Suspense } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Los paneles reales piden datos; acá sólo importa el marco del dominio.
vi.mock('../estados-tabs', () => ({
  EstadosOperacionalesTab: () => <div>panel operacionales</div>,
  EstadosEquipoTab: () => <div>panel equipo</div>,
  TaxonomyTab: () => <div>panel taxonomia</div>,
}))
vi.mock('../estados-tabla', () => ({
  EstadosTabla: () => <div>panel estados tms</div>,
}))
vi.mock('../umbrales-tabs', () => ({
  AlertasVencimientoTab: () => <div>panel vencimientos</div>,
  RangosTemperaturaTab: () => <div>panel temperaturas</div>,
  AlertasMonitorTab: () => <div>panel umbrales</div>,
}))
vi.mock('../condiciones-tabla', () => ({
  CondicionesTabla: () => <div>panel condiciones</div>,
}))
vi.mock('../flota-tabs', () => ({
  SubtiposVehiculoTab: () => <div>panel subtipos</div>,
  TiposOperacionTab: () => <div>panel tipos de operacion</div>,
  MotivosConductorTab: () => <div>panel motivos</div>,
  MotivosNoAsignacionTab: () => <div>panel motivos no asignacion</div>,
}))
vi.mock('../usuarios-tab', () => ({ UsuariosTab: () => <div>panel usuarios</div> }))
// El buscador es react-query y consulta la API; acá sólo importa el marco.
vi.mock('../BuscadorConfig', () => ({ BuscadorConfig: () => <div>buscador</div> }))

const noEncontrado = vi.fn()
const reemplazar = vi.fn()
vi.mock('next/navigation', () => ({
  notFound: () => { noEncontrado(); throw new Error('NEXT_NOT_FOUND') },
  useRouter: () => ({ replace: reemplazar }),
  useSearchParams: () => new URLSearchParams(seccionEnLaUrl),
}))
// La seccion viaja en la URL; cada test elige que trae.
let seccionEnLaUrl = ''

import DominioPage from './page'

// `params` llega como PROMESA (Next 15+). Los tests que le pasan un objeto
// plano no ejercitan el contrato real: asi fue como esta pagina llego a
// produccion llamando a notFound() para TODOS los dominios, con tsc y el build
// en verde. El helper existe para que nadie vuelva a pasar un objeto.
async function montar(slug: string) {
  // `use()` suspende hasta que la promesa resuelve, asi que el montaje va
  // dentro de act: sin esto React avisa que se suspendio fuera de un act.
  await act(async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Suspense fallback={<div>cargando</div>}>
          <DominioPage params={Promise.resolve({ domain: slug })} />
        </Suspense>
      </QueryClientProvider>,
    )
  })
}

describe('página de dominio', () => {
  beforeEach(() => { seccionEnLaUrl = ''; reemplazar.mockClear() })

  it('con params como promesa dibuja el dominio, no un 404', async () => {
    await montar('fleet')
    expect(screen.getByRole('heading', { name: 'Flota' })).toBeInTheDocument()
    expect(noEncontrado).not.toHaveBeenCalled()
  })

  it('muestra las secciones del dominio y abre la primera', async () => {
    await montar('fleet')
    expect(screen.getByRole('tab', { name: /subtipos de vehículo/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /tipos de operación/i })).toBeInTheDocument()
    expect(screen.getByText('panel subtipos')).toBeInTheDocument()
  })

  it('ofrece los otros dominios sin volver a la portada', async () => {
    await montar('fleet')
    expect(screen.getByRole('link', { name: 'Operaciones' })).toBeInTheDocument()
  })

  it('un dominio reservado no es visitable', async () => {
    await montar('billing').catch(() => {})
    expect(noEncontrado).toHaveBeenCalled()
  })

  // La seccion VIAJA EN LA URL, como la vista de /dashboard/compliance. Con
  // useState era estado privado: no se podia enlazar una seccion, compartirla,
  // ni volver con el boton de atras, y recargar te devolvia a la primera.
  it('abre la seccion que pide la URL, no siempre la primera', async () => {
    seccionEnLaUrl = 'section=operation-types'
    await montar('fleet')
    expect(screen.getByText('panel tipos de operacion')).toBeInTheDocument()
  })

  it('cambiar de seccion la escribe en la URL', async () => {
    await montar('fleet')
    screen.getByRole('tab', { name: /tipos de operación/i }).click()
    expect(reemplazar).toHaveBeenCalledWith('/dashboard/admin/settings/fleet?section=operation-types')
  })

  // La primera seccion es la ruta limpia: la URL no se ensucia con el valor
  // por defecto.
  it('volver a la primera seccion deja la ruta limpia', async () => {
    seccionEnLaUrl = 'section=operation-types'
    await montar('fleet')
    screen.getByRole('tab', { name: /subtipos de vehículo/i }).click()
    expect(reemplazar).toHaveBeenCalledWith('/dashboard/admin/settings/fleet')
  })

  // Degradar a la primera seccion esta bien; dejar el valor invalido en la
  // barra de direcciones no, porque ese enlace se marca y se comparte.
  it('una seccion inventada no se queda en la URL', async () => {
    seccionEnLaUrl = 'section=inventada'
    await montar('fleet')
    expect(screen.getByText('panel subtipos')).toBeInTheDocument()
    expect(reemplazar).toHaveBeenCalledWith('/dashboard/admin/settings/fleet')
  })

  // La otra mitad: corregir de mas seria reescribir la URL en cada visita.
  it('una seccion valida no reescribe la URL', async () => {
    seccionEnLaUrl = 'section=operation-types'
    await montar('fleet')
    expect(reemplazar).not.toHaveBeenCalled()
  })

  // Sin esto la unica salida era el navegador o la barra lateral, que lleva a
  // OTRO dominio y no al inventario.
  it('ofrece la vuelta al inventario de configuracion', async () => {
    await montar('fleet')
    expect(screen.getByRole('link', { name: /^Configuración/ }))
      .toHaveAttribute('href', '/dashboard/admin/settings')
  })
})
