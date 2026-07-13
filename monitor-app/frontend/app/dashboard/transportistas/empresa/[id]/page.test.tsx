import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import EmpresaDetailPage from './page'
import { transportersApi } from '@/lib/api/transporters'
import { createClient } from '@/lib/supabase/client'

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
vi.mock('@/lib/api/transporters', () => ({
  transportersApi: {
    get: vi.fn(), patch: vi.fn(), resetField: vi.fn(),
    addDriver: vi.fn(), patchDriver: vi.fn(), removeDriver: vi.fn(),
    addVehicle: vi.fn(), patchVehicle: vi.fn(), removeVehicle: vi.fn(),
    addTrailer: vi.fn(), removeTrailer: vi.fn(),
    transferDriver: vi.fn(), transferVehicle: vi.fn(),
    listContacts: vi.fn(), upsertContact: vi.fn(), deleteContact: vi.fn(),
  },
}))
vi.mock('@/components/dashboard/InsuranceSummaryCard', () => ({ InsuranceSummaryCard: () => null }))

const PROFILE = {
  id: 't1', admin_id: '123', business_name: 'Transportes Test', rut: '11111111-1',
  account_stage: 'Operational', contactability: null, contacts: [],
  drivers: [{
    id: 'd1', rut: '22222222-2', name: 'Juan Pérez',
    governance: {
      id_expiry: '2099-01-01', license_expiry: '2099-01-01',
      anexo_3_gc: 'ok', epp: 'ok', das_odi: 'ok', hoja_de_vida: 'ok',
      cert_antecedentes: 'ok', validado_gc_driver: 'ok', contrato_trabajo: 'ok',
      creacion_gc_driver: 'ok', avance_total: 100,
    },
  }],
  vehicles: [{
    id: 'v1', type: 'Tractocamión', plate: 'ABCD12',
    governance: {
      year: 2020, circ_permit_expiry: '2099-01-01', tech_inspection_expiry: '2099-01-01',
      gas_emissions_expiry: '2099-01-01', soap_insurance_expiry: '2099-01-01',
      padron: 'ok', poliza_rc: 'ok', gps: 'ok', seguro_carga: 'ok',
      mantencion_camara_frio: 'n_a', creacion_gc_vehicle: 'ok',
    },
  }],
  trailers: [],
  manually_edited_fields: [], edited_at: null, in_admin: true, clients: ['Walmart'],
  eligibility: { eligible: false, compliance_pct: 82, insurance_ok: true, blocking_reasons: ['docs_below_threshold'] },
  documents: [],
}

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
  vi.mocked(transportersApi.get).mockReset().mockResolvedValue(PROFILE as never)
})

describe('EmpresaDetailPage', () => {
  it('shows the alert banner with the blocking reason', async () => {
    renderPage()
    expect(await screen.findByText('No habilitada para asignar')).toBeInTheDocument()
    expect(screen.getAllByText(/Documentación bajo el umbral \(82% < 90%\)/).length).toBeGreaterThan(0)
  })

  it('shows the driver and vehicle rosters', async () => {
    renderPage()
    expect(await screen.findByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByText('ABCD12')).toBeInTheDocument()
  })

  it('opens the driver detail panel when a roster card is clicked', async () => {
    renderPage()
    fireEvent.click(await screen.findByText('Juan Pérez'))
    expect(await screen.findByLabelText('Estado de EPP')).toBeInTheDocument()
  })

  it('filters the driver roster by search', async () => {
    renderPage()
    await screen.findByText('Juan Pérez')
    fireEvent.change(screen.getByPlaceholderText('Filtrar por nombre o RUT…'), { target: { value: 'nadie' } })
    await waitFor(() => expect(screen.queryByText('Juan Pérez')).not.toBeInTheDocument())
  })

  it('filters the equipment roster by category (tracto/rampla)', async () => {
    renderPage()
    await screen.findByText('ABCD12')
    fireEvent.click(screen.getByRole('button', { name: 'Rampla' }))
    await waitFor(() => expect(screen.queryByText('ABCD12')).not.toBeInTheDocument())
  })

  it('shows only the first 9 drivers with a "Mostrar los N restantes" button for larger rosters', async () => {
    const manyDrivers = Array.from({ length: 12 }, (_, i) => ({
      id: `d${i}`, rut: `${i}-1`, name: `Conductor ${i}`,
      governance: PROFILE.drivers[0].governance,
    }))
    vi.mocked(transportersApi.get).mockResolvedValue({ ...PROFILE, drivers: manyDrivers } as never)
    renderPage()
    await screen.findByText('Conductor 0')
    expect(screen.queryByText('Conductor 9')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mostrar los 3 restantes' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar los 3 restantes' }))
    expect(screen.getByText('Conductor 11')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mostrar los/ })).not.toBeInTheDocument()
  })

  it('does not poison the contact draft after Cancelar: reopening Editar shows the real current values, not a leftover cleared field', async () => {
    const contact = { role: 'rep_legal', name: 'Contacto Original', phone: '111111111', email: 'orig@example.com' }
    vi.mocked(transportersApi.get).mockResolvedValue({ ...PROFILE, contacts: [contact] } as never)
    renderPage()
    await screen.findByText('Contacto Original')

    // Abrir edición, vaciar el teléfono, cancelar sin guardar.
    fireEvent.click(screen.getByText('Editar'))
    const phoneInput = screen.getByPlaceholderText('Teléfono')
    expect(phoneInput).toHaveValue('111111111')
    fireEvent.change(phoneInput, { target: { value: '' } })
    fireEvent.click(screen.getByText('Cancelar'))

    // La vista de lectura debe seguir mostrando el teléfono real (no se guardó nada).
    expect(screen.getByText('111111111')).toBeInTheDocument()

    // Reabrir edición: el draft debe resincronizarse desde `contact`, no arrastrar
    // el valor vaciado en memoria de la edición cancelada anterior.
    fireEvent.click(screen.getByText('Editar'))
    expect(screen.getByPlaceholderText('Teléfono')).toHaveValue('111111111')
    expect(screen.getByPlaceholderText('Nombre')).toHaveValue('Contacto Original')
    expect(screen.getByPlaceholderText('Email')).toHaveValue('orig@example.com')

    // No se llamó a upsertContact en ningún momento de este flujo (solo Cancelar, nunca Guardar).
    expect(transportersApi.upsertContact).not.toHaveBeenCalled()
  })
})
