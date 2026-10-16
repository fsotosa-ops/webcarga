import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { complianceSummary } from '@/lib/states.fixtures'

vi.mock('next/navigation', () => ({ useRouter: vi.fn(), useSearchParams: vi.fn(), usePathname: () => '/dashboard/clients/s1' }))
const permisos = vi.hoisted(() => ({ editar: true }))
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: () => permisos.editar }))
vi.mock('@/lib/api/locations', () => ({
  shippersApi: { get: vi.fn(), patch: vi.fn(), list: vi.fn() },
  locationsApi: { list: vi.fn(), patch: vi.fn(), createRate: vi.fn() },
}))
vi.mock('@/lib/api/carriers', () => ({ carriersApi: { list: vi.fn() } }))
vi.mock('@/lib/api/tmsClients', () => ({ tmsClientsApi: { list: vi.fn(), vincular: vi.fn() } }))
vi.mock('@/hooks/useTripsMeta', () => ({ useTripsMeta: () => ({ data: { operation_types: [{ id: 'RM', label: 'RM' }] } }) }))

import { ClientProfile } from './ClientProfile'
import { ApiError } from '@/lib/api/client'
import { locationsApi, shippersApi } from '@/lib/api/locations'
import { carriersApi } from '@/lib/api/carriers'
import { tmsClientsApi } from '@/lib/api/tmsClients'

const COLUN = { id: 's1', name: 'Colun', status: 'ACTIVE', tms_names: 1, locations: 1, origins: 1, carriers: 1, trips_30d: 1830 }
const LUGAR = {
  id: 'l1', entity_type: 'SHIPPER', entity_id: 's1', site_number: null, name: 'CD La Unión', country_code: 'CL',
  format: null, address: null, region_name: null, region_number: null, opens_at: null, closes_at: null,
  operation_type: 'RM', operational_status: 'ACTIVE', is_manual_override: true, is_origin: true,
  created_at: null, updated_at: null, current_rate: null, current_rate_valid_from: null, current_rate_valid_to: null,
}
const ANDES = { id: 'c1', tax_id: '76555555-8', country_code: 'CL', business_name: 'Transportes Andes',
  operational_status: 'ACTIVE', total_requirements: 3, last_document_update: null, compliance_summary: complianceSummary() }
const NOMBRE_TMS = { source_client_id: 'k1', source_system: 'qanalytics', source_client: 'colun', trips: 1830, shipper_id: 's1', shipper_name: 'Colun' }

const replace = vi.fn()
function renderProfile(query = '') {
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams(query) as never)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><ClientProfile id="s1" /></QueryClientProvider>)
}

beforeEach(() => {
  permisos.editar = true
  replace.mockReset()
  vi.mocked(useRouter).mockReturnValue({ push: vi.fn(), replace } as never)
  vi.mocked(shippersApi.get).mockReset().mockResolvedValue(COLUN as never)
  vi.mocked(shippersApi.patch).mockReset().mockResolvedValue({ ...COLUN, name: 'Colun Ltda' } as never)
  vi.mocked(shippersApi.list).mockReset().mockResolvedValue([COLUN] as never)
  vi.mocked(locationsApi.list).mockReset().mockResolvedValue({ data: [LUGAR], count: 1, page: 1, limit: 50 } as never)
  vi.mocked(carriersApi.list).mockReset().mockResolvedValue({ data: [ANDES], count: 1, page: 1, limit: 100, facets: { total: 1, enabled: 1, not_enabled: 0 } } as never)
  vi.mocked(tmsClientsApi.list).mockReset().mockResolvedValue([NOMBRE_TMS] as never)
})

