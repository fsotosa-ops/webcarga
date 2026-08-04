import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FleetDriverGapCard } from './FleetDriverGapCard'

vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { fleetDriverGap: vi.fn() },
}))

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <FleetDriverGapCard />
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  const { carriersApi } = await import('@/lib/api/carriers')
  vi.mocked(carriersApi.fleetDriverGap).mockReset()
})

describe('FleetDriverGapCard', () => {
  it('no renderiza nada cuando no hay inconsistencias', async () => {
    const { carriersApi } = await import('@/lib/api/carriers')
    vi.mocked(carriersApi.fleetDriverGap).mockResolvedValue({ rows: [] })

    const { container } = renderCard()

    await vi.waitFor(() => expect(carriersApi.fleetDriverGap).toHaveBeenCalled())
    expect(container.firstChild).toBeNull()
  })

  it('muestra el conteo del header y cada fila con gap positivo/negativo', async () => {
    const { carriersApi } = await import('@/lib/api/carriers')
    vi.mocked(carriersApi.fleetDriverGap).mockResolvedValue({
      rows: [
        { carrier_id: 'c1', business_name: 'Transportes Sur', n_tractos: 3, n_conductores: 2, gap: 1 },
        { carrier_id: 'c2', business_name: 'Rios Ltda', n_tractos: 2, n_conductores: 4, gap: -2 },
      ],
    })

    renderCard()

    expect(await screen.findByText('2 empresas con desbalance de dotación')).toBeInTheDocument()
    expect(screen.getByText('Transportes Sur')).toBeInTheDocument()
    expect(screen.getByText(/Faltan 1 conductor/)).toBeInTheDocument()
    expect(screen.getByText('Rios Ltda')).toBeInTheDocument()
    expect(screen.getByText(/2 conductores de más/)).toBeInTheDocument()
  })

  it('no renderiza nada mientras carga', () => {
    const promise = new Promise(() => {}) // nunca resuelve
    return import('@/lib/api/carriers').then(({ carriersApi }) => {
      vi.mocked(carriersApi.fleetDriverGap).mockReturnValue(promise as never)
      const { container } = renderCard()
      expect(container.firstChild).toBeNull()
    })
  })
})
