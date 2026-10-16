import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { LocationsTable } from './LocationsTable'
import { locationsApi } from '@/lib/api/locations'
import type { Location } from '@/lib/types'

vi.mock('@/lib/api/locations', () => ({
  locationsApi: { patch: vi.fn(), createRate: vi.fn() },
}))
// Las zonas salen del catálogo de la API (`meta.operation_types`), no del componente.
vi.mock('@/hooks/useTripsMeta', () => ({
  useTripsMeta: () => ({ data: { operation_types: [{ id: 'RM', label: 'RM' }, { id: 'Z0', label: 'Zona Cero' }, { id: 'ZX', label: 'Zona Nueva' }] } }),
}))

const LOCATION: Location = {
  id: 'loc-1', entity_type: 'SHIPPER', entity_id: 'shipper-1', site_number: '72',
  name: 'Alameda', country_code: 'CL', format: null, address: null, region_name: null,
  region_number: null, opens_at: null, closes_at: null, operation_type: 'RM',
  operational_status: 'ACTIVE', is_manual_override: false, is_origin: false, created_at: null, updated_at: null,
  current_rate: null, current_rate_valid_from: null, current_rate_valid_to: null,
}

beforeEach(() => {
  vi.mocked(locationsApi.patch).mockReset()
  vi.mocked(locationsApi.createRate).mockReset()
})

describe('LocationsTable', () => {
  it('renders one row per location', () => {
    render(<LocationsTable items={[LOCATION]} onChanged={vi.fn()} canEdit />)
    expect(screen.getByDisplayValue('Alameda')).toBeInTheDocument()
  })

  it('shows "Sin tarifa" and reveals inputs only after clicking Editar tarifa', () => {
    render(<LocationsTable items={[LOCATION]} onChanged={vi.fn()} canEdit />)

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
    render(<LocationsTable items={[LOCATION]} onChanged={onChanged} canEdit />)

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
    render(<LocationsTable items={[LOCATION]} onChanged={vi.fn()} canEdit />)

    fireEvent.change(screen.getByLabelText('Clasificación de Alameda'), { target: { value: 'Z0' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(locationsApi.patch).toHaveBeenCalledWith('loc-1', {
      name: 'Alameda', format: null, address: null, operation_type: 'Z0',
    }))
    expect(locationsApi.createRate).not.toHaveBeenCalled()
  })

  it('toggling Activo/Inactivo calls patch immediately', async () => {
    vi.mocked(locationsApi.patch).mockResolvedValue({ ...LOCATION, operational_status: 'INACTIVE' })
    render(<LocationsTable items={[LOCATION]} onChanged={vi.fn()} canEdit />)

    fireEvent.click(screen.getByLabelText('Desactivar Alameda'))

    await waitFor(() => expect(locationsApi.patch).toHaveBeenCalledWith('loc-1', { operational_status: 'INACTIVE' }))
  })

  it('shows an "auto-classified" dot next to classification when not manually overridden', () => {
    render(<LocationsTable items={[LOCATION]} onChanged={vi.fn()} canEdit />)
    expect(screen.getByTitle('Clasificado automáticamente')).toBeInTheDocument()
  })

  it('does not show the auto-classified dot when classification was manually overridden', () => {
    render(<LocationsTable items={[{ ...LOCATION, is_manual_override: true }]} onChanged={vi.fn()} canEdit />)
    expect(screen.queryByTitle('Clasificado automáticamente')).not.toBeInTheDocument()
  })

  it('marcar un lugar como Origen lo guarda al instante', async () => {
    vi.mocked(locationsApi.patch).mockResolvedValue({ ...LOCATION, is_origin: true })
    const onChanged = vi.fn()
    render(<LocationsTable items={[LOCATION]} onChanged={onChanged} canEdit />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Origen: Alameda' }))

    await waitFor(() => expect(locationsApi.patch).toHaveBeenCalledWith('loc-1', { is_origin: true }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('las zonas del selector son las del catálogo', () => {
    render(<LocationsTable items={[LOCATION]} onChanged={vi.fn()} canEdit />)
    const opciones = Array.from((screen.getByLabelText('Clasificación de Alameda') as HTMLSelectElement).options)
    expect(opciones.map(o => o.textContent)).toEqual(['Sin clasificar', 'RM', 'Zona Cero', 'Zona Nueva'])
  })

  it('ninguna zona está escrita en el componente', () => {
    const fuente = readFileSync(join(__dirname, 'LocationsTable.tsx'), 'utf8')
    expect(fuente).not.toMatch(/['"](RM|Z0|Region Norte|Region Sur)['"]/)
  })

  it('sin permiso de edición se lee todo y no hay un solo control', () => {
    render(<LocationsTable items={[{ ...LOCATION, is_origin: true }]} onChanged={vi.fn()} canEdit={false} />)
    const fila = within(screen.getAllByRole('row')[1])
    for (const texto of ['Alameda', 'RM', 'Sin tarifa', 'Activo', 'Origen']) expect(fila.getByText(texto)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('sin lugares dice que no hay, sin una tabla vacía', () => {
    render(<LocationsTable items={[]} onChanged={vi.fn()} canEdit />)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByText('Sin lugares para este filtro')).toBeInTheDocument()
  })
})
