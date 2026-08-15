import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EntityDetailPanel } from './EntityDetailPanel'

vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { get: vi.fn(), listDrivers: vi.fn(), listAssets: vi.fn() },
}))
vi.mock('@/lib/api/drivers', () => ({
  driversApi: { get: vi.fn(), listComplianceRecords: vi.fn() },
}))
vi.mock('@/lib/api/assets', () => ({
  assetsApi: { get: vi.fn(), listComplianceRecords: vi.fn() },
}))
vi.mock('@/lib/api/compliance', () => ({
  complianceApi: {
    listFiles: vi.fn().mockResolvedValue([]), listPending: vi.fn(), reassign: vi.fn(),
    listStatus: vi.fn().mockResolvedValue({ total_pending: 0, total_unclassified: 0, rows: [] }),
  },
}))
vi.mock('@/lib/api/documentIngest', () => ({ documentIngestApi: { uploadAndClassify: vi.fn() } }))
vi.mock('@/lib/api/contacts', () => ({ contactsApi: { patch: vi.fn(), delete: vi.fn() } }))
vi.mock('@/lib/api/policies', () => ({
  policiesApi: { listByCarrier: vi.fn().mockResolvedValue([]), summary: vi.fn() },
}))
vi.mock('@/hooks/useCanEdit', () => ({ useCanEdit: () => true }))

import { carriersApi } from '@/lib/api/carriers'
import { driversApi } from '@/lib/api/drivers'

const EMPRESA = {
  id: 'c1', business_name: 'Transportes Sur', tax_id: '76.000-0',
  operational_status: 'ACTIVE', compliance_records: [], contacts: [],
}
const CONDUCTOR = {
  id: 'd1', full_name: 'Juan Pérez', tax_id: '1-9',
  carrier_id: 'c1', carrier_name: 'Transportes Sur',
}

function setup(props: Record<string, unknown> = {}) {
  const onSeleccionar = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EntityDetailPanel
        seleccion={{ tipo: 'CARRIER', id: 'c1' }}
        onSeleccionar={onSeleccionar}
        {...props}
      />
    </QueryClientProvider>,
  )
  return onSeleccionar
}

beforeEach(() => {
  vi.mocked(carriersApi.get).mockReset().mockResolvedValue(EMPRESA as never)
  vi.mocked(carriersApi.listDrivers).mockReset().mockResolvedValue([] as never)
  vi.mocked(carriersApi.listAssets).mockReset().mockResolvedValue([] as never)
  vi.mocked(driversApi.get).mockReset().mockResolvedValue(CONDUCTOR as never)
  vi.mocked(driversApi.listComplianceRecords).mockReset().mockResolvedValue([] as never)
})

describe('EntityDetailPanel', () => {
  it('sin selección invita a elegir, no queda en blanco', () => {
    setup({ seleccion: null })
    expect(screen.getByText(/selecciona una empresa/i)).toBeInTheDocument()
  })

  it('de una empresa muestra su flota y sus documentos', async () => {
    setup()
    expect(await screen.findByRole('heading', { name: 'Transportes Sur' })).toBeInTheDocument()
    expect(screen.getByText(/su flota/i)).toBeInTheDocument()
    expect(screen.getByText(/sus documentos/i)).toBeInTheDocument()
  })

  // La idea es no salir de la pantalla: el detalle está embebido, nunca en un modal.
  it('bajar a un conductor cambia el panel, no la página', async () => {
    const onSeleccionar = setup({ seleccion: { tipo: 'DRIVER', id: 'd1' } })
    expect(await screen.findByRole('heading', { name: 'Juan Pérez' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Transportes Sur' }))
    expect(onSeleccionar).toHaveBeenCalledWith({ tipo: 'CARRIER', id: 'c1' })
  })

  it('la empresa del conductor sale de su propio detalle, sin contexto previo', async () => {
    setup({ seleccion: { tipo: 'DRIVER', id: 'd1' } })
    await screen.findByRole('heading', { name: 'Juan Pérez' })
    expect(screen.getByRole('button', { name: 'Transportes Sur' })).toBeInTheDocument()
  })

  it('un conductor sin empresa lo dice y no ofrece cargar', async () => {
    vi.mocked(driversApi.get).mockResolvedValue({ ...CONDUCTOR, carrier_id: null, carrier_name: null } as never)
    vi.mocked(driversApi.listComplianceRecords).mockResolvedValue([{
      id: 'cr1', requirement_id: 'req1', requirement_code: 'LIC', name: 'Licencia',
      requirement_level: 'LEGAL_MANDATORY', requires_file: true, status: 'MISSING',
      expiration_date: null, file_url: null, metadata: {}, is_manual_override: false,
      is_expired: false, is_expiring_soon: false, updated_at: null,
    }] as never)
    setup({ seleccion: { tipo: 'DRIVER', id: 'd1' } })

    expect(await screen.findByText(/sin empresa asignada/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Subir Licencia')).not.toBeInTheDocument()
  })

  // Seguros y Contactos eran dos tabs: ahora son secciones del mismo panel,
  // plegadas porque no son el trabajo diario.
  it('trae Seguros y Contactos como secciones, no como tabs', async () => {
    setup()
    await screen.findByRole('heading', { name: 'Transportes Sur' })
    expect(screen.getByRole('button', { name: /seguros/i })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: /contactos/i })).toBeInTheDocument()
  })

  it('las secciones plegadas se abren en su sitio', async () => {
    setup()
    await screen.findByRole('heading', { name: 'Transportes Sur' })
    fireEvent.click(screen.getByRole('button', { name: /contactos/i }))
    expect(screen.getByRole('button', { name: /contactos/i })).toHaveAttribute('aria-expanded', 'true')
  })

  it('avisa si la entidad no existe', async () => {
    vi.mocked(carriersApi.get).mockRejectedValue(new Error('no encontrada'))
    setup()
    expect(await screen.findByText(/no se pudo cargar/i)).toBeInTheDocument()
  })
})
