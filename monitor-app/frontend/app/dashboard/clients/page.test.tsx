import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'

vi.mock('next/navigation', () => ({ useRouter: vi.fn(), useSearchParams: vi.fn(), usePathname: () => '/dashboard/clients' }))
const permisos = vi.hoisted(() => ({ editar: true }))
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: () => permisos.editar }))
vi.mock('@/lib/api/locations', () => ({ shippersApi: { list: vi.fn(), create: vi.fn() } }))
vi.mock('@/lib/api/tmsClients', () => ({ tmsClientsApi: { list: vi.fn(), vincular: vi.fn() } }))

import ClientsPage from './page'
import { shippersApi } from '@/lib/api/locations'
import { tmsClientsApi } from '@/lib/api/tmsClients'

const COLUN = { id: 's1', name: 'Colun', status: 'ACTIVE', tms_names: 2, locations: 12, origins: 3, carriers: 4, trips_30d: 1830 }
const IANSA = { id: 's2', name: 'Iansa', status: 'ACTIVE', tms_names: 1, locations: 0, origins: 0, carriers: 0, trips_30d: 0 }
const VIEJA = { id: 's3', name: 'Agrícola Vieja', status: 'INACTIVE', tms_names: 0, locations: 1, origins: 0, carriers: 0, trips_30d: 0 }
const SIN_VINCULAR = { source_client_id: 'k9', source_system: 'wingsuite', source_client: 'lider express', trips: 4, shipper_id: null, shipper_name: null }

const push = vi.fn()
const replace = vi.fn()
function renderPage(query = '') {
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams(query) as never)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><ClientsPage /></QueryClientProvider>)
}

beforeEach(() => {
  permisos.editar = true
  push.mockReset(); replace.mockReset()
  vi.mocked(useRouter).mockReturnValue({ push, replace } as never)
  vi.mocked(shippersApi.list).mockReset().mockResolvedValue([COLUN, IANSA, VIEJA] as never)
  vi.mocked(shippersApi.create).mockReset()
  vi.mocked(tmsClientsApi.list).mockReset().mockResolvedValue([SIN_VINCULAR] as never)
})

describe('Directorio › Clientes', () => {
  it('lista los activos con nombres del TMS, lugares y orígenes, empresas y viajes de 30 días', async () => {
    renderPage()
    const tabla = await screen.findByRole('table')
    expect(within(tabla).getAllByRole('columnheader').map(h => h.textContent))
      .toEqual(['Cliente', 'Nombres del TMS', 'Lugares', 'Empresas', 'Viajes (30 días)', 'Estado'])
    const fila = within(tabla).getByRole('link', { name: 'Colun' }).closest('tr')!
    for (const t of ['2', '12 · 3 orígenes', '4', '1.830', 'Activo']) expect(within(fila).getByText(t)).toBeInTheDocument()
    expect(within(tabla).queryByText('Agrícola Vieja')).toBeNull()
  })

  it('la fila abre la ficha del cliente con la lista para volver', async () => {
    renderPage('q=col')
    const enlace = await screen.findByRole('link', { name: 'Colun' })
    expect(enlace.getAttribute('href')).toBe('/dashboard/clients/s1?next=%2Fdashboard%2Fclients%3Fq%3Dcol')
  })

  it('los filtros dicen cuántos hay; sin cifra mientras la cuenta no llega', async () => {
    vi.mocked(tmsClientsApi.list).mockReturnValue(new Promise(() => {}))
    renderPage()
    const filtros = await screen.findByRole('group', { name: 'Clientes' })
    await waitFor(() => expect(within(filtros).getByRole('button', { name: /Activos/ })).toHaveTextContent('Activos2'))
    expect(within(filtros).getByRole('button', { name: /Inactivos/ })).toHaveTextContent('Inactivos1')
    expect(within(filtros).getByRole('button', { name: /sin vincular/ })).toHaveTextContent(/sin vincular$/)
  })

  it('Inactivos muestra solo los inactivos y queda en la dirección', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Inactivos/ }))
    expect(replace).toHaveBeenCalledWith('/dashboard/clients?vista=inactivos', { scroll: false })
  })

  it('la vista sin vincular dibuja los nombres del TMS sin cliente', async () => {
    renderPage('vista=sin-vincular')
    expect(await screen.findByText('lider express')).toBeInTheDocument()
    expect(tmsClientsApi.list).toHaveBeenCalledWith({ unlinked: true })
    expect(screen.getByRole('button', { name: /sin vincular/ })).toHaveTextContent('Nombres del TMS sin vincular1')
  })

  it('Nuevo cliente solo con commercial.edit; al crearlo abre su ficha', async () => {
    vi.mocked(shippersApi.create).mockResolvedValue({ id: 's9', name: 'Soprole', status: 'ACTIVE' } as never)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Nuevo cliente/ }))
    fireEvent.change(screen.getByLabelText('Nombre del cliente'), { target: { value: 'Soprole' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))
    await waitFor(() => expect(shippersApi.create).toHaveBeenCalledWith({ name: 'Soprole' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard/clients/s9'))
  })

  it('un nombre repetido se muestra en el panel sin perder lo escrito', async () => {
    vi.mocked(shippersApi.create).mockRejectedValue(new Error("Ya existe un cliente llamado 'colun' (sin importar mayúsculas)"))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Nuevo cliente/ }))
    fireEvent.change(screen.getByLabelText('Nombre del cliente'), { target: { value: 'colun' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear cliente' }))
    expect(await screen.findByText(/Ya existe un cliente llamado 'colun'/)).toBeInTheDocument()
    expect(screen.getByLabelText('Nombre del cliente')).toHaveValue('colun')
  })

  it('sin commercial.edit no ofrece crear', async () => {
    permisos.editar = false
    renderPage()
    await screen.findByRole('table')
    expect(screen.queryByRole('button', { name: /Nuevo cliente/ })).toBeNull()
  })

  it('cargando, vacío y error', async () => {
    vi.mocked(shippersApi.list).mockReturnValue(new Promise(() => {}))
    const { unmount } = renderPage()
    expect(screen.queryByRole('table')).toBeNull()
    unmount()
    vi.mocked(shippersApi.list).mockResolvedValue([] as never)
    const r2 = renderPage()
    expect(await screen.findByText('Todavía no hay clientes')).toBeInTheDocument()
    r2.unmount()
    vi.mocked(shippersApi.list).mockRejectedValue(new Error('500'))
    renderPage()
    expect(await screen.findByText('No se pudieron cargar los clientes')).toBeInTheDocument()
  })

  it('en el teléfono cada cliente es una tarjeta que abre su ficha', async () => {
    renderPage()
    const tarjetas = await screen.findByRole('list', { name: 'Clientes' })
    const colun = within(tarjetas).getByRole('link', { name: /Colun/ })
    expect(colun).toHaveAttribute('href', '/dashboard/clients/s1?next=%2Fdashboard%2Fclients')
    expect(within(colun).getByText('12 lugares · 3 orígenes · 4 empresas · 1.830 viajes (30 días)')).toBeInTheDocument()
  })
})
