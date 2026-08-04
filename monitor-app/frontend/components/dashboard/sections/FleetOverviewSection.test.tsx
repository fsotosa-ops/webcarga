import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FleetOverviewSection } from './FleetOverviewSection'
import { tripsApi } from '@/lib/api/trips'
import type { FleetDailyOverviewResponse } from '@/lib/types'

vi.mock('@/lib/api/trips', () => ({
  tripsApi: { fleetDailyOverview: vi.fn() },
}))

const DATA: FleetDailyOverviewResponse = {
  fecha: '2026-08-02',
  categories: [
    { category: 'TRACTOREO', assigned: 1, unassigned: 1, utilization_pct: 50.0 },
    { category: 'EQUIPO_COMPLETO', assigned: 0, unassigned: 1, utilization_pct: 0.0 },
    { category: 'SIN_CLASIFICAR', assigned: 0, unassigned: 0, utilization_pct: 0.0 },
  ],
  equipment: [
    {
      asset_id: 'a1', tractor_plate: 'ABCD12', carrier_id: 'c1', carrier_name: 'Transportes Sur',
      categories: ['TRACTOREO'], con_carga: true, trip_id: 't1', client_name: 'Walmart', origin: 'CD Lo Aguirre',
    },
    {
      asset_id: 'a2', tractor_plate: 'WXYZ99', carrier_id: 'c1', carrier_name: 'Transportes Sur',
      categories: ['TRACTOREO'], con_carga: false, trip_id: null, client_name: null, origin: null,
    },
    {
      asset_id: 'a3', tractor_plate: 'ZZZZ99', carrier_id: 'c2', carrier_name: 'RPS Logística',
      categories: ['EQUIPO_COMPLETO'], con_carga: false, trip_id: null, client_name: null, origin: null,
    },
  ],
}

function renderSection(props: Partial<Parameters<typeof FleetOverviewSection>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <FleetOverviewSection fecha="2026-08-02" onSelectTrip={vi.fn()} {...props} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(tripsApi.fleetDailyOverview).mockReset().mockResolvedValue(DATA)
})

describe('FleetOverviewSection', () => {
  it('muestra los 3 tiles de categoría con sus conteos y % de utilización', async () => {
    renderSection()
    expect(await screen.findByRole('button', { name: /Tractoreo/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Equipos Completos/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Sin clasificar/ })).toBeInTheDocument()
    expect(screen.getByText('50% utilización')).toBeInTheDocument()
  })

  it('muestra los 3 equipos con su categoría y estado hoy', async () => {
    renderSection()
    expect(await screen.findByText('ABCD12')).toBeInTheDocument()
    expect(screen.getByText('WXYZ99')).toBeInTheDocument()
    expect(screen.getByText('ZZZZ99')).toBeInTheDocument()
    expect(screen.getByText('Con carga — Walmart')).toBeInTheDocument()
    expect(screen.getAllByText('Sin carga')).toHaveLength(2)
  })

  it('clickear el tile de Tractoreo filtra la tabla a solo esos equipos', async () => {
    renderSection()
    await screen.findByText('ZZZZ99')
    fireEvent.click(screen.getByRole('button', { name: /Tractoreo/ }))
    expect(screen.getByText('ABCD12')).toBeInTheDocument()
    expect(screen.getByText('WXYZ99')).toBeInTheDocument()
    expect(screen.queryByText('ZZZZ99')).not.toBeInTheDocument()
  })

  it('clickear "Ver viaje" de un equipo con carga llama a onSelectTrip con el trip_id', async () => {
    const onSelectTrip = vi.fn()
    renderSection({ onSelectTrip })
    await screen.findByText('ABCD12')
    fireEvent.click(screen.getByRole('button', { name: 'Ver viaje' }))
    expect(onSelectTrip).toHaveBeenCalledWith('t1')
  })

  it('el buscador filtra por patente, empresa o cliente', async () => {
    renderSection()
    await screen.findByText('ABCD12')
    fireEvent.change(screen.getByPlaceholderText(/Buscar patente/), { target: { value: 'RPS' } })
    expect(screen.getByText('ZZZZ99')).toBeInTheDocument()
    expect(screen.queryByText('ABCD12')).not.toBeInTheDocument()
  })
})
