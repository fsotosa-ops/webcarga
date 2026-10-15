import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/lib/api/locations', () => ({ locationsApi: { list: vi.fn() } }))

import { locationsApi } from '@/lib/api/locations'
import { DriverEditForm } from './DriverEditForm'
import type { Driver } from '@/lib/types'

// Reglas que vivían en los tests del panel de conductor (retirado en la
// Entrega 1 de fichas, 15/10): el formulario se movió, las reglas no cambian.
const DRIVER = {
  id: 'd1', full_name: 'Vidal Soto, Pedro', tax_id: '12345678-5', operational_status: 'ACTIVE',
  home_location_id: null, home_location_name: null, home_location_shipper: null,
  suggested_home_location: { id: 'cd2', name: 'CD Lo Aguirre', viajes: 17, total: 18, pct: 0.94 },
} as unknown as Driver

function montar(driver: Driver = DRIVER, onSave = vi.fn().mockResolvedValue(undefined)) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DriverEditForm driver={driver} onSave={onSave} onClose={vi.fn()} />
    </QueryClientProvider>,
  )
  return onSave
}

beforeEach(() => {
  vi.mocked(locationsApi.list).mockReset().mockResolvedValue({
    data: [{ id: 'cd1', name: 'CD Quilicura' }, { id: 'cd2', name: 'CD Lo Aguirre' }],
  } as never)
})

describe('DriverEditForm', () => {
  it('el desplegable de origen sale del catálogo de CD, no de los viajes del conductor', async () => {
    montar()
    expect(await screen.findByRole('option', { name: 'CD Quilicura' })).toBeInTheDocument()
    expect(locationsApi.list).toHaveBeenCalledWith(expect.objectContaining({ origin: true, operational_status: 'ACTIVE' }))
  })

  it('propone el CD dominante sin escribirlo: hay que elegirlo y guardar', async () => {
    const onSave = montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Asignar CD Lo Aguirre' }))
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ full_name: 'Vidal Soto, Pedro', home_location_id: 'cd2' }))
  })

  it('quitar el origen viaja como "" (quítaselo), no se omite (no lo toques)', async () => {
    const onSave = montar({ ...DRIVER, home_location_id: 'cd1', suggested_home_location: null } as unknown as Driver)
    await screen.findByRole('option', { name: 'CD Quilicura' })
    fireEvent.change(screen.getByLabelText('Origen habitual'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ full_name: 'Vidal Soto, Pedro', home_location_id: '' }))
  })

  it('si el catálogo no carga, lo dice en vez de dibujar un desplegable vacío', async () => {
    vi.mocked(locationsApi.list).mockRejectedValue(new Error('caído'))
    montar()
    expect(await screen.findByText('No se pudieron cargar los orígenes.')).toBeInTheDocument()
  })
})
