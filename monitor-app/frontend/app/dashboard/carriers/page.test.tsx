import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import EmpresasTransportePage from './page'
import { carriersApi } from '@/lib/api/carriers'
import { createClient } from '@/lib/supabase/client'
import type { CarrierListResponse } from '@/lib/types'

vi.mock('next/navigation', () => ({ useRouter: vi.fn(), useSearchParams: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { list: vi.fn(), create: vi.fn(), buscar: vi.fn() },
}))

function emptyResponse(): CarrierListResponse {
  return { data: [], count: 0, page: 1, limit: 100, facets: { pending: 0, ok: 0, total: 0 } }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <EmpresasTransportePage />
    </QueryClientProvider>,
  )
}

const pushMock = vi.fn()

beforeEach(() => {
  pushMock.mockReset()
  vi.mocked(useRouter).mockReturnValue({ push: pushMock } as unknown as ReturnType<typeof useRouter>)
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>)
  vi.mocked(createClient).mockReturnValue({
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    from: vi.fn(),
  } as unknown as ReturnType<typeof createClient>)
  vi.mocked(carriersApi.list).mockReset().mockResolvedValue(emptyResponse())
  vi.mocked(carriersApi.create).mockReset()
  vi.mocked(carriersApi.buscar).mockReset().mockResolvedValue({
    q: '', empresas: [], conductores: [], vehiculos: [],
  })
})

describe('EmpresasTransportePage', () => {
  it('renders an Onboarding tab alongside Activas/Inactivas', async () => {
    renderPage()
    await waitFor(() => expect(carriersApi.list).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /^Activas/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Inactivas/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Onboarding/ })).toBeInTheDocument()
  })

  it('selecting the Onboarding tab re-queries with operational_status: ONBOARDING', async () => {
    renderPage()
    await waitFor(() => expect(carriersApi.list).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /^Onboarding/ }))
    await waitFor(() => expect(carriersApi.list).toHaveBeenCalledWith(
      expect.objectContaining({ operational_status: ['ONBOARDING'] }),
    ))
    expect(screen.getByRole('button', { name: /^Onboarding/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('"Inactivas" pide los DOS estados de baja, no sólo el del padrón viejo', async () => {
    // El resumen de esta misma pantalla cuenta LEGACY_INACTIVE + INACTIVE
    // ("214 inactivas") y la pestaña filtraba sólo el primero (206): las 8 que
    // faltaban eran las dadas de baja desde la app, y no aparecían en NINGUNA
    // de las tres pestañas.
    renderPage()
    await waitFor(() => expect(carriersApi.list).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /^Inactivas/ }))

    await waitFor(() => expect(carriersApi.list).toHaveBeenCalledWith(
      expect.objectContaining({ operational_status: ['LEGACY_INACTIVE', 'INACTIVE'] }),
    ))
  })
  // ── El buscador único (2026-09-07) ────────────────────────────────────────
  // Buscar "Pardo" —un conductor que existe— devolvía "Sin resultados, 0
  // empresas". La búsqueda por conductor y por patente vivía en Certificación,
  // donde no se puede dar de baja a nadie ni moverlo de empresa.

  it('buscar un apellido muestra al conductor, con su RUT y su empresa', async () => {
    vi.mocked(carriersApi.buscar).mockResolvedValue({
      q: 'pardo',
      empresas: [],
      conductores: [{
        id: 'd1', full_name: 'Manuel Pardo', tax_id: '11111111-1',
        operational_status: 'ACTIVE', carrier_id: 'c9', carrier_name: 'Transportes Sur',
      }],
      vehiculos: [],
    })
    renderPage()

    fireEvent.change(screen.getByLabelText('Buscar empresa, conductor o patente'), {
      target: { value: 'pardo' },
    })

    expect(await screen.findByText('Manuel Pardo')).toBeInTheDocument()
    // El RUT en la fila: es el dato con el que se decide cuál duplicado queda,
    // y vivía en un solo lugar de la app, adentro del panel.
    expect(screen.getByText('11111111-1')).toBeInTheDocument()
    expect(screen.getByText('Transportes Sur')).toBeInTheDocument()
  })

  it('el conductor encontrado lleva a su panel ya abierto, sin pasar por la empresa', async () => {
    vi.mocked(carriersApi.buscar).mockResolvedValue({
      q: 'pardo',
      empresas: [],
      conductores: [{
        id: 'd1', full_name: 'Manuel Pardo', tax_id: '11111111-1',
        operational_status: 'ACTIVE', carrier_id: 'c9', carrier_name: 'Transportes Sur',
      }],
      vehiculos: [],
    })
    renderPage()
    fireEvent.change(screen.getByLabelText('Buscar empresa, conductor o patente'), {
      target: { value: 'pardo' },
    })

    const fila = await screen.findByRole('link', { name: /Manuel Pardo/ })
    expect(fila).toHaveAttribute('href', '/dashboard/carriers/c9?tab=conductores&driver=d1')
  })

  it('la patente encontrada lleva al equipo ya abierto', async () => {
    vi.mocked(carriersApi.buscar).mockResolvedValue({
      q: 'DTBY52',
      empresas: [],
      conductores: [],
      vehiculos: [{
        id: 'a1', license_plate: 'DTBY52', asset_type: 'TRACTOCAMION',
        operational_status: 'ACTIVE', webcarga_operation_type_label: 'Tractoreo',
        carrier_id: 'cf', carrier_name: 'La Fortaleza',
      }],
    })
    renderPage()
    fireEvent.change(screen.getByLabelText('Buscar empresa, conductor o patente'), {
      target: { value: 'DTBY52' },
    })

    const fila = await screen.findByRole('link', { name: /DTBY52/ })
    expect(fila).toHaveAttribute('href', '/dashboard/carriers/cf?tab=equipos&asset=a1')
  })

  it('un conductor sin empresa se muestra igual, y no finge un destino', async () => {
    // Son 10 personas hoy. No tienen ficha donde abrirse; un link que lleva a
    // una lista vacía es peor que decir que no hay a dónde ir.
    vi.mocked(carriersApi.buscar).mockResolvedValue({
      q: 'huerfano',
      empresas: [],
      conductores: [{
        id: 'd2', full_name: 'Conductor Huerfano', tax_id: '22222222-2',
        operational_status: 'ACTIVE', carrier_id: null, carrier_name: null,
      }],
      vehiculos: [],
    })
    renderPage()
    fireEvent.change(screen.getByLabelText('Buscar empresa, conductor o patente'), {
      target: { value: 'huerfano' },
    })

    expect(await screen.findByText('Conductor Huerfano')).toBeInTheDocument()
    expect(screen.getByText('sin empresa')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Conductor Huerfano/ })).not.toBeInTheDocument()
  })

  it('con una sola letra no pide nada: el padrón entero no es una respuesta', async () => {
    renderPage()
    await waitFor(() => expect(carriersApi.list).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText('Buscar empresa, conductor o patente'), {
      target: { value: 'a' },
    })

    await waitFor(() => expect(carriersApi.list).toHaveBeenCalled())
    expect(carriersApi.buscar).not.toHaveBeenCalled()
  })
})
