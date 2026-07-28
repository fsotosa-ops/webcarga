import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import EmpresaDetailPage from './page'
import { carriersApi } from '@/lib/api/carriers'
import { driversApi } from '@/lib/api/drivers'
import { assetsApi } from '@/lib/api/assets'
import { contactsApi } from '@/lib/api/contacts'
import { createClient } from '@/lib/supabase/client'
import type { Carrier, CarrierDriverRosterItem, CarrierAssetRosterItem } from '@/lib/types'

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
async function clickTab(name: RegExp) {
  const matches = await screen.findAllByRole('button', { name })
  fireEvent.click(matches[0])
}

vi.mock('next/navigation', () => ({ useParams: vi.fn(), useRouter: vi.fn(), useSearchParams: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/api/carriers', () => ({
  carriersApi: {
    get: vi.fn(), patch: vi.fn(), delete: vi.fn(),
    listDrivers: vi.fn(), assignDriver: vi.fn(), unassignDriver: vi.fn(),
    listAssets: vi.fn(), assignAsset: vi.fn(), unassignAsset: vi.fn(),
    listContacts: vi.fn(), createContact: vi.fn(),
    listPolicies: vi.fn(), createPolicy: vi.fn(),
    listShippers: vi.fn(), exportDocuments: vi.fn(),
  },
}))
vi.mock('@/lib/api/drivers', () => ({
  driversApi: {
    get: vi.fn(), create: vi.fn(), patch: vi.fn(), listComplianceRecords: vi.fn(),
    listContacts: vi.fn(), createContact: vi.fn(),
  },
}))
vi.mock('@/lib/api/assets', () => ({
  assetsApi: { get: vi.fn(), create: vi.fn(), patch: vi.fn(), listComplianceRecords: vi.fn() },
}))
vi.mock('@/lib/api/contacts', () => ({
  contactsApi: { patch: vi.fn(), delete: vi.fn() },
}))
vi.mock('@/components/dashboard/InsuranceSummaryCard', () => ({ InsuranceSummaryCard: () => null }))

const CARRIER: Carrier = {
  id: 't1', tax_id: '11111111-1', country_code: 'CL', business_name: 'Transportes Test',
  operational_status: 'ACTIVE', legacy_admin_id: null, erp_id: null, is_manual_override: false,
  overridden_by: null, overridden_at: null, created_at: null, updated_at: null,
  contacts: [],
  compliance_records: [{
    id: 'cr1', requirement_id: 'req1', requirement_code: 'F30', name: 'F30 Multas',
    requirement_level: 'LEGAL_MANDATORY', requires_file: true, status: 'MISSING',
    expiration_date: null, file_url: null, metadata: {}, is_manual_override: false,
    is_expired: false, is_expiring_soon: false, updated_at: null,
  }],
}

const DRIVERS: CarrierDriverRosterItem[] = [
  { id: 'd1', tax_id: '22222222-2', full_name: 'Juan Pérez', operational_status: 'ACTIVE', total_requirements: 5, last_document_update: null, pending_mandatory: 0, compliance_health: 'OK' },
]

const ASSETS: CarrierAssetRosterItem[] = [
  { id: 'v1', license_plate: 'ABCD12', asset_type: 'TRACTOCAMION', operational_status: 'ACTIVE', total_requirements: 3, last_document_update: null, pending_mandatory: 0, compliance_health: 'OK' },
]

const pushMock = vi.fn()

beforeEach(() => {
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
  vi.mocked(carriersApi.listPolicies).mockReset().mockResolvedValue([])
  vi.mocked(carriersApi.listShippers).mockReset().mockResolvedValue([])
  vi.mocked(driversApi.listComplianceRecords).mockReset().mockResolvedValue([])
  vi.mocked(driversApi.listContacts).mockReset().mockResolvedValue([])
  vi.mocked(assetsApi.listComplianceRecords).mockReset().mockResolvedValue([])
})

