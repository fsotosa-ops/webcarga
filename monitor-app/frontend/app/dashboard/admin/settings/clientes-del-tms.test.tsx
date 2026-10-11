import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

// Vincular escribe en la correspondencia (commercial.edit, como el directorio de
// clientes): sin ese permiso la lista se ve sin selector.
const permisos = vi.hoisted(() => ({ dados: null as Set<string> | null }))
vi.mock('@/lib/authz/PermisosProvider', () => ({
  usePermiso: (p: string) => permisos.dados === null || permisos.dados.has(p),
}))
vi.mock('@/lib/api/tmsClients', () => ({
  tmsClientsApi: { list: vi.fn(), vincular: vi.fn() },
}))
vi.mock('@/lib/api/locations', () => ({
  shippersApi: { list: vi.fn() },
}))

import { ClientesDelTmsTab } from './clientes-del-tms'
import { tmsClientsApi } from '@/lib/api/tmsClients'
import { shippersApi } from '@/lib/api/locations'

const VINCULADO = {
  source_client_id: 'k1', source_system: 'qanalytics', source_client: 'walmart', trips: 3029,
  shipper_id: 's1', shipper_name: 'Walmart',
}
const SIN_VINCULAR = {
  source_client_id: 'k9', source_system: 'wingsuite', source_client: 'lider express', trips: 4,
  shipper_id: null, shipper_name: null,
}
const DIRECTORIO = [{ id: 's1', name: 'Walmart' }, { id: 's4', name: 'Colun' }]

describe('ClientesDelTmsTab', () => {
  beforeEach(() => {
    permisos.dados = null
    vi.mocked(tmsClientsApi.list).mockReset().mockResolvedValue([SIN_VINCULAR, VINCULADO] as never)
    vi.mocked(tmsClientsApi.vincular).mockReset().mockResolvedValue({ source_client_id: 'k9', shipper_id: 's4' } as never)
    vi.mocked(shippersApi.list).mockResolvedValue(DIRECTORIO as never)
  })

  it('avisa cuántos están sin vincular y por qué importa', async () => {
    render(<ClientesDelTmsTab />)
    expect(await screen.findByText('1 cliente del TMS sin vincular: sus viajes no aparecen en los filtros por cliente'))
      .toBeInTheDocument()
  })

  it('muestra TMS, cliente en el TMS, viajes y cliente del directorio', async () => {
    render(<ClientesDelTmsTab />)
    const fila = (await screen.findByText('walmart')).closest('tr')!
    expect(within(fila).getByText('qanalytics')).toBeInTheDocument()
    expect(within(fila).getByText('3.029')).toBeInTheDocument()
    expect(within(fila).getByRole('combobox', { name: 'Cliente del directorio para walmart' })).toHaveValue('s1')
  })

  it('vincular llama a la API y avisa cuándo se aplica', async () => {
    render(<ClientesDelTmsTab />)
    fireEvent.change(await screen.findByRole('combobox', { name: 'Cliente del directorio para lider express' }),
      { target: { value: 's4' } })
    await waitFor(() => expect(tmsClientsApi.vincular).toHaveBeenCalledWith('k9', 's4'))
    expect(await screen.findByText('Se aplicará a sus viajes en la próxima actualización')).toBeInTheDocument()
  })

  it('sin commercial.edit se ve el cliente vinculado, sin selector', async () => {
    permisos.dados = new Set(['operations.configure'])
    render(<ClientesDelTmsTab />)
    const fila = (await screen.findByText('walmart')).closest('tr')!
    expect(within(fila).getByText('Walmart')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('sin pendientes no hay aviso', async () => {
    vi.mocked(tmsClientsApi.list).mockResolvedValue([VINCULADO] as never)
    render(<ClientesDelTmsTab />)
    await screen.findByText('walmart')
    expect(screen.queryByText(/sin vincular:/)).toBeNull()
  })

  it('sin ningún cliente del TMS lo dice', async () => {
    vi.mocked(tmsClientsApi.list).mockResolvedValue([] as never)
    render(<ClientesDelTmsTab />)
    expect(await screen.findByText('Todavía no llegan viajes de ningún TMS')).toBeInTheDocument()
  })

  it('si falla la carga ofrece reintentar', async () => {
    vi.mocked(tmsClientsApi.list).mockRejectedValue(new Error('500'))
    render(<ClientesDelTmsTab />)
    expect(await screen.findByRole('button', { name: /Reintentar/ })).toBeInTheDocument()
  })
})
