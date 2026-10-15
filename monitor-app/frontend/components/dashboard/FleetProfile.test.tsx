import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: () => true }))
vi.mock('@/lib/api/drivers', () => ({
  driversApi: { get: vi.fn(), assignments: vi.fn(), activity: vi.fn(), listComplianceRecords: vi.fn(), listContacts: vi.fn() },
}))
vi.mock('@/lib/api/locations', () => ({ locationsApi: { list: vi.fn().mockResolvedValue({ data: [] }) } }))

import { driversApi } from '@/lib/api/drivers'
import { FleetProfile } from './FleetProfile'

const DRIVER = {
  id: 'd1', full_name: 'Vidal Soto, Pedro', tax_id: '12345678-5', country_code: 'CL', operational_status: 'ACTIVE',
  is_manual_override: false, created_at: null, total_requirements: 0, home_location_id: null,
}

function renderProfile() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FleetProfile kind="driver" id="d1" />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(driversApi.get).mockResolvedValue(DRIVER as never)
  vi.mocked(driversApi.activity).mockResolvedValue({ trips_30d: 3, last_trip_date: '2026-10-12', last_trip_client: 'Walmart' })
  vi.mocked(driversApi.listComplianceRecords).mockResolvedValue([])
  vi.mocked(driversApi.listContacts).mockResolvedValue([])
})

describe('FleetProfile (D4)', () => {
  it('C5: un conductor sin empresa tiene ficha propia y se puede asignar desde ella', async () => {
    vi.mocked(driversApi.assignments).mockResolvedValue([])
    renderProfile()
    expect(await screen.findByText('Sin empresa asignada.')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /Detalle de Vidal Soto/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Asignar a una empresa/ })).toBeInTheDocument()
  })

  it('C11: "Ver viajes en el Monitor" abre el Monitor filtrado por su RUT', async () => {
    vi.mocked(driversApi.assignments).mockResolvedValue([
      { carrier_id: 'c1', carrier_name: 'Hueraman', carrier_status: 'ACTIVE', valid_from: null, valid_until: null, current: true },
    ])
    renderProfile()
    expect(await screen.findByRole('link', { name: /Ver viajes en el Monitor/ }))
      .toHaveAttribute('href', '/dashboard/operations/monitor?tab=historial&q=12345678-5')
  })
})
