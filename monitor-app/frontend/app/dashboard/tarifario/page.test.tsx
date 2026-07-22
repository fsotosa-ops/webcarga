import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TarifarioPage from './page'
import { locationsApi, shippersApi, type Shipper } from '@/lib/api/locations'
import type { Location } from '@/lib/types'

vi.mock('@/lib/api/locations', () => ({
  locationsApi: { list: vi.fn(), create: vi.fn(), createRate: vi.fn(), patchRate: vi.fn(), listRates: vi.fn() },
  shippersApi: { list: vi.fn() },
}))

const SHIPPER: Shipper = { id: 'shipper-1', name: 'Walmart', status: 'ACTIVE' }
const LOCATION: Location = {
  id: 'loc-1', entity_type: 'SHIPPER', entity_id: 'shipper-1', site_number: '72',
  name: 'Alameda', country_code: 'CL', format: null, address: null, region_name: null,
  region_number: null, opens_at: null, closes_at: null, operation_type: 'RM',
  operational_status: 'ACTIVE', created_at: null, updated_at: null,
  current_rate: null, current_rate_valid_from: null, current_rate_valid_to: null,
}

beforeEach(() => {
  vi.mocked(shippersApi.list).mockReset().mockResolvedValue([SHIPPER])
  vi.mocked(locationsApi.list).mockReset().mockResolvedValue([LOCATION])
  vi.mocked(locationsApi.createRate).mockReset()
  vi.mocked(locationsApi.create).mockReset()
})

async function selectShipper() {
  render(<TarifarioPage />)
  fireEvent.change(await screen.findByLabelText('Generador de carga'), { target: { value: 'shipper-1' } })
  await screen.findByText('Alameda')
}

describe('TarifarioPage', () => {
  it('prompts to pick a generador de carga before showing anything', async () => {
    render(<TarifarioPage />)
    await screen.findByText('Elegí un generador de carga para ver sus locales.')
  })

  it('lists locations for the selected shipper with include_rate requested', async () => {
    await selectShipper()
    expect(locationsApi.list).toHaveBeenCalledWith({ entity_type: 'SHIPPER', entity_id: 'shipper-1', include_rate: true })
  })

  it('saving a tariff calls createRate, not patch, and reloads the list', async () => {
    vi.mocked(locationsApi.createRate).mockResolvedValue({
      id: 'r1', location_id: 'loc-1', tarifa: '450.000 CLP', valid_from: '2026-07-22', valid_to: null,
      created_at: null, updated_at: null,
    })
    await selectShipper()

    fireEvent.change(screen.getByLabelText('Tarifa de Alameda'), { target: { value: '450.000 CLP' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(locationsApi.createRate).toHaveBeenCalledWith('loc-1', {
      tarifa: '450.000 CLP', valid_from: undefined, valid_to: null,
    }))
    expect(locationsApi.patchRate).not.toHaveBeenCalled()
    await waitFor(() => expect(locationsApi.list).toHaveBeenCalledTimes(2))
  })

  it('lets the user create a new local from the same page', async () => {
    vi.mocked(locationsApi.create).mockResolvedValue({ ...LOCATION, id: 'loc-2', name: 'Local Nuevo' })
    await selectShipper()

    fireEvent.click(screen.getByText('Nuevo local'))
    fireEvent.change(screen.getByLabelText('Nombre del local nuevo'), { target: { value: 'Local Nuevo' } })
    fireEvent.click(screen.getByText('Crear local'))

    await waitFor(() => expect(screen.getByText('Local Nuevo')).toBeInTheDocument())
  })
})
