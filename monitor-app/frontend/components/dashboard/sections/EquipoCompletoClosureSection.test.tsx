import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { EquipoCompletoClosureSection } from './EquipoCompletoClosureSection'
import type { EquipmentClosureStatus } from '@/lib/types'

vi.mock('@/lib/api/equipmentClosures', () => ({
  equipmentClosuresApi: { get: vi.fn() },
}))

const STATUS: EquipmentClosureStatus = {
  business_date: '2026-08-02',
  closed: false,
  closure: null,
  tractoreo: { summary: { total: 0, assigned: 0, unassigned: 0, utilization_pct: 0 }, equipment: [], pending_count: 0 },
  equipos_completos: {
    summary: { total: 2, assigned: 1, unassigned: 1, utilization_pct: 50.0 },
    by_carrier: [
      { carrier_id: 'c2', carrier_name: 'Equipos Sur', enrolled: 2, assigned: 1, unassigned: 1 },
    ],
  },
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <EquipoCompletoClosureSection fecha="2026-08-02" />
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
  vi.mocked(equipmentClosuresApi.get).mockReset().mockResolvedValue(STATUS)
})

describe('EquipoCompletoClosureSection', () => {
  it('muestra el resumen de Equipos Completos por empresa, sin ninguna acción', async () => {
    renderSection()
    expect(await screen.findByText('50% utilización (no bloquea el cierre)')).toBeInTheDocument()
    expect(screen.getByText('Equipos Sur')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('sin equipos completos hoy, muestra el estado vacío', async () => {
    const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
    vi.mocked(equipmentClosuresApi.get).mockResolvedValue({
      ...STATUS,
      equipos_completos: { summary: { total: 0, assigned: 0, unassigned: 0, utilization_pct: 0 }, by_carrier: [] },
    })
    renderSection()
    expect(await screen.findByText('Sin equipos completos hoy')).toBeInTheDocument()
  })
})
