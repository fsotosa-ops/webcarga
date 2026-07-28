import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LocationsTable } from './LocationsTable'
import { locationsApi } from '@/lib/api/locations'
import type { Location } from '@/lib/types'

vi.mock('@/lib/api/locations', () => ({
  locationsApi: { patch: vi.fn(), createRate: vi.fn() },
}))

const LOCATION: Location = {
  id: 'loc-1', entity_type: 'SHIPPER', entity_id: 'shipper-1', site_number: '72',
  name: 'Alameda', country_code: 'CL', format: null, address: null, region_name: null,
  region_number: null, opens_at: null, closes_at: null, operation_type: 'RM',
  operational_status: 'ACTIVE', is_manual_override: false, created_at: null, updated_at: null,
  current_rate: null, current_rate_valid_from: null, current_rate_valid_to: null,
}

beforeEach(() => {
  vi.mocked(locationsApi.patch).mockReset()
  vi.mocked(locationsApi.createRate).mockReset()
})

describe('LocationsTable', () => {
  it('renders one row per location', () => {
    render(<LocationsTable items={[LOCATION]} onChanged={vi.fn()} />)
    expect(screen.getByDisplayValue('Alameda')).toBeInTheDocument()
  })

  it('shows "Sin tarifa" and reveals inputs only after clicking Editar tarifa', () => {
    render(<LocationsTable items={[LOCATION]} onChanged={vi.fn()} />)

    expect(screen.getByText('Sin tarifa')).toBeInTheDocument()
    expect(screen.queryByLabelText('Tarifa de Alameda')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Editar tarifa de Alameda'))

    expect(screen.getByLabelText('Tarifa de Alameda')).toBeInTheDocument()
  })

  it('saving a tariff calls createRate, not patch', async () => {
    vi.mocked(locationsApi.createRate).mockResolvedValue({
      id: 'r1', location_id: 'loc-1', tarifa: '450.000 CLP', valid_from: '2026-07-27', valid_to: null,
      created_at: null, updated_at: null,
    })
    const onChanged = vi.fn()
    render(<LocationsTable items={[LOCATION]} onChanged={onChanged} />)

    fireEvent.click(screen.getByLabelText('Editar tarifa de Alameda'))
    fireEvent.change(screen.getByLabelText('Tarifa de Alameda'), { target: { value: '450.000 CLP' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(locationsApi.createRate).toHaveBeenCalledWith('loc-1', {
      tarifa: '450.000 CLP', valid_from: undefined, valid_to: null,
    }))
    expect(locationsApi.patch).not.toHaveBeenCalled()
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('editing clasificación calls patch, not createRate', async () => {
    vi.mocked(locationsApi.patch).mockResolvedValue({ ...LOCATION, operation_type: 'Z0' })
    render(<LocationsTable items={[LOCATION]} onChanged={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Clasificación de Alameda'), { target: { value: 'Z0' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(locationsApi.patch).toHaveBeenCalledWith('loc-1', {
      name: 'Alameda', format: null, address: null, operation_type: 'Z0',
    }))
    expect(locationsApi.createRate).not.toHaveBeenCalled()
  })

  it('toggling Activo/Inactivo calls patch immediately', async () => {
    vi.mocked(locationsApi.patch).mockResolvedValue({ ...LOCATION, operational_status: 'INACTIVE' })
    render(<LocationsTable items={[LOCATION]} onChanged={vi.fn()} />)

    fireEvent.click(screen.getByLabelText('Desactivar Alameda'))

    await waitFor(() => expect(locationsApi.patch).toHaveBeenCalledWith('loc-1', { operational_status: 'INACTIVE' }))
  })

  it('shows an "auto-classified" dot next to classification when not manually overridden', () => {
    render(<LocationsTable items={[LOCATION]} onChanged={vi.fn()} />)
    expect(screen.getByTitle('Clasificado automáticamente')).toBeInTheDocument()
  })

  it('does not show the auto-classified dot when classification was manually overridden', () => {
    render(<LocationsTable items={[{ ...LOCATION, is_manual_override: true }]} onChanged={vi.fn()} />)
    expect(screen.queryByTitle('Clasificado automáticamente')).not.toBeInTheDocument()
  })
})
