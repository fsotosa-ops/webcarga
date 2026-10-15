import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

let search = ''
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(search) }))
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: () => true }))
vi.mock('@/lib/api/drivers', () => ({
  driversApi: { get: vi.fn(), assignments: vi.fn(), activity: vi.fn(), listComplianceRecords: vi.fn(), listContacts: vi.fn() },
}))
vi.mock('@/lib/api/assets', () => ({
  assetsApi: { get: vi.fn(), assignments: vi.fn(), activity: vi.fn(), listComplianceRecords: vi.fn(), getDriverAssignment: vi.fn() },
}))
vi.mock('@/lib/api/locations', () => ({ locationsApi: { list: vi.fn().mockResolvedValue({ data: [] }) } }))

import { driversApi } from '@/lib/api/drivers'
import { assetsApi } from '@/lib/api/assets'
import { FleetProfile } from './FleetProfile'

const DRIVER = {
  id: 'd1', full_name: 'Vidal Soto, Pedro', tax_id: '12345678-5', country_code: 'CL', operational_status: 'ACTIVE',
  is_manual_override: false, created_at: null, total_requirements: 0, home_location_id: null,
}

function renderProfile(kind: 'driver' | 'asset' = 'driver') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FleetProfile kind={kind} id={kind === 'driver' ? 'd1' : 'a1'} />
    </QueryClientProvider>,
  )
}

const tabNames = () => screen.getByRole('group', { name: /Secciones del/ }).querySelectorAll('button')

beforeEach(() => {
  search = ''
  vi.mocked(driversApi.get).mockResolvedValue(DRIVER as never)
  vi.mocked(driversApi.activity).mockResolvedValue({ trips_30d: 3, last_trip_date: '2026-10-12', last_trip_client: 'Walmart' })
  vi.mocked(driversApi.listComplianceRecords).mockResolvedValue([])
  vi.mocked(driversApi.listContacts).mockResolvedValue([])
})

describe('FleetProfile (D4)', () => {
  it('C5: un conductor sin empresa tiene ficha propia y se puede asignar desde ella', async () => {
    vi.mocked(driversApi.assignments).mockResolvedValue([])
    renderProfile()
    expect(await screen.findByRole('region', { name: /Detalle de Vidal Soto/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Asignar a una empresa/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dónde trabaja' }))
    expect(screen.getByText('Sin empresa asignada.')).toBeInTheDocument()
  })

  it('C11: "Ver viajes en el Monitor" abre el Monitor filtrado por su RUT', async () => {
    vi.mocked(driversApi.assignments).mockResolvedValue([
      { carrier_id: 'c1', carrier_name: 'Hueraman', carrier_status: 'ACTIVE', valid_from: null, valid_until: null, current: true },
    ])
    search = 'tab=actividad'
    renderProfile()
    expect(await screen.findByRole('link', { name: /Ver viajes en el Monitor/ }))
      .toHaveAttribute('href', '/dashboard/operations/monitor?tab=historial&q=12345678-5')
  })

  it('E1: el conductor tiene las 5 pestañas de la maqueta; ?tab=documentos abre en Documentos y cambiar de pestaña cambia el contenido', async () => {
    vi.mocked(driversApi.assignments).mockResolvedValue([])
    search = 'tab=documentos'
    renderProfile()
    await screen.findByText('Documentación')
    expect([...tabNames()].map(b => b.textContent)).toEqual(['Resumen', 'Documentos', 'Dónde trabaja', 'Actividad', 'Contactos'])
    expect(screen.getByRole('button', { name: 'Documentos' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Contactos' }))
    expect(screen.queryByText('Documentación')).not.toBeInTheDocument()
    expect(screen.getByText('Contactos', { selector: 'p' })).toBeInTheDocument()
  })

  it('E2: el equipo tiene 4 pestañas, sin Contactos', async () => {
    vi.mocked(assetsApi.get).mockResolvedValue({
      id: 'a1', license_plate: 'ABCD12', asset_type: 'TRACTOCAMION', operational_status: 'ACTIVE', manufacture_year: null,
      is_manual_override: false, created_at: null, fleet_service_type_id: null, fleet_service_type_label: null,
      fleet_service_type_bg_color: null, fleet_service_type_text_color: null, webcarga_operation_type_id: null,
      webcarga_operation_type_label: null, webcarga_operation_type_code: null, total_requirements: 0, last_document_update: null,
    } as never)
    vi.mocked(assetsApi.assignments).mockResolvedValue([])
    vi.mocked(assetsApi.activity).mockResolvedValue({ trips_30d: 0, last_trip_date: null, last_trip_client: null })
    vi.mocked(assetsApi.listComplianceRecords).mockResolvedValue([])
    renderProfile('asset')
    await screen.findByRole('region', { name: /Detalle de ABCD12/ })
    expect([...tabNames()].map(b => b.textContent)).toEqual(['Resumen', 'Documentos', 'Dónde trabaja', 'Actividad'])
  })
})
