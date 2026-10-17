import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import EmpresaDetailPage from './page'
import { carriersApi } from '@/lib/api/carriers'
import { driversApi } from '@/lib/api/drivers'
import { assetsApi } from '@/lib/api/assets'
import { contactsApi } from '@/lib/api/contacts'
import { createClient } from '@/lib/supabase/client'
import type { Carrier, CarrierDriverRosterItem, CarrierAssetRosterItem } from '@/lib/types'
import { complianceSummary, recordStateFields } from '@/lib/states.fixtures'

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <EmpresaDetailPage />
    </QueryClientProvider>,
  )
}

/** Clickea el botón de la tab bar (no el stat-card de Resumen que también
 *  matchea el mismo nombre accesible) — la tab bar siempre renderiza primero. */
/** Lo destructivo y el estado de la empresa viven en el ⋯ (Entrega 1 de fichas). */
async function elegirDelMenu(name: string) {
  fireEvent.click(await screen.findByRole('button', { name: 'Más acciones' }))
  fireEvent.click(screen.getByRole('menuitem', { name }))
}
async function clickTab(name: RegExp) {
  const matches = await screen.findAllByRole('button', { name })
  fireEvent.click(matches[0])
}

vi.mock('next/navigation', () => ({ useParams: vi.fn(), useRouter: vi.fn(), useSearchParams: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/api/insurance', async orig => ({ ...(await orig<object>()), insuranceApi: {
  carrier: vi.fn().mockResolvedValue({ summary: null, policies: [] }),
} }))
// Por defecto lo tiene todo; cada test niega lo que necesita.
const permisos = vi.hoisted(() => ({ darDeBaja: true, negados: new Set<string>() }))
vi.mock('@/lib/authz/PermisosProvider', () => ({
  usePermiso: (p: string) => (p === 'directory.delete' ? permisos.darDeBaja : !permisos.negados.has(p)),
}))
vi.mock('@/lib/api/carriers', () => ({
  carriersApi: {
    get: vi.fn(), patch: vi.fn(), delete: vi.fn(),
    listDrivers: vi.fn(), assignDriver: vi.fn(), unassignDriver: vi.fn(),
    listAssets: vi.fn(), assignAsset: vi.fn(), unassignAsset: vi.fn(),
    createContact: vi.fn(),
    createPolicy: vi.fn(),
    listShippers: vi.fn(), exportDocuments: vi.fn(),
    list: vi.fn().mockResolvedValue({ data: [{ id: 'c2', business_name: 'Otra Empresa', tax_id: '2-2' }] }),
  },
}))
vi.mock('@/lib/api/drivers', () => ({
  driversApi: {
    get: vi.fn(), create: vi.fn(), patch: vi.fn(), listComplianceRecords: vi.fn(),
    listContacts: vi.fn(), createContact: vi.fn(),
    assignments: vi.fn().mockResolvedValue([]), activity: vi.fn().mockResolvedValue({ trips_30d: 0, last_trip_date: null, last_trip_client: null }),
  },
}))
// El modal de un conductor o equipo es su ficha propia (Entrega 1 de fichas): lee su resumen y sus documentos.
vi.mock('@/lib/api/entitySummary', async (orig) => ({ ...(await orig<object>()), fetchEntitySummary: vi.fn().mockResolvedValue({
  id: 'd1', operational_status: 'ACTIVE', full_name: 'Juan Pérez', tax_id: '22222222-2',
  carrier: { id: 't1', name: 'Transportes Test', operational_status: 'ACTIVE' }, home_location: null, usual_tractor: null, phone: null,
  documents: { total: 0, up_to_date: 0, pending: 0 },
  compliance_summary: { worst_state: 'UP_TO_DATE', own: { overdue: 0, expiring: 0, missing: 0 }, fleet: null, can_operate: true, blocking: { own: 0, fleet: null } },
}) }))
vi.mock('@/lib/api/assets', () => ({
  assetsApi: {
    get: vi.fn(), create: vi.fn(), patch: vi.fn(), listComplianceRecords: vi.fn(),
    types: vi.fn().mockResolvedValue([
      { code: 'TRACTOCAMION', label: 'Tracto', is_power_unit: true },
      { code: 'RAMPLA', label: 'Rampla', is_power_unit: false },
    ]),
  },
}))
vi.mock('@/lib/api/contacts', () => ({
  contactsApi: { patch: vi.fn(), delete: vi.fn() },
}))

