import { render as renderCrudo, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi } from 'vitest'
import { SubtiposVehiculoTab, TiposOperacionTab } from './flota-tabs'

vi.mock('@/lib/api/config', () => ({
  taxonomiesApi: { list: vi.fn().mockResolvedValue([]) },
  revisionesApi: { list: vi.fn().mockResolvedValue([]), confirm: vi.fn() },
  configApi: {},
}))

// Las secciones muestran el registro de revisión, que es react-query.
function render(ui: React.ReactElement) {
  return renderCrudo(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </QueryClientProvider>,
  )
}

describe('secciones de Flota', () => {
  it('subtipos de vehiculo pide el dominio correcto', async () => {
    const { taxonomiesApi } = await import('@/lib/api/config')
    render(<SubtiposVehiculoTab />)
    expect(taxonomiesApi.list).toHaveBeenCalledWith('FLEET_SERVICE_TYPE')
  })

  it('tipos de operacion pide el dominio correcto', async () => {
    const { taxonomiesApi } = await import('@/lib/api/config')
    render(<TiposOperacionTab />)
    expect(taxonomiesApi.list).toHaveBeenCalledWith('WEBCARGA_OPERATION_TYPE')
  })

  // Es vocabulario COMPARTIDO: quien lo edita tiene que saber que toca a otros
  // modulos. Sin esto, alguien cambia un subtipo pensando solo en su pantalla.
  it('avisa que el vocabulario lo comparten otros modulos', () => {
    render(<SubtiposVehiculoTab />)
    expect(screen.getByText(/certificación/i)).toBeInTheDocument()
  })
})
