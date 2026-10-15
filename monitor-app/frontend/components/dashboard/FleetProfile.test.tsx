import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

let search = ''
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(search) }))
const negados = vi.hoisted(() => ({ set: new Set<string>() }))
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: (p: string) => !negados.set.has(p) }))
vi.mock('@/lib/api/drivers', () => ({
  driversApi: {
    get: vi.fn(), assignments: vi.fn(), activity: vi.fn(), listComplianceRecords: vi.fn(), listContacts: vi.fn(),
    patch: vi.fn(), correctRut: vi.fn(),
  },
}))
vi.mock('@/lib/api/assets', () => ({
  assetsApi: {
    get: vi.fn(), assignments: vi.fn(), activity: vi.fn(), listComplianceRecords: vi.fn(), patch: vi.fn(),
    getDriverAssignment: vi.fn().mockResolvedValue(null), assignDriver: vi.fn(), unassignDriver: vi.fn(), correctPlate: vi.fn(),
  },
}))
vi.mock('@/lib/api/entitySummary', async (orig) => ({ ...(await orig<object>()), fetchEntitySummary: vi.fn() }))
vi.mock('@/lib/api/locations', () => ({ locationsApi: { list: vi.fn().mockResolvedValue({ data: [{ id: 'cd1', name: 'CD Quilicura' }] }) } }))
vi.mock('@/lib/api/carriers', () => ({ carriersApi: { listDrivers: vi.fn().mockResolvedValue([]), unassignDriver: vi.fn().mockResolvedValue({}), unassignAsset: vi.fn(), assignDriver: vi.fn(), assignAsset: vi.fn(), list: vi.fn().mockResolvedValue({ data: [] }) } }))
vi.mock('@/lib/api/compliance', () => ({ complianceApi: { listPending: vi.fn(), get: vi.fn() } }))
vi.mock('@/lib/api/config', () => ({ taxonomiesApi: { list: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/hooks/useAssetTypes', () => ({ useAssetTypes: () => ({ types: [{ code: 'TRACTOCAMION', label: 'Tracto' }], labelOf: () => 'Tracto' }) }))

import { driversApi } from '@/lib/api/drivers'
import { assetsApi } from '@/lib/api/assets'
import { fetchEntitySummary } from '@/lib/api/entitySummary'
import { complianceApi } from '@/lib/api/compliance'
import { complianceSummary } from '@/lib/states.fixtures'
import { FleetProfile } from './FleetProfile'
import { QuickViewContext } from './QuickViewProvider'

const DRIVER = {
  id: 'd1', full_name: 'Vidal Soto, Pedro', tax_id: '12345678-5', country_code: 'CL', operational_status: 'ACTIVE',
  is_manual_override: false, created_at: null, total_requirements: 0, last_document_update: null,
  home_location_id: null, home_location_name: null, home_location_shipper: null, suggested_home_location: null,
}
const RESUMEN_CONDUCTOR = {
  id: 'd1', operational_status: 'ACTIVE', full_name: 'Vidal Soto, Pedro', tax_id: '12345678-5',
  carrier: { id: 'c1', name: 'Transportes Andes', operational_status: 'ACTIVE' },
  home_location: null, usual_tractor: { id: 'a1', plate: 'BBPV80' }, phone: null,
  documents: { total: 3, up_to_date: 1, pending: 2 },
  compliance_summary: complianceSummary({ worst_state: 'OVERDUE', can_operate: false, blocking: { own: 2, fleet: null } }),
}
// Las filas de /pending de la persona: de ahí salen la razón y la sección Documentos.
const FILAS = [
  { id: 'r1', document_name: 'Licencia de conducir', certification_type: 'BASICA', document_state: 'OVERDUE', requirement_id: 'q1' },
  { id: 'r2', document_name: 'Hoja de vida', certification_type: 'BASICA', document_state: 'MISSING', requirement_id: 'q2' },
  { id: 'r3', document_name: 'Curso', certification_type: 'ADICIONAL', document_state: 'MISSING', requirement_id: 'q3' },
]
const ASSET = {
  id: 'a1', license_plate: 'BBPV80', asset_type: 'TRACTOCAMION', operational_status: 'ACTIVE', manufacture_year: 2019,
  is_manual_override: false, created_at: null, fleet_service_type_id: null, fleet_service_type_label: null,
  fleet_service_type_bg_color: null, fleet_service_type_text_color: null, webcarga_operation_type_id: null,
  webcarga_operation_type_label: null, webcarga_operation_type_code: null, total_requirements: 0, last_document_update: null,
}
const RESUMEN_EQUIPO = {
  id: 'a1', operational_status: 'ACTIVE', license_plate: 'BBPV80', asset_type: 'TRACTOCAMION', manufacture_year: 2019,
  operation_type: 'Tractoreo', carrier: { id: 'c1', name: 'Transportes Andes', operational_status: 'ACTIVE' },
  usual_driver: { id: 'd1', name: 'Vidal Soto, Pedro' }, documents: { total: 1, up_to_date: 1, pending: 0 },
  compliance_summary: complianceSummary(),
}

function renderProfile(kind: 'driver' | 'asset' = 'driver') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <QuickViewContext.Provider value={vi.fn()}>
        <FleetProfile kind={kind} id={kind === 'driver' ? 'd1' : 'a1'} />
      </QuickViewContext.Provider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  search = ''
  negados.set = new Set()
  vi.mocked(driversApi.patch).mockReset()
  vi.mocked(driversApi.get).mockResolvedValue(DRIVER as never)
  vi.mocked(driversApi.assignments).mockResolvedValue([
    { carrier_id: 'c1', carrier_name: 'Transportes Andes', carrier_status: 'ACTIVE', valid_from: '2026-09-20', valid_until: null, current: true },
    { carrier_id: 'c0', carrier_name: 'Riquelme Hnos.', carrier_status: 'ACTIVE', valid_from: null, valid_until: '2026-09-19', current: false },
  ])
  vi.mocked(driversApi.activity).mockResolvedValue({ trips_30d: 18, last_trip_date: '2026-10-13', last_trip_client: 'Walmart' })
  vi.mocked(complianceApi.listPending).mockReset().mockImplementation(async (params: { entityId?: string } = {}) =>
    ({ total: 3, rows: params.entityId === 'd1' ? FILAS : [] }) as never)
  vi.mocked(driversApi.listContacts).mockResolvedValue([])
  vi.mocked(fetchEntitySummary).mockImplementation(async (kind: string) => (kind === 'driver' ? RESUMEN_CONDUCTOR : RESUMEN_EQUIPO) as never)
  vi.mocked(assetsApi.get).mockResolvedValue(ASSET as never)
  vi.mocked(assetsApi.assignments).mockResolvedValue([])
  vi.mocked(assetsApi.activity).mockResolvedValue({ trips_30d: 0, last_trip_date: null, last_trip_client: null })
  vi.mocked(assetsApi.listComplianceRecords).mockResolvedValue([])
})

describe('FleetProfile (Entrega 1 de fichas)', () => {
  it('F1: el encabezado dice ciclo de vida, estado de sus documentos y la razón', async () => {
    renderProfile()
    expect(await screen.findByText('Licencia de conducir: vencido · Hoja de vida: falta')).toBeInTheDocument()
    // El encabezado (EncabezadoDePagina): Documentos también está a la vista desde el 15/10.
    const encabezado = within(screen.getByRole('heading', { level: 1 }).parentElement!.parentElement!)
    expect(encabezado.getByText('Activo')).toBeInTheDocument()
    expect(encabezado.getByText('Vencido')).toBeInTheDocument()
  })

  it('RF3: dado de baja, sin razón', async () => {
    vi.mocked(fetchEntitySummary).mockResolvedValue({ ...RESUMEN_CONDUCTOR, operational_status: 'INACTIVE' } as never)
    renderProfile()
    expect(await screen.findByText('Dado de baja')).toBeInTheDocument()
    expect(screen.queryByText(/Licencia de conducir: vencido/)).not.toBeInTheDocument()
  })

  it('F4: el Resumen no repite los pendientes: un solo bloque de Detalles, sin anillo ni tarjeta de documentos', async () => {
    renderProfile()
    await screen.findByRole('region', { name: 'Detalles' })
    expect(screen.queryByText(/documentos al día/)).not.toBeInTheDocument()
    expect(screen.queryByText(/pendientes/i)).not.toBeInTheDocument()
    expect(screen.getByText('desde 20/09 · antes Riquelme Hnos.')).toBeInTheDocument()
  })

  it('C11: la línea de actividad lleva al Monitor filtrado por su RUT', async () => {
    renderProfile()
    expect(await screen.findByRole('link', { name: /Ver en el Monitor/ }))
      .toHaveAttribute('href', '/dashboard/operations/monitor?tab=historial&q=12345678-5')
  })

  it('F9: el tracto habitual del conductor es un enlace a su ficha', async () => {
    renderProfile()
    expect(await screen.findByRole('link', { name: 'Ver equipo BBPV80' })).toHaveAttribute('href', '/dashboard/assets/a1')
  })

  it('F9: el conductor habitual del equipo es un enlace a su ficha', async () => {
    renderProfile('asset')
    expect(await screen.findByRole('link', { name: 'Ver conductor Vidal Soto, Pedro' })).toHaveAttribute('href', '/dashboard/drivers/d1')
  })

  // Forma a ancho real (15/10): sin pestañas. Documentos al centro y, al costado,
  // Detalles, Actividad y (el conductor) Contactos, todo a la vez.
  it('P1: sin pestañas: Documentos al centro y Detalles, Actividad y Contactos al costado', async () => {
    const { unmount } = renderProfile()
    const aside = await screen.findByRole('complementary')
    expect(screen.queryByRole('group', { name: /Secciones del/ })).not.toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Documentos' })).toBeInTheDocument()
    expect(within(aside).getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual(['Detalles', 'Actividad', 'Contactos'])
    unmount()
    renderProfile('asset')
    const asideEquipo = await screen.findByRole('complementary')
    expect(within(asideEquipo).getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual(['Detalles', 'Actividad'])
  })

  it('F7: sin directory.edit, identity ni fleet_status no hay menú "⋯"; con ellos, sus opciones', async () => {
    negados.set = new Set(['directory.edit', 'directory.identity', 'directory.fleet_status'])
    const { unmount } = renderProfile()
    await screen.findByRole('region', { name: 'Detalles' })
    expect(screen.queryByRole('button', { name: 'Más acciones' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    unmount()
    negados.set = new Set()
    renderProfile()
    fireEvent.click(await screen.findByRole('button', { name: 'Más acciones' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map(i => i.textContent)).toEqual(
      ['Transferir a otra empresa', 'Corregir RUT', 'Dar de baja', 'Quitar de la empresa'])
  })

  it('C5: sin empresa, la ficha existe y el menú ofrece asignarla', async () => {
    vi.mocked(fetchEntitySummary).mockResolvedValue({ ...RESUMEN_CONDUCTOR, carrier: null } as never)
    vi.mocked(driversApi.assignments).mockResolvedValue([])
    renderProfile()
    expect(await screen.findByText('Sin empresa')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Más acciones' }))
    expect(screen.getByRole('menuitem', { name: 'Asignar a una empresa' })).toBeInTheDocument()
  })

  it('F8: "Editar" vuelve a cargar el borrador cada vez que se abre', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <QuickViewContext.Provider value={vi.fn()}><FleetProfile kind="driver" id="d1" /></QuickViewContext.Provider>
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Algo escrito' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    vi.mocked(driversApi.get).mockResolvedValue({ ...DRIVER, full_name: 'Vidal Soto, Pedro Andrés' } as never)
    await client.invalidateQueries()
    expect(await screen.findByRole('heading', { name: 'Vidal Soto, Pedro Andrés' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    expect(screen.getByLabelText('Nombre')).toHaveValue('Vidal Soto, Pedro Andrés')
  })

  it('RF5: si la API rechaza al guardar, el formulario sigue abierto con lo escrito y el mensaje', async () => {
    vi.mocked(driversApi.patch).mockRejectedValue(new Error('El nombre no puede quedar vacío.'))
    renderProfile()
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Otro nombre' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('El nombre no puede quedar vacío.')).toBeInTheDocument()
    expect(screen.getByLabelText('Nombre')).toHaveValue('Otro nombre')
  })

  // Los flujos destructivos que probaban los paneles retirados, ahora desde el ⋯.
  it('"Dar de baja" pide confirmación y deja al conductor INACTIVE', async () => {
    vi.mocked(driversApi.patch).mockResolvedValue(DRIVER as never)
    renderProfile()
    fireEvent.click(await screen.findByRole('button', { name: 'Más acciones' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Dar de baja' }))
    expect(driversApi.patch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar baja' }))
    await waitFor(() => expect(driversApi.patch).toHaveBeenCalledWith('d1', { operational_status: 'INACTIVE' }))
  })

  it('"Quitar de la empresa" pide confirmación antes de quitar', async () => {
    const { carriersApi } = await import('@/lib/api/carriers')
    renderProfile()
    fireEvent.click(await screen.findByRole('button', { name: 'Más acciones' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Quitar de la empresa' }))
    expect(carriersApi.unassignDriver).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Quitar del roster' }))
    await waitFor(() => expect(carriersApi.unassignDriver).toHaveBeenCalledWith('c1', 'd1'))
  })

  it('si Reactivar falla, la ficha lo dice', async () => {
    vi.mocked(fetchEntitySummary).mockResolvedValue({ ...RESUMEN_CONDUCTOR, operational_status: 'INACTIVE' } as never)
    vi.mocked(driversApi.get).mockResolvedValue({ ...DRIVER, operational_status: 'INACTIVE' } as never)
    vi.mocked(driversApi.patch).mockRejectedValue(new Error('La empresa está dada de baja.'))
    renderProfile()
    fireEvent.click(await screen.findByRole('button', { name: 'Más acciones' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reactivar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('La empresa está dada de baja.')
  })
})