describe('EmpresaDetailPage', () => {
  it('shows the alert banner when there is a mandatory MISSING record', async () => {
    renderPage()
    await clickTab(/Documentos/)
    expect(await screen.findByText('1 documento obligatorio con atención')).toBeInTheDocument()
    expect(screen.getAllByText('F30 Multas').length).toBeGreaterThan(0)
  })

  // HU-08 (Fase 0): export en bloque de documentos — pedido de Fabián en la
  // reunión del 20/07.
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
    fireEvent.change(screen.getByPlaceholderText('Filtrar por nombre o tax_id…'), { target: { value: 'nadie' } })
    await waitFor(() => expect(screen.queryByText('Juan Pérez')).not.toBeInTheDocument())
  })

  it('filters the equipment roster by asset type', async () => {
    renderPage()
    await clickTab(/Equipos/)
    await screen.findByText('ABCD12')
    fireEvent.click(screen.getByRole('button', { name: 'Rampla' }))
    await waitFor(() => expect(screen.queryByText('ABCD12')).not.toBeInTheDocument())
  })

  it('shows only the first 9 drivers with a "Mostrar los N restantes" button for larger rosters', async () => {
    const manyDrivers: CarrierDriverRosterItem[] = Array.from({ length: 12 }, (_, i) => ({
      id: `d${i}`, tax_id: `${i}-1`, full_name: `Conductor ${i}`,
      operational_status: 'ACTIVE', total_requirements: 5, last_document_update: null,
      pending_mandatory: 0, compliance_health: 'OK',
    }))
    vi.mocked(carriersApi.listDrivers).mockResolvedValue(manyDrivers)
    renderPage()
    await clickTab(/Conductores/)
    await screen.findByText('Conductor 0')
    expect(screen.queryByText('Conductor 9')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mostrar los 3 restantes' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar los 3 restantes' }))
    expect(screen.getByText('Conductor 11')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mostrar los/ })).not.toBeInTheDocument()
  })

  it('does not poison the contact draft after Cancelar: reopening Editar shows the real current values', async () => {
    vi.mocked(carriersApi.get).mockResolvedValue({
      ...CARRIER,
      contacts: [{ id: 'ct1', contact_role: 'LEGAL_REP', first_name: 'Contacto', last_name: 'Original', job_title: null, phone: '111111111', email: 'orig@example.com', is_primary: true, is_active: true }],
    })
    renderPage()
    await clickTab(/Contactos/)
    await screen.findByText('Contacto Original')

    fireEvent.click(screen.getByText('Editar'))
    const phoneInput = screen.getByPlaceholderText('Teléfono')
    expect(phoneInput).toHaveValue('111111111')
    fireEvent.change(phoneInput, { target: { value: '' } })
    fireEvent.click(screen.getByText('Cancelar'))

    expect(screen.getByText('111111111')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Editar'))
    expect(screen.getByPlaceholderText('Teléfono')).toHaveValue('111111111')
    expect(screen.getByPlaceholderText('Nombre')).toHaveValue('Contacto Original')
    expect(screen.getByPlaceholderText('Email')).toHaveValue('orig@example.com')

    expect(contactsApi.patch).not.toHaveBeenCalled()
  })

  it('shows the legacy admin id when present', async () => {
    vi.mocked(carriersApi.get).mockResolvedValue({ ...CARRIER, legacy_admin_id: '4567' })
    renderPage()
    expect(await screen.findByText('4567')).toBeInTheDocument()
  })

  it('does not show a legacy admin id row when absent', async () => {
    renderPage()
    await screen.findAllByText('Transportes Test')
    expect(screen.queryByText('ID legacy admin:')).not.toBeInTheDocument()
  })

  it('shows the shippers the carrier operates with as chips', async () => {
    vi.mocked(carriersApi.listShippers).mockResolvedValue([
      { id: 's1', name: 'Walmart', status: 'ACTIVE', start_date: null, end_date: null },
      { id: 's2', name: 'Colun', status: 'ACTIVE', start_date: null, end_date: null },
    ])
    renderPage()
    expect(await screen.findByText('Walmart')).toBeInTheDocument()
    expect(screen.getByText('Colun')).toBeInTheDocument()
  })

  it('shows a placeholder when the carrier has no shipper linked', async () => {
    renderPage()
    expect(await screen.findByText('Sin generador de carga vinculado')).toBeInTheDocument()
  })

  it('lands on Resumen by default with a compact score, not the full itemized alert list', async () => {
    renderPage()
    expect(await screen.findByText('0 de 1 al día')).toBeInTheDocument()
    expect(screen.getByText('1 obligatorio pendiente')).toBeInTheDocument()
    expect(screen.queryByText('Documentos obligatorios pendientes o vencidos')).not.toBeInTheDocument()
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
    expect(await screen.findByText(/Pólizas \(/)).toBeInTheDocument()
  })

  it('shows a pending-docs badge on the Documentos tab', async () => {
    renderPage()
    const tab = await screen.findByRole('button', { name: /Documentos/ })
    expect(tab).toHaveTextContent('1')
  })

  it('switches sections without navigating away from the page', async () => {
    renderPage()
    await clickTab(/Contactos/)
    expect(await screen.findByText('+ Agregar contacto')).toBeInTheDocument()
    expect(screen.queryByText('0 de 1 al día')).not.toBeInTheDocument()

    await clickTab(/Resumen/)
    expect(await screen.findByText('0 de 1 al día')).toBeInTheDocument()
  })

  it('deletes the carrier and redirects to the list on confirm', async () => {
    vi.mocked(carriersApi.delete).mockResolvedValue({ ok: true })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar' }))
    expect(screen.getByText(/Eliminar: Transportes Test/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar eliminación' }))

    await waitFor(() => expect(carriersApi.delete).toHaveBeenCalledWith('t1'))
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/dashboard/carriers'))
  })

  it('shows the backend blocker message and does not redirect when delete is rejected', async () => {
    vi.mocked(carriersApi.delete).mockRejectedValue(
      new Error("No se puede eliminar: la empresa tiene conductores asociados. Use 'Dar de baja' en su lugar."),
    )
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar eliminación' }))

    expect(await screen.findByText(/tiene conductores asociados/)).toBeInTheDocument()
    expect(pushMock).not.toHaveBeenCalled()
  })
})