const CARRIER: Carrier = {
  id: 't1', tax_id: '11111111-1', country_code: 'CL', business_name: 'Transportes Test',
  operational_status: 'ACTIVE', legacy_admin_id: null, erp_id: null, is_manual_override: false,
  overridden_by: null, overridden_at: null, created_at: null, updated_at: null,
  management_types: null,
  compliance_summary: complianceSummary({ worst_state: 'MISSING', own: { overdue: 0, expiring: 0, missing: 1 }, fleet: { overdue: 2, expiring: 0, missing: 0 }, can_operate: false, blocking: { own: 1, fleet: 2 } }),
  contacts: [],
  compliance_records: [{
    id: 'cr1', requirement_id: 'req1', requirement_code: 'F30', name: 'F30 Multas',
    requirement_level: 'LEGAL_MANDATORY', requires_file: true, status: 'MISSING',
    expiration_date: null, file_url: null, metadata: {}, is_manual_override: false,
    is_expired: false, is_expiring_soon: false, ...recordStateFields('MISSING'), updated_at: null,
  }],
}

const DRIVERS: CarrierDriverRosterItem[] = [
  { id: 'd1', tax_id: '22222222-2', full_name: 'Juan Pérez', operational_status: 'ACTIVE', total_requirements: 5, last_document_update: null, compliance_summary: complianceSummary() },
  { id: 'd2', tax_id: '12345678-5', full_name: 'Ana Rojas', operational_status: 'ACTIVE', total_requirements: 5, last_document_update: null,
    compliance_summary: complianceSummary({ worst_state: 'OVERDUE', own: { overdue: 1, expiring: 0, missing: 0 }, can_operate: false }) },
]

const ASSETS: CarrierAssetRosterItem[] = [
  { id: 'v1', license_plate: 'ABCD12', asset_type: 'TRACTOCAMION', operational_status: 'ACTIVE', fleet_service_type_id: null, fleet_service_type_label: null,   webcarga_operation_type_id: null, webcarga_operation_type_label: null, webcarga_operation_type_code: null, total_requirements: 3, last_document_update: null, compliance_summary: complianceSummary() },
]

const pushMock = vi.fn()

beforeEach(() => {
  permisos.darDeBaja = true
  permisos.negados = new Set()
  vi.mocked(useParams).mockReturnValue({ id: 't1' })
  pushMock.mockReset()
  vi.mocked(useRouter).mockReturnValue({ push: pushMock } as unknown as ReturnType<typeof useRouter>)
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>)
  vi.mocked(createClient).mockReturnValue({
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { role: 'admin' } }),
        }),
      }),
    }),
  } as unknown as ReturnType<typeof createClient>)

  vi.mocked(carriersApi.get).mockReset().mockResolvedValue(CARRIER)
  vi.mocked(carriersApi.listDrivers).mockReset().mockResolvedValue(DRIVERS)
  vi.mocked(carriersApi.listAssets).mockReset().mockResolvedValue(ASSETS)
  vi.mocked(carriersApi.listShippers).mockReset().mockResolvedValue([])
  vi.mocked(driversApi.listComplianceRecords).mockReset().mockResolvedValue([])
  vi.mocked(driversApi.listContacts).mockReset().mockResolvedValue([])
  vi.mocked(assetsApi.listComplianceRecords).mockReset().mockResolvedValue([])
})

