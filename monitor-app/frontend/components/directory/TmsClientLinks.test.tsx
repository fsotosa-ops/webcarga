import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Vincular escribe en la correspondencia (commercial.edit): sin ese permiso la
// lista se ve sin selector.
const permisos = vi.hoisted(() => ({ editar: true }))
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: () => permisos.editar }))
vi.mock('@/lib/api/tmsClients', () => ({ tmsClientsApi: { list: vi.fn(), vincular: vi.fn() } }))
vi.mock('@/lib/api/locations', () => ({ shippersApi: { list: vi.fn() } }))

import { TmsClientLinks } from './TmsClientLinks'
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
const DIRECTORIO = [
  { id: 's1', name: 'Walmart', status: 'ACTIVE' }, { id: 's4', name: 'Colun', status: 'ACTIVE' },
  { id: 's5', name: 'Agrícola Vieja', status: 'INACTIVE' },
]

function renderLinks(props: Parameters<typeof TmsClientLinks>[0]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><TmsClientLinks {...props} /></QueryClientProvider>)
}

describe('TmsClientLinks', () => {
  beforeEach(() => {
    permisos.editar = true
    vi.mocked(tmsClientsApi.list).mockReset().mockImplementation(async (p) =>
      (p?.unlinked ? [SIN_VINCULAR] : p?.shipper_id ? [VINCULADO] : [SIN_VINCULAR, VINCULADO]) as never)
    vi.mocked(tmsClientsApi.vincular).mockReset().mockResolvedValue({ source_client_id: 'k9', shipper_id: 's4' } as never)
    vi.mocked(shippersApi.list).mockReset().mockResolvedValue(DIRECTORIO as never)
  })

  it('la vista sin vincular pide solo los que no tienen cliente y muestra TMS, nombre y viajes', async () => {
    renderLinks({ unlinked: true })
    const fila = (await screen.findByText('lider express')).closest('tr')!
    expect(tmsClientsApi.list).toHaveBeenCalledWith({ unlinked: true })
    expect(within(fila).getByText('wingsuite')).toBeInTheDocument()
    expect(within(fila).getByText('4')).toBeInTheDocument()
  })

  it('en la ficha pide solo los nombres de ese cliente', async () => {
    renderLinks({ shipperId: 's1' })
    expect(await screen.findByText('walmart')).toBeInTheDocument()
    expect(tmsClientsApi.list).toHaveBeenCalledWith({ shipper_id: 's1' })
    expect(screen.getByText('qanalytics · 3.029 viajes')).toBeInTheDocument()
  })

  it('vincular uno sin cliente escribe directo y avisa cuándo se aplica', async () => {
    renderLinks({ unlinked: true })
    fireEvent.change(await screen.findByRole('combobox', { name: 'Cliente del directorio para lider express' }),
      { target: { value: 's4' } })
    await waitFor(() => expect(tmsClientsApi.vincular).toHaveBeenCalledWith('k9', 's4'))
    expect(await screen.findByText('Se aplicará a sus viajes en la próxima actualización')).toBeInTheDocument()
  })

  it('cambiar uno ya vinculado pide confirmar, diciendo cuántos viajes mueve', async () => {
    renderLinks({ shipperId: 's1' })
    const selector = await screen.findByRole('combobox', { name: 'Cliente del directorio para walmart' })
    expect(selector).toHaveValue('s1')
    fireEvent.change(selector, { target: { value: 's4' } })
    expect(tmsClientsApi.vincular).not.toHaveBeenCalled()
    expect(screen.getByText('¿Pasar «walmart» y sus 3.029 viajes a Colun?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByText(/¿Pasar «walmart»/)).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Cliente del directorio para walmart' })).toHaveValue('s1')

    fireEvent.change(screen.getByRole('combobox', { name: 'Cliente del directorio para walmart' }), { target: { value: 's4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(tmsClientsApi.vincular).toHaveBeenCalledWith('k1', 's4'))
  })

  it('el selector no ofrece clientes inactivos', async () => {
    renderLinks({ shipperId: 's1' })
    const selector = await screen.findByRole('combobox', { name: 'Cliente del directorio para walmart' })
    expect(within(selector).getAllByRole('option').map(o => o.textContent)).toEqual(['Walmart', 'Colun'])
  })

  it('sin commercial.edit se ve todo, sin selectores', async () => {
    permisos.editar = false
    renderLinks({ unlinked: true })
    expect(await screen.findByText('lider express')).toBeInTheDocument()
    expect(screen.getByText('Sin vincular')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('un error de la API queda en la fila', async () => {
    vi.mocked(tmsClientsApi.vincular).mockRejectedValue(new Error('El cliente elegido no está en el directorio'))
    renderLinks({ unlinked: true })
    fireEvent.change(await screen.findByRole('combobox', { name: 'Cliente del directorio para lider express' }),
      { target: { value: 's4' } })
    const fila = screen.getByText('lider express').closest('tr')!
    expect(await within(fila).findByText('El cliente elegido no está en el directorio')).toBeInTheDocument()
  })

  it('vacío: sin pendientes lo dice; en la ficha dice dónde se vinculan', async () => {
    vi.mocked(tmsClientsApi.list).mockResolvedValue([] as never)
    const { unmount } = renderLinks({ unlinked: true })
    expect(await screen.findByText('Todos los nombres del TMS tienen cliente')).toBeInTheDocument()
    unmount()
    renderLinks({ shipperId: 's1' })
    expect(await screen.findByText('Ningún TMS nombra todavía a este cliente')).toBeInTheDocument()
  })

  it('si falla el directorio no deja selectores en blanco: dice el error', async () => {
    vi.mocked(shippersApi.list).mockRejectedValue(new Error('500'))
    renderLinks({ unlinked: true })
    expect(await screen.findByText('No se pudieron cargar los nombres del TMS')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('un vínculo a un cliente inactivo se muestra como tal, y se puede mover a uno activo', async () => {
    vi.mocked(tmsClientsApi.list).mockResolvedValue([{ ...VINCULADO, shipper_id: 's5', shipper_name: 'Agrícola Vieja' }] as never)
    renderLinks({ shipperId: 's5' })
    const selector = await screen.findByRole('combobox', { name: 'Cliente del directorio para walmart' })
    expect(selector).toHaveValue('s5')
    expect(within(selector).getByRole('option', { name: 'Agrícola Vieja (inactivo)' })).toBeDisabled()
    fireEvent.change(selector, { target: { value: 's1' } })
    expect(screen.getByText('¿Pasar «walmart» y sus 3.029 viajes a Walmart?')).toBeInTheDocument()
  })
})
