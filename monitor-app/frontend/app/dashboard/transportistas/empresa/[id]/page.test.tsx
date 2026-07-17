import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
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

vi.mock('next/navigation', () => ({ useParams: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/api/carriers', () => ({
  carriersApi: {
    get: vi.fn(), patch: vi.fn(),
    listDrivers: vi.fn(), assignDriver: vi.fn(), unassignDriver: vi.fn(),
    listAssets: vi.fn(), assignAsset: vi.fn(), unassignAsset: vi.fn(),
    listContacts: vi.fn(), createContact: vi.fn(),
    listPolicies: vi.fn(), createPolicy: vi.fn(),
  },
}))
vi.mock('@/lib/api/drivers', () => ({
  driversApi: { get: vi.fn(), create: vi.fn(), patch: vi.fn(), listComplianceRecords: vi.fn() },
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
    is_expired: false, is_expiring_soon: false,
  }],
}

const DRIVERS: CarrierDriverRosterItem[] = [
  { id: 'd1', tax_id: '22222222-2', full_name: 'Juan Pérez', operational_status: 'ACTIVE', total_requirements: 5, last_document_update: null },
]

const ASSETS: CarrierAssetRosterItem[] = [
  { id: 'v1', license_plate: 'ABCD12', asset_type: 'TRACTOCAMION', operational_status: 'ACTIVE', total_requirements: 3, last_document_update: null },
]

beforeEach(() => {
  vi.mocked(useParams).mockReturnValue({ id: 't1' })
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
  vi.mocked(driversApi.listComplianceRecords).mockReset().mockResolvedValue([])
  vi.mocked(assetsApi.listComplianceRecords).mockReset().mockResolvedValue([])
})

describe('EmpresaDetailPage', () => {
  it('shows the alert banner when there is a mandatory MISSING record', async () => {
    renderPage()
    expect(await screen.findByText('Documentos obligatorios pendientes o vencidos')).toBeInTheDocument()
    expect(screen.getByText(/F30 Multas — falta/)).toBeInTheDocument()
  })

  it('shows the driver and equipment rosters', async () => {
    renderPage()
    expect(await screen.findByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByText('ABCD12')).toBeInTheDocument()
  })

  it('opens the driver detail panel when a roster card is clicked', async () => {
    vi.mocked(driversApi.get).mockResolvedValue({
      id: 'd1', tax_id: '22222222-2', country_code: 'CL', full_name: 'Juan Pérez',
      operational_status: 'ACTIVE', is_manual_override: false, created_at: null,
      total_requirements: 5, last_document_update: null,
    })
    renderPage()
    fireEvent.click(await screen.findByText('Juan Pérez'))
    await waitFor(() => expect(driversApi.get).toHaveBeenCalledWith('d1'))
  })

  it('filters the driver roster by search', async () => {
    renderPage()
    await screen.findByText('Juan Pérez')
    fireEvent.change(screen.getByPlaceholderText('Filtrar por nombre o tax_id…'), { target: { value: 'nadie' } })
    await waitFor(() => expect(screen.queryByText('Juan Pérez')).not.toBeInTheDocument())
  })

  it('filters the equipment roster by asset type', async () => {
    renderPage()
    await screen.findByText('ABCD12')
    fireEvent.click(screen.getByRole('button', { name: 'Rampla' }))
    await waitFor(() => expect(screen.queryByText('ABCD12')).not.toBeInTheDocument())
  })

  it('shows only the first 9 drivers with a "Mostrar los N restantes" button for larger rosters', async () => {
    const manyDrivers: CarrierDriverRosterItem[] = Array.from({ length: 12 }, (_, i) => ({
      id: `d${i}`, tax_id: `${i}-1`, full_name: `Conductor ${i}`,
      operational_status: 'ACTIVE', total_requirements: 5, last_document_update: null,
    }))
    vi.mocked(carriersApi.listDrivers).mockResolvedValue(manyDrivers)
    renderPage()
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
})
