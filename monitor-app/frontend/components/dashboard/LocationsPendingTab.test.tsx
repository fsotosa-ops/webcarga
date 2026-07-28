import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LocationsPendingTab } from './LocationsPendingTab'
import { locationsApi } from '@/lib/api/locations'
import type { Location } from '@/lib/types'

vi.mock('@/lib/api/locations', () => ({
  locationsApi: { patch: vi.fn() },
}))

const LOCATION: Location = {
  id: 'loc-9', entity_type: 'SHIPPER', entity_id: 'shipper-1', site_number: null,
  name: 'Empresas Carozzi S.A.', country_code: 'CL', format: null, address: null,
  region_name: null, region_number: null, opens_at: null, closes_at: null,
  operation_type: null, operational_status: 'ACTIVE', is_manual_override: false,
  created_at: null, updated_at: null,
}

beforeEach(() => {
  vi.mocked(locationsApi.patch).mockReset()
})

describe('LocationsPendingTab', () => {
  it('shows one card per pending location with its generador de carga', () => {
    render(<LocationsPendingTab items={[LOCATION]} shipperName={() => 'Iansa'} onChanged={vi.fn()} />)
    expect(screen.getByText('Empresas Carozzi S.A.')).toBeInTheDocument()
    expect(screen.getByText(/Iansa/)).toBeInTheDocument()
  })

  it('shows an empty state when there is nothing pending', () => {
    render(<LocationsPendingTab items={[]} shipperName={() => ''} onChanged={vi.fn()} />)
    expect(screen.getByText(/Sin locales por revisar/)).toBeInTheDocument()
  })

  it('classifying a card calls patch with the chosen zone and refreshes', async () => {
    vi.mocked(locationsApi.patch).mockResolvedValue({ ...LOCATION, operation_type: 'Z0' })
    const onChanged = vi.fn()
    render(<LocationsPendingTab items={[LOCATION]} shipperName={() => 'Iansa'} onChanged={onChanged} />)

    fireEvent.change(screen.getByLabelText(`Clasificar ${LOCATION.name}`), { target: { value: 'Z0' } })

    await waitFor(() => expect(locationsApi.patch).toHaveBeenCalledWith('loc-9', { operation_type: 'Z0' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })
})
