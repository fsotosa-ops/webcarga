import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiError } from '@/lib/api/client'

vi.mock('@/lib/api/assets', () => ({
  assetsApi: { getDriverAssignment: vi.fn(), assignDriver: vi.fn(), unassignDriver: vi.fn() },
}))
vi.mock('@/lib/api/config', () => ({ taxonomiesApi: { list: vi.fn() } }))
vi.mock('@/hooks/useAssetTypes', () => ({
  useAssetTypes: () => ({ types: [{ code: 'TRACTOCAMION', label: 'Tracto' }, { code: 'RAMPLA', label: 'Rampla' }], labelOf: () => '' }),
}))

import { assetsApi } from '@/lib/api/assets'
import { taxonomiesApi } from '@/lib/api/config'
import { AssetEditForm } from './AssetEditForm'
import type { Asset } from '@/lib/types'

// Reglas que vivían en los tests del panel de equipo (retirado en la Entrega 1
// de fichas, 15/10): el formulario se movió, las reglas no cambian.
const ASSET = {
  id: 'a1', license_plate: 'BBPV80', asset_type: 'TRACTOCAMION', manufacture_year: 2019, operational_status: 'ACTIVE',
  webcarga_operation_type_id: null, webcarga_operation_type_label: null,
} as unknown as Asset
const DRIVERS = [
  { id: 'd1', full_name: 'Vidal Soto, Pedro', operational_status: 'ACTIVE' },
  { id: 'd2', full_name: 'Rojas Pérez, Andrés', operational_status: 'INACTIVE' },
]

function montar(asset: Asset = ASSET, onSave = vi.fn().mockResolvedValue(undefined)) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AssetEditForm asset={asset} carrierId="c1" drivers={DRIVERS} onSave={onSave} onClose={vi.fn()} />
    </QueryClientProvider>,
  )
  return onSave
}

beforeEach(() => {
  vi.mocked(assetsApi.getDriverAssignment).mockReset().mockResolvedValue(null)
  vi.mocked(assetsApi.assignDriver).mockReset().mockResolvedValue({} as never)
  vi.mocked(taxonomiesApi.list).mockReset().mockResolvedValue([{ id: 'op1', label: 'Tractoreo', code: 'TRACTOREO' }] as never)
})

describe('AssetEditForm', () => {
  it('guarda tipo, año y tipo de operación', async () => {
    const onSave = montar()
    await screen.findByRole('option', { name: 'Tractoreo' })
    fireEvent.change(screen.getByLabelText('Tipo de equipo'), { target: { value: 'RAMPLA' } })
    fireEvent.change(screen.getByLabelText('Año del vehículo'), { target: { value: '2021' } })
    fireEvent.change(screen.getByLabelText('Tipo de operación'), { target: { value: 'op1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ asset_type: 'RAMPLA', manufacture_year: 2021, webcarga_operation_type_id: 'op1' }))
  })

  it('sin tipo de operación avisa la consecuencia sobre el cierre, no solo que falta', async () => {
    montar()
    expect(await screen.findByText(/bloquea el cierre del día/)).toBeInTheDocument()
  })

  it('"Sin clasificar" sobre un equipo que tenía tipo lo quita (null); vacío sobre vacío no viaja', async () => {
    const onSave = montar({ ...ASSET, webcarga_operation_type_id: 'op1', webcarga_operation_type_label: 'Tractoreo' } as unknown as Asset)
    await screen.findByRole('option', { name: 'Tractoreo' })
    fireEvent.change(screen.getByLabelText('Tipo de operación'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ webcarga_operation_type_id: null })))
  })

  it('el conductor habitual ofrece solo conductores activos y asigna con la API', async () => {
    montar()
    const select = await screen.findByLabelText('Asignar conductor habitual')
    expect(screen.queryByRole('option', { name: 'Rojas Pérez, Andrés' })).not.toBeInTheDocument()
    fireEvent.change(select, { target: { value: 'd1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Asignar' }))
    await waitFor(() => expect(assetsApi.assignDriver).toHaveBeenCalledWith('a1', 'd1'))
  })

  it('si la API rechaza la asignación del conductor habitual, muestra su mensaje', async () => {
    vi.mocked(assetsApi.assignDriver).mockRejectedValue(new ApiError('Ese conductor está dado de baja.', 409, null))
    montar()
    fireEvent.change(await screen.findByLabelText('Asignar conductor habitual'), { target: { value: 'd1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Asignar' }))
    expect(await screen.findByText('Ese conductor está dado de baja.')).toBeInTheDocument()
  })
})