describe('ClientProfile', () => {
  it('encabezado con el estado y el Monitor filtrado por este cliente', async () => {
    renderProfile()
    expect(await screen.findByRole('heading', { name: 'Colun' })).toBeInTheDocument()
    expect(screen.getAllByText('Activo').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /Ver en el Monitor/ }))
      .toHaveAttribute('href', '/dashboard/operations/monitor?tab=historial&client=s1')
  })

  it('Lugares es la tabla del Tarifario con los lugares de este cliente, con Origen', async () => {
    renderProfile()
    expect(await screen.findByDisplayValue('CD La Unión')).toBeInTheDocument()
    expect(locationsApi.list).toHaveBeenCalledWith(expect.objectContaining({ entity_type: 'SHIPPER', entity_id: 's1' }))
    expect(screen.getByRole('checkbox', { name: 'Origen: CD La Unión' })).toBeChecked()
  })

  it('Empresas es la tabla del Directorio con las empresas de este cliente', async () => {
    renderProfile('tab=empresas')
    expect(await screen.findByRole('link', { name: 'Transportes Andes' })).toBeInTheDocument()
    expect(carriersApi.list).toHaveBeenCalledWith(expect.objectContaining({ shipper_id: 's1' }))
  })

  it('cambiar de pestaña queda en la dirección', async () => {
    renderProfile()
    fireEvent.click(await screen.findByRole('button', { name: /Empresas/ }))
    expect(replace).toHaveBeenCalledWith('/dashboard/clients/s1?tab=empresas', { scroll: false })
  })

  it('al costado, los detalles y cómo lo llaman los TMS', async () => {
    renderProfile()
    const tms = await screen.findByRole('region', { name: 'Cómo lo llaman los TMS' })
    expect(await within(tms).findByText('colun')).toBeInTheDocument()
    expect(tmsClientsApi.list).toHaveBeenCalledWith({ shipper_id: 's1' })
    const detalles = screen.getByRole('region', { name: 'Detalles' })
    expect(within(detalles).getByText('1.830')).toBeInTheDocument()
  })

  it('cambiar el nombre: un repetido se muestra en el panel sin perder lo escrito', async () => {
    vi.mocked(shippersApi.patch).mockRejectedValueOnce(new Error("Ya existe un cliente llamado 'walmart' (sin importar mayúsculas)"))
    renderProfile()
    fireEvent.click(await screen.findByRole('button', { name: 'Más acciones' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cambiar nombre' }))
    fireEvent.change(screen.getByLabelText('Nombre del cliente'), { target: { value: 'walmart' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nombre' }))
    expect(await screen.findByText(/Ya existe un cliente llamado 'walmart'/)).toBeInTheDocument()
    expect(screen.getByLabelText('Nombre del cliente')).toHaveValue('walmart')
    fireEvent.change(screen.getByLabelText('Nombre del cliente'), { target: { value: 'Colun Ltda' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nombre' }))
    await waitFor(() => expect(shippersApi.patch).toHaveBeenLastCalledWith('s1', { name: 'Colun Ltda' }))
  })

  it('desactivar se confirma diciendo qué pasa y qué no', async () => {
    renderProfile()
    fireEvent.click(await screen.findByRole('button', { name: 'Más acciones' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Desactivar cliente' }))
    expect(screen.getByText(/No se borran sus lugares, sus empresas ni sus viajes/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar' }))
    await waitFor(() => expect(shippersApi.patch).toHaveBeenCalledWith('s1', { status: 'INACTIVE' }))
  })

  it('un cliente inactivo se reactiva', async () => {
    vi.mocked(shippersApi.get).mockResolvedValue({ ...COLUN, status: 'INACTIVE' } as never)
    renderProfile()
    fireEvent.click(await screen.findByRole('button', { name: 'Más acciones' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reactivar cliente' }))
    await waitFor(() => expect(shippersApi.patch).toHaveBeenCalledWith('s1', { status: 'ACTIVE' }))
  })

  it('sin commercial.edit se ve todo y no hay un solo control', async () => {
    permisos.editar = false
    renderProfile()
    expect(await screen.findByText('CD La Unión')).toBeInTheDocument()
    await screen.findByText('colun')
    expect(screen.queryByRole('button', { name: 'Más acciones' })).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    // Buscar es leer: el único campo de texto es el buscador de lugares.
    expect(screen.getAllByRole('textbox').map(t => t.getAttribute('aria-label'))).toEqual(['Buscar local'])
  })

  it('sin lugares ni empresas cada pestaña dice qué hacer', async () => {
    vi.mocked(locationsApi.list).mockResolvedValue({ data: [], count: 0, page: 1, limit: 50 } as never)
    vi.mocked(carriersApi.list).mockResolvedValue({ data: [], count: 0, page: 1, limit: 100, facets: { total: 0, enabled: 0, not_enabled: 0 } } as never)
    const { unmount } = renderProfile()
    expect(await screen.findByText('Este cliente todavía no tiene lugares')).toBeInTheDocument()
    unmount()
    renderProfile('tab=empresas')
    expect(await screen.findByText('Ninguna empresa atiende todavía a este cliente')).toBeInTheDocument()
  })

  it('un cliente que no existe lo dice y ofrece volver', async () => {
    vi.mocked(shippersApi.get).mockRejectedValue(new ApiError('Cliente no encontrado', 404, null))
    renderProfile()
    expect(await screen.findByText('Este cliente no existe')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Volver a Clientes' })).toHaveAttribute('href', '/dashboard/clients')
  })
})
