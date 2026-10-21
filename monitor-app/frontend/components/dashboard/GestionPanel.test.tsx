import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GestionPanel } from './GestionPanel'
import { tripsApi } from '@/lib/api/trips'
import { driversApi } from '@/lib/api/drivers'
import { ApiError } from '@/lib/api/client'
import type { Trip } from '@/lib/types'

// El tipo de operación del viaje se cambia con trips.edit_sensitive (TripOperationType).
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: () => true }))
vi.mock('@/lib/api/trips', () => ({
  tripsApi: { assignFleetLink: vi.fn(), patch: vi.fn(), resetField: vi.fn(), removeFleetLink: vi.fn() },
}))
vi.mock('@/lib/api/drivers', () => ({
  driversApi: { fuzzyMatch: vi.fn(), search: vi.fn() },
}))
vi.mock('@/lib/api/config', () => ({
  taxonomiesApi: { list: vi.fn().mockResolvedValue([]) },
}))
vi.mock('./IndicatorSwitches', () => ({ IndicatorSwitches: () => null }))

const TRIP = {
  id: 't1', carrier_id: null, fleet_link_id: null, planning_date: '2026-10-12',
  driver_name_tms: 'JUAN PEREZ', is_assigned: false, fleet_match_status: 'UNMATCHED',
} as unknown as Trip

const CANDIDATE = {
  driver_id: 'd1', driver_name: 'Juan Pérez', driver_rut: '11.111.111-1', driver_phone: null,
  carrier_id: 'c1', carrier_name: 'Transportes Sur Spa', carrier_operational_status: 'ACTIVE',
  tractor_asset_id: 'a1', tractor_plate: 'ABCD12',
}

function renderPanel(onSaved = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <GestionPanel trip={TRIP} meta={null} onSaved={onSaved} />
    </QueryClientProvider>,
  )
  return onSaved
}

async function pickAndLink() {
  fireEvent.click(await screen.findByText('Juan Pérez'))
  fireEvent.click(screen.getByRole('button', { name: 'Vincular' }))
}

beforeEach(() => {
  vi.mocked(tripsApi.assignFleetLink).mockReset()
  vi.mocked(driversApi.fuzzyMatch).mockReset().mockResolvedValue([CANDIDATE] as never)
})

describe('GestionPanel: vincular flota (D1 §7.1)', () => {
  it('si la API rechaza el vínculo (409) muestra su mensaje y no guarda', async () => {
    const message = 'Transportes Sur Spa está dada de baja: no se le asignan viajes.'
    vi.mocked(tripsApi.assignFleetLink).mockRejectedValue(
      new ApiError(message, 409, { code: 'CARRIER_NOT_ACTIVE', message }))
    const onSaved = renderPanel()
    await pickAndLink()
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('vinculado con aviso de empresa no habilitada: lo muestra', async () => {
    const message = 'Transportes Sur Spa no está habilitada: tiene obligatorios vencidos.'
    vi.mocked(tripsApi.assignFleetLink).mockResolvedValue({
      ...TRIP, carrier_id: 'c1', warnings: [{ code: 'CARRIER_NOT_ENABLED', message }],
    } as never)
    const onSaved = renderPanel()
    await pickAndLink()
    expect(await screen.findByText(message)).toBeInTheDocument()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it('una empresa dada de baja se autocompleta y se marca; decide la API', async () => {
    vi.mocked(driversApi.fuzzyMatch).mockResolvedValue([{ ...CANDIDATE, carrier_operational_status: 'INACTIVE' }] as never)
    renderPanel()
    fireEvent.click(await screen.findByText('Juan Pérez'))
    expect(screen.getByLabelText('Empresa de transporte')).toHaveValue('Transportes Sur Spa')
    expect(screen.getByText('Dada de baja')).toBeInTheDocument()
  })
})