describe('EmpresaDetailPage', () => {
  it('la cabecera separa el ciclo de vida de la habilitación: dos chips', async () => {
    renderPage()
    expect(await screen.findByText('Activa')).toBeInTheDocument()
    expect(screen.getByText('No habilitada')).toHaveClass('text-status-incidente')
  })

  it('una empresa dada de baja no se ve en rojo: "No habilitada" en gris', async () => {
    vi.mocked(carriersApi.get).mockResolvedValue({ ...CARRIER, operational_status: 'LEGACY_INACTIVE' as Carrier['operational_status'] })
    renderPage()
    expect(await screen.findByText('Dada de baja')).toBeInTheDocument()
    expect(screen.getByText('No habilitada')).toHaveClass('text-informativo')
  })

  it('el encabezado dice lo que bloquea según la API, propio y de la flota activa', async () => {
    renderPage()
    expect(await screen.findByText('1 obligatorio de la empresa y 2 de su flota')).toBeInTheDocument()
  })


  it('sin directory.delete el ⋯ de una empresa ACTIVE no ofrece cambiar su estado', async () => {
    permisos.darDeBaja = false
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Más acciones' }))
    expect(screen.queryByRole('menuitem', { name: /^(Dar de baja|Reactivar|Activar)$/ })).not.toBeInTheDocument()
  })


  it('sin directory.delete pero con directory.edit, una empresa en ONBOARDING se activa desde el ⋯', async () => {
    permisos.darDeBaja = false
    vi.mocked(carriersApi.get).mockResolvedValue({ ...CARRIER, operational_status: 'ONBOARDING' })
    vi.mocked(carriersApi.patch).mockResolvedValue(CARRIER)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Más acciones' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Activar' }))
    await waitFor(() => expect(carriersApi.patch).toHaveBeenCalledWith('t1', { operational_status: 'ACTIVE' }))
  })


  it('una empresa en ONBOARDING sin directory.edit no se puede activar desde la ficha', async () => {
    permisos.negados = new Set(['directory.edit'])
    vi.mocked(carriersApi.get).mockResolvedValue({ ...CARRIER, operational_status: 'ONBOARDING' })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Más acciones' }))
    expect(screen.queryByRole('menuitem', { name: 'Activar' })).not.toBeInTheDocument()
  })




  it('dar de baja a un conductor avisa que el Cierre se actualizará', async () => {
    vi.mocked(driversApi.get).mockResolvedValue({
      id: 'd1', tax_id: '22222222-2', country_code: 'CL', full_name: 'Juan Pérez',
      operational_status: 'ACTIVE', is_manual_override: false, created_at: null,
      total_requirements: 5, last_document_update: null,
      home_location_id: null, home_location_name: null, home_location_shipper: null, suggested_home_location: null,
    })
    vi.mocked(driversApi.patch).mockResolvedValue({} as never)
    renderPage()
    await clickTab(/Conductores/)
    fireEvent.click(await screen.findByText('Juan Pérez'))
    // La empresa también tiene su "Dar de baja": se elige dentro de la ficha del conductor.
    const dialogo = await screen.findByRole('dialog')
    fireEvent.click(await within(dialogo).findByRole('button', { name: 'Más acciones' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Dar de baja' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar baja' }))
    expect(await screen.findByText(/El Cierre se actualizará en alrededor de un minuto\./)).toBeInTheDocument()
  })


  it('el Operador (sin directory.edit) da de baja a un conductor desde su ficha', async () => {
    permisos.darDeBaja = false
    permisos.negados = new Set(['directory.edit', 'policies.edit', 'policies.delete'])
    vi.mocked(driversApi.get).mockResolvedValue({
      id: 'd1', tax_id: '22222222-2', country_code: 'CL', full_name: 'Juan Pérez',
      operational_status: 'ACTIVE', is_manual_override: false, created_at: null,
      total_requirements: 5, last_document_update: null,
      home_location_id: null, home_location_name: null, home_location_shipper: null, suggested_home_location: null,
    })
    renderPage()
    await clickTab(/Conductores/)
    fireEvent.click(await screen.findByText('Juan Pérez'))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.click(await within(dialogo).findByRole('button', { name: 'Más acciones' }))
    expect(screen.getByRole('menuitem', { name: 'Dar de baja' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Quitar de la empresa/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Conductor' })).not.toBeInTheDocument()
  })


  it('"+ Póliza" se muestra con policies.edit, no con directory.edit', async () => {
    permisos.negados = new Set(['policies.edit'])
    renderPage()
    await clickTab(/Seguros/)
    expect(screen.queryByRole('button', { name: '+ Póliza' })).not.toBeInTheDocument()
  })

  it('llegando desde el Cierre ofrece volver a él; sin ?next= no muestra nada de más', async () => {
    const cierre = '/dashboard/operations/closures?date=2026-10-08&tab=trips'
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams(`next=${encodeURIComponent(cierre)}`) as unknown as ReturnType<typeof useSearchParams>)
    renderPage()
    expect(await screen.findByRole('link', { name: 'Volver al Cierre' })).toHaveAttribute('href', cierre)
  })

  it('sin ?next= no hay vínculo de vuelta', async () => {
    renderPage()
    await screen.findAllByRole('button', { name: /Documentos/ })
    expect(screen.queryByRole('link', { name: /^Volver/ })).toBeNull()
  })

  it('exports all carrier documents as a zip on click', async () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() })
    vi.mocked(carriersApi.exportDocuments).mockResolvedValue(new Blob(['zip-content']))
    renderPage()
    await clickTab(/Documentos/)

    fireEvent.click(await screen.findByRole('button', { name: /Exportar todo/ }))

    await waitFor(() => expect(carriersApi.exportDocuments).toHaveBeenCalledWith('t1'))
    expect(URL.createObjectURL).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('shows an error if exporting documents fails', async () => {
    vi.mocked(carriersApi.exportDocuments).mockRejectedValue(new Error('Esta empresa no tiene documentos cargados'))
    renderPage()
    await clickTab(/Documentos/)

    fireEvent.click(await screen.findByRole('button', { name: /Exportar todo/ }))

    expect(await screen.findByText('Esta empresa no tiene documentos cargados')).toBeInTheDocument()
  })

  it('shows the driver and equipment rosters in their own tabs', async () => {
    renderPage()
    await clickTab(/Conductores/)
    expect(await screen.findByText('Juan Pérez')).toBeInTheDocument()

    await clickTab(/Equipos/)
    expect(await screen.findByText('ABCD12')).toBeInTheDocument()
  })

  it('opens the driver detail panel when a roster card is clicked', async () => {
    vi.mocked(driversApi.get).mockResolvedValue({
      id: 'd1', tax_id: '22222222-2', country_code: 'CL', full_name: 'Juan Pérez',
      operational_status: 'ACTIVE', is_manual_override: false, created_at: null,
      total_requirements: 5, last_document_update: null,
  home_location_id: null, home_location_name: null,
  home_location_shipper: null, suggested_home_location: null,
    })
    renderPage()
    await clickTab(/Conductores/)
    fireEvent.click(await screen.findByText('Juan Pérez'))
    await waitFor(() => expect(driversApi.get).toHaveBeenCalledWith('d1'))
  })

  it('filters the driver roster by search', async () => {
    renderPage()
    await clickTab(/Conductores/)
    await screen.findByText('Juan Pérez')
    fireEvent.change(screen.getByPlaceholderText('Filtrar por nombre o RUT…'), { target: { value: 'nadie' } })
    await waitFor(() => expect(screen.queryByText('Juan Pérez')).not.toBeInTheDocument())
  })

  it('el roster filtra por el peor estado que manda la API', async () => {
    renderPage()
    await clickTab(/Conductores/)
    // El control segmentado del kit (15/10), en vez de las tarjetas de cifras.
    fireEvent.click(within(await screen.findByRole('group', { name: 'Estado de sus documentos' })).getByRole('button', { name: /^Vencido/ }))
    expect(screen.getByText('Ana Rojas')).toBeInTheDocument()
    expect(screen.queryByText('Juan Pérez')).not.toBeInTheDocument()
  })

  it('un RUT con puntos encuentra al conductor guardado sin puntos (D1 §7.2)', async () => {
    renderPage()
    await clickTab(/Conductores/)
    fireEvent.change(await screen.findByPlaceholderText(/Filtrar por nombre o RUT/), { target: { value: '12.345.678' } })
    expect(screen.getByText('Ana Rojas')).toBeInTheDocument()
    expect(screen.queryByText('Juan Pérez')).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText(/Filtrar por nombre o RUT/), { target: { value: '12.345.678-5' } })
    expect(screen.getByText('Ana Rojas')).toBeInTheDocument()
    expect(screen.queryByText('Juan Pérez')).not.toBeInTheDocument()
  })

  it('una patente con guion encuentra al equipo', async () => {
    renderPage()
    await clickTab(/Equipos/)
    fireEvent.change(await screen.findByPlaceholderText(/Filtrar por patente/), { target: { value: 'AB-CD' } })
    expect(screen.getByText('ABCD12')).toBeInTheDocument()
  })

  it('filters the equipment roster by asset type', async () => {
    renderPage()
    await clickTab(/Equipos/)
    await screen.findByText('ABCD12')
    fireEvent.click(screen.getByRole('button', { name: 'Rampla' }))
    await waitFor(() => expect(screen.queryByText('ABCD12')).not.toBeInTheDocument())
  })

  // La tabla del kit muestra a todos: con filas de 40 px, 12 conductores caben
  // sin el "Mostrar los N restantes" de la grilla de tarjetas (15/10).
  it('la tabla muestra a todos los conductores, sin "Mostrar los N restantes"', async () => {
    const manyDrivers: CarrierDriverRosterItem[] = Array.from({ length: 12 }, (_, i) => ({
      id: `d${i}`, tax_id: `${i}-1`, full_name: `Conductor ${i}`,
      operational_status: 'ACTIVE', total_requirements: 5, last_document_update: null,
      compliance_summary: complianceSummary(),
    }))
    vi.mocked(carriersApi.listDrivers).mockResolvedValue(manyDrivers)
    renderPage()
    await clickTab(/Conductores/)
    expect(await screen.findByText('Conductor 11')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mostrar los/ })).not.toBeInTheDocument()
  })

  it('does not poison the contact draft after Cancelar: reopening Editar shows the real current values', async () => {
    vi.mocked(carriersApi.get).mockResolvedValue({
      ...CARRIER,
      contacts: [{ id: 'ct1', contact_role: 'LEGAL_REP', first_name: 'Contacto', last_name: 'Original', job_title: null, phone: '111111111', email: 'orig@example.com', is_primary: true, is_active: true }],
    })
    renderPage()
    // Los contactos viven en el panel lateral (15/10), junto a Detalles.
    const contactos = await screen.findByRole('region', { name: 'Contactos' })
    await within(contactos).findByText('Contacto Original')

    fireEvent.click(within(contactos).getByText('Editar'))
    const phoneInput = screen.getByPlaceholderText('Teléfono')
    expect(phoneInput).toHaveValue('111111111')
    fireEvent.change(phoneInput, { target: { value: '' } })
    fireEvent.click(screen.getByText('Cancelar'))

    expect(screen.getByText('111111111')).toBeInTheDocument()

    fireEvent.click(within(contactos).getByText('Editar'))
    expect(screen.getByPlaceholderText('Teléfono')).toHaveValue('111111111')
    expect(screen.getByPlaceholderText('Nombre')).toHaveValue('Contacto Original')
    expect(screen.getByPlaceholderText('Email')).toHaveValue('orig@example.com')

    expect(contactsApi.patch).not.toHaveBeenCalled()
  })

  it('el ID de la administración anterior se ve al editar la empresa', async () => {
    vi.mocked(carriersApi.get).mockResolvedValue({ ...CARRIER, legacy_admin_id: '4567' })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    expect(screen.getByText('4567')).toBeInTheDocument()
  })


  it('does not show a legacy admin id row when absent', async () => {
    renderPage()
    await screen.findAllByText('Transportes Test')
    expect(screen.queryByText('ID legacy admin:')).not.toBeInTheDocument()
  })

  it('los clientes de la empresa están en Detalles', async () => {
    vi.mocked(carriersApi.listShippers).mockResolvedValue([
      { id: 's1', name: 'Walmart', status: 'ACTIVE', start_date: null, end_date: null },
      { id: 's2', name: 'Colun', status: 'ACTIVE', start_date: null, end_date: null },
    ])
    renderPage()
    expect(await screen.findByText('Walmart, Colun')).toBeInTheDocument()
  })


  it('sin clientes, Detalles lo dice', async () => {
    renderPage()
    expect(await screen.findByText('Sin clientes')).toBeInTheDocument()
  })



  // P2 (forma a ancho real, 15/10): abre en Documentos, con Detalles y Contactos
  // al costado. Resumen y Contactos dejan de ser pestañas.
  it('P2: abre en Documentos, con Detalles y Contactos al costado; pestañas Documentos · Conductores · Equipos · Seguros', async () => {
    renderPage()
    const aside = await screen.findByRole('complementary')
    expect(within(aside).getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual(['Detalles', 'Contactos'])
    const tabs = within(screen.getByRole('group', { name: 'Secciones de la empresa' })).getAllByRole('button')
    expect(tabs.map(t => t.textContent?.replace(/\d+$/, ''))).toEqual(['Documentos', 'Conductores', 'Equipos', 'Seguros'])
    expect(screen.getByRole('button', { name: /^Documentos/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('un enlace guardado con ?tab=resumen o ?tab=contactos abre Documentos', async () => {
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams('tab=contactos') as unknown as ReturnType<typeof useSearchParams>)
    renderPage()
    expect(await screen.findByRole('button', { name: /^Documentos/ })).toHaveAttribute('aria-pressed', 'true')
  })

  // R1: la flota de la empresa es la tabla del kit, como Directorio › Conductores.
  it('R1: Conductores es la tabla del kit, sin tarjetas de cifras', async () => {
    renderPage()
    await clickTab(/Conductores/)
    const encabezado = await screen.findByRole('columnheader', { name: 'Conductor' })
    expect(encabezado.className).not.toMatch(/uppercase/)
    expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Conductor', 'RUT', 'Estado', 'Documentos'])
    expect(screen.getByRole('group', { name: 'Estado de sus documentos' })).toBeInTheDocument()
    expect(screen.queryByText(/^Conductores \(/)).not.toBeInTheDocument()
  })

  // Ronda 43 (Hallazgo F): handoff desde el flujo guiado de "Sin identificar"
  // (TripSlideOver → landing de Empresas → acá) — llega con driver_name/
  // tractor_plate ya reportados por el TMS, sin tener que re-tipearlos.
  it('pre-fills and opens "+ Conductor" when arriving with a driver_name handoff', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams({ driver_name: 'NOMBRE SIN CRUCE' }) as unknown as ReturnType<typeof useSearchParams>,
    )
    renderPage()
    expect(await screen.findByDisplayValue('NOMBRE SIN CRUCE')).toBeInTheDocument()
  })

  it('pre-fills and opens "+ Equipo" when arriving with a tractor_plate handoff', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams({ tractor_plate: 'XYZW12' }) as unknown as ReturnType<typeof useSearchParams>,
    )
    renderPage()
    expect(await screen.findByDisplayValue('XYZW12')).toBeInTheDocument()
  })

  // Auditoría 2026-07-27: "revisar en Seguros/Empresas" en TripSlideOver
  // ahora deep-linkea acá con ?tab=... — antes eran textos estáticos.
  it('opens directly on the Seguros tab when arriving with ?tab=seguros', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams({ tab: 'seguros' }) as unknown as ReturnType<typeof useSearchParams>,
    )
    renderPage()
    expect(await screen.findByRole('button', { name: /^Seguros/ })).toHaveAttribute('aria-pressed', 'true')
  })

  // S1: sin el título en mayúsculas ("PÓLIZAS (0)"); el vacío es el `Estado` del kit.
  it('S1: Seguros sin pólizas lo dice con el estado vacío del kit, sin título en mayúsculas', async () => {
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams({ tab: 'seguros' }) as unknown as ReturnType<typeof useSearchParams>)
    renderPage()
    // También lo dice la fila Seguros de Detalles, en el panel lateral: se mira la sección.
    const seccion = (await screen.findByRole('complementary')).parentElement!.firstElementChild as HTMLElement
    expect(await within(seccion).findByText('Sin pólizas registradas')).toBeInTheDocument()
    expect(screen.queryByText(/Pólizas \(/)).not.toBeInTheDocument()
  })

  it('shows a pending-docs badge on the Documentos tab', async () => {
    renderPage()
    const tab = await screen.findByRole('button', { name: /Documentos/ })
    expect(tab).toHaveTextContent('1')
  })

  it('cambia de sección sin salir de la página, y Detalles sigue al costado', async () => {
    renderPage()
    await clickTab(/Conductores/)
    expect(await screen.findByRole('columnheader', { name: 'Conductor' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Detalles' })).toBeInTheDocument()
  })


  it('deletes the carrier and redirects to the list on confirm', async () => {
    vi.mocked(carriersApi.delete).mockResolvedValue({ ok: true })
    renderPage()

    await elegirDelMenu('Eliminar')
    expect(screen.getByText(/Eliminar: Transportes Test/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar eliminación' }))

    await waitFor(() => expect(carriersApi.delete).toHaveBeenCalledWith('t1'))
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/dashboard/carriers'))
  })

  it('al eliminar la empresa navega primero y recién después quita sus consultas (sin parpadeo de 404)', async () => {
    const orden: string[] = []
    pushMock.mockImplementation(() => { orden.push('push') })
    const original = QueryClient.prototype.removeQueries
    const espia = vi.spyOn(QueryClient.prototype, 'removeQueries').mockImplementation(function (this: QueryClient, ...args) {
      orden.push('remove')
      return original.apply(this, args)
    })
    vi.mocked(carriersApi.delete).mockResolvedValue({ ok: true })
    renderPage()

    await elegirDelMenu('Eliminar')
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar eliminación' }))

    await waitFor(() => expect(orden).toContain('remove'))
    espia.mockRestore()
    expect(orden[0]).toBe('push')
  })

  it('shows the backend blocker message and does not redirect when delete is rejected', async () => {
    vi.mocked(carriersApi.delete).mockRejectedValue(
      new Error("No se puede eliminar: la empresa tiene conductores asociados. Use 'Dar de baja' en su lugar."),
    )
    renderPage()

    await elegirDelMenu('Eliminar')
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar eliminación' }))

    expect(await screen.findByText(/tiene conductores asociados/)).toBeInTheDocument()
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('un editor puede transferir: el gate de pantalla decia admin y el endpoint aceptaba editor', async () => {
    vi.mocked(driversApi.get).mockResolvedValue({
      id: 'd1', tax_id: '22222222-2', country_code: 'CL', full_name: 'Juan Pérez',
      operational_status: 'ACTIVE', is_manual_override: false, created_at: null,
      total_requirements: 5, last_document_update: null,
      home_location_id: null, home_location_name: null, home_location_shipper: null, suggested_home_location: null,
    })
    renderPage()
    await clickTab(/Conductores/)
    fireEvent.click(await screen.findByText('Juan Pérez'))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.click(await within(dialogo).findByRole('button', { name: 'Más acciones' }))
    expect(screen.getByRole('menuitem', { name: 'Transferir a otra empresa' })).toBeInTheDocument()
  })


  it('al transferir avisa a dónde quedó el conductor', async () => {
    vi.mocked(carriersApi.assignDriver).mockResolvedValue(undefined as never)
    vi.mocked(driversApi.get).mockResolvedValue({
      id: 'd1', tax_id: '22222222-2', country_code: 'CL', full_name: 'Juan Pérez',
      operational_status: 'ACTIVE', is_manual_override: false, created_at: null,
      total_requirements: 5, last_document_update: null,
      home_location_id: null, home_location_name: null, home_location_shipper: null, suggested_home_location: null,
    })
    renderPage()
    await clickTab(/Conductores/)
    fireEvent.click(await screen.findByText('Juan Pérez'))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.click(await within(dialogo).findByRole('button', { name: 'Más acciones' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Transferir a otra empresa' }))
    fireEvent.change(screen.getByPlaceholderText(/empresa destino/i), { target: { value: 'Otra' } })
    fireEvent.click(await screen.findByText('Otra Empresa'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar transferencia' }))
    await waitFor(() => expect(carriersApi.assignDriver).toHaveBeenCalledWith('c2', 'd1'))
    expect(await screen.findByText(/Listo: quedó en Otra Empresa\./)).toBeInTheDocument()
  })


  // Hallazgo 4 de la revision final: d4e6cc03 bajo tres gates de canAdmin a
  // canEdit (los dos props de los paneles y este boton); la ronda de arreglo
  // 21cd0a74 reviritio los dos props y dejo este. Es una escritura de
  // operational_status de la EMPRESA, la familia que esta rama declaro fuera
  // de alcance para conductores y vehiculos - no corresponde ensancharla
  // tambien para la empresa por inercia.
  it('sin directory.delete no ve "Dar de baja" de la empresa', async () => {
    permisos.darDeBaja = false
    renderPage()
    // Control positivo: lo que sí puede hacer aparece, o el test no distingue
    // "todavía no cargó" de "no le corresponde".
    expect(await screen.findByRole('button', { name: 'Editar' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Más acciones' }))
    expect(screen.queryByRole('menuitem', { name: 'Dar de baja' })).not.toBeInTheDocument()
  })

  it('la razón social se renombra desde Editar, en Detalles', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    fireEvent.change(screen.getByLabelText('Razón social'), { target: { value: 'Transportes Nuevo Nombre' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => {
      expect(carriersApi.patch).toHaveBeenCalledWith('t1', { business_name: 'Transportes Nuevo Nombre' })
    })
  })


  it('ya no hay botón "Editar Empresa"', async () => {
    renderPage()
    await screen.findByRole('button', { name: 'Editar' })
    expect(screen.queryByRole('button', { name: 'Editar Empresa' })).not.toBeInTheDocument()
  })

})

// ── Entrega 1 de fichas (15/10): la misma forma que conductor y equipo ──────
describe('ficha de empresa liviana', () => {
  it('F1-empresa: la razón del "No habilitada" separa lo de la empresa y lo de su flota', async () => {
    vi.mocked(carriersApi.get).mockResolvedValue({
      ...CARRIER, compliance_summary: complianceSummary({ worst_state: 'MISSING', can_operate: false, blocking: { own: 3, fleet: 5 } }),
    })
    renderPage()
    expect(await screen.findByText('3 obligatorios de la empresa y 5 de su flota')).toBeInTheDocument()
  })

  it('RF2: una empresa en onboarding dice que no está activa', async () => {
    vi.mocked(carriersApi.get).mockResolvedValue({ ...CARRIER, operational_status: 'ONBOARDING' })
    renderPage()
    expect(await screen.findByText('La empresa no está activa')).toBeInTheDocument()
  })

  it('F7-empresa: sin directory.delete el ⋯ no ofrece Dar de baja ni Eliminar', async () => {
    permisos.darDeBaja = false
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Más acciones' }))
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem').map(i => i.textContent)
    expect(items).not.toContain('Dar de baja')
    expect(items).not.toContain('Eliminar')
    expect(items).toContain('Editar clientes')
  })

  it('el Resumen es un bloque de Detalles: RUT (no "Tax ID") y sin cifras sueltas de flota', async () => {
    renderPage()
    const detalles = await screen.findByRole('region', { name: 'Detalles' })
    expect(within(detalles).getByText('RUT')).toBeInTheDocument()
    expect(screen.queryByText(/Tax ID/)).not.toBeInTheDocument()
    expect(screen.queryByText(/documentos al día|al día$/)).not.toBeInTheDocument()
  })

  it('el modal de un conductor ES su ficha, con "Abrir ficha completa"', async () => {
    renderPage()
    await clickTab(/Conductores/)
    fireEvent.click(await screen.findByText('Juan Pérez'))
    const dialogo = await screen.findByRole('dialog')
    expect(within(dialogo).getByRole('link', { name: /Abrir ficha completa/ }).getAttribute('href'))
      .toMatch(/^\/dashboard\/drivers\/d1\?next=/)
    expect(within(dialogo).getByRole('complementary')).toBeInTheDocument()
  })

  // Revisión final de la Entrega 1: "Activar" llamaba a la API sin atrapar el
  // error; si fallaba, no pasaba nada visible y parecía hecho.
  it('si Activar falla, la ficha lo dice', async () => {
    vi.mocked(carriersApi.get).mockResolvedValue({ ...CARRIER, operational_status: 'ONBOARDING' })
    vi.mocked(carriersApi.patch).mockRejectedValue(new Error('Para activarla falta su RUT.'))
    renderPage()
    await elegirDelMenu('Activar')
    // Abre en Documentos (15/10), que puede tener sus propios avisos: se busca el de Activar.
    await waitFor(() => expect(screen.getAllByRole('alert').some(a => a.textContent?.includes('Para activarla falta su RUT.'))).toBe(true))
  })

  it('en Documentos no se repite "Subir documentos" en el encabezado', async () => {
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams('tab=documentos') as unknown as ReturnType<typeof useSearchParams>)
    renderPage()
    await screen.findByRole('button', { name: 'Más acciones' })
    expect(screen.queryAllByRole('button', { name: /^Subir documentos$/ }).length).toBeLessThanOrEqual(1)
  })

  // 15/10: la pestaña decía "Conductores 0" mientras la lista estaba en vuelo y
  // después saltaba a 4. Un "0" sin el dato afirma algo falso.
  it('mientras la flota carga, las pestañas no muestran un conteo', async () => {
    vi.mocked(carriersApi.listDrivers).mockReturnValue(new Promise(() => {}))
    renderPage()
    const tab = await screen.findByRole('button', { name: /^Conductores/ })
    expect(tab).toHaveTextContent(/^Conductores$/)
  })

  // Seguros por empresa (17/10): la pestaña Seguros es el mismo detalle que el panel de
  // Seguros › Empresas; cada póliza abre su ficha (ya no el modal viejo).
  it('la pestaña Seguros es el detalle de la empresa: cada póliza abre su ficha', async () => {
    const { insuranceApi } = await import('@/lib/api/insurance')
    vi.mocked(insuranceApi.carrier).mockResolvedValue({ summary: null, policies: [{
      id: 'p1', carrier_id: 't1', carrier_name: 'Transportes Test', carrier_tax_id: '11111111-1', insurance_company: 'SURA',
      policy_number: '8581440-RC', valid_from: '2025-05-22', valid_to: '2026-05-22', has_file: false, policy_state: 'EXPIRED',
      expires_in_days: -146, installments_total: 2, paid_installments: 0, unpaid_installments: 2, overdue_installments: 2,
      next_due_date: null, has_outside_validity: false, installments: [],
    }] } as never)
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams({ tab: 'seguros' }) as unknown as ReturnType<typeof useSearchParams>)
    renderPage()
    const poliza = await screen.findByRole('article', { name: /SURA/ })
    expect(within(poliza).getByRole('link', { name: 'Abrir la póliza' }).getAttribute('href'))
      .toMatch(/^\/dashboard\/insurance\/policies\/p1\?next=/)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  // Revisión final E2 (M2): la línea Seguros de Detalles dice el estado de la empresa
  // que calcula la base, no cuenta pólizas canceladas o renovadas como "al día".
  it('Detalles › Seguros dice el veredicto de la empresa, el mismo de Seguros › Empresas', async () => {
    const { insuranceApi } = await import('@/lib/api/insurance')
    vi.mocked(insuranceApi.carrier).mockResolvedValueOnce({
      summary: { carrier_id: 't1', carrier_name: 'Transportes Test', carrier_tax_id: '11111111-1', operational_status: 'ACTIVE',
                 policies: 6, worst_state: 'EXPIRED', insurance_verdict: 'EXPIRED', insurance_alert: 'EXPIRED', severe_overdue: false,
                 unpaid_installments: 0, overdue_installments: 0, unpaid_uf: null, oldest_overdue_date: null, next_due_date: null,
                 reason_insurer: 'SURA', reason_valid_to: '2026-05-22' },
      policies: [],
    } as never)
    renderPage()
    const aside = await screen.findByRole('complementary')
    expect(await within(aside).findByText('Póliza vencida')).toBeInTheDocument()
    expect(within(aside).queryByText(/al día/i)).not.toBeInTheDocument()
  })

  // Revisión final E2 (M3): mientras las pólizas cargan, la pestaña no afirma que no hay.
  it('la pestaña Seguros no dice "Sin pólizas registradas" mientras carga', async () => {
    const { insuranceApi } = await import('@/lib/api/insurance')
    vi.mocked(insuranceApi.carrier).mockReturnValueOnce(new Promise(() => {}))
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams({ tab: 'seguros' }) as unknown as ReturnType<typeof useSearchParams>)
    renderPage()
    await screen.findByRole('button', { name: /^Seguros/ })
    expect(screen.queryByText('Sin pólizas registradas')).not.toBeInTheDocument()
  })
})
