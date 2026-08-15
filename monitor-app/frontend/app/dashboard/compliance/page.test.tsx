import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const replace = vi.fn()
const push = vi.fn()
let params = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useSearchParams: () => params,
  useRouter: () => ({ replace, push }),
}))
vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { list: vi.fn().mockResolvedValue({ data: [] }), get: vi.fn() },
}))
vi.mock('@/lib/api/drivers', () => ({
  driversApi: { get: vi.fn(), listComplianceRecords: vi.fn().mockResolvedValue([]) },
}))
vi.mock('@/lib/api/assets', () => ({
  assetsApi: { get: vi.fn(), listComplianceRecords: vi.fn().mockResolvedValue([]) },
}))
vi.mock('@/lib/api/compliance', () => ({
  complianceApi: {
    listStatus: vi.fn(),
    listFiles: vi.fn().mockResolvedValue([]), reassign: vi.fn(),
    listPending: vi.fn().mockResolvedValue({ total: 0, rows: [] }),
    listRequirements: vi.fn().mockResolvedValue([]),
  },
}))
vi.mock('@/lib/api/documentIngest', () => ({
  documentIngestApi: {
    listQueue: vi.fn().mockResolvedValue({ total: 0, rows: [] }),
    previewUrl: vi.fn(), upload: vi.fn(), remove: vi.fn(),
    classifyBatch: vi.fn(), moveItems: vi.fn(),
  },
}))
vi.mock('@/hooks/useCanEdit', () => ({ useCanEdit: () => true }))

import { complianceApi } from '@/lib/api/compliance'
import { carriersApi } from '@/lib/api/carriers'
import { driversApi } from '@/lib/api/drivers'
import CertificationPage from './page'

const FILA = {
  entity_id: 'c1', entity_name: 'Test Empresa Webcarga',
  carrier_id: 'c1', carrier_name: 'Test Empresa Webcarga', operational_status: 'ACTIVE',
  total_count: 12, satisfied_count: 9, pending_count: 3, pending_mandatory: 1,
  unclassified_count: 3,
}

function setup() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CertificationPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  params = new URLSearchParams()
  vi.mocked(complianceApi.listStatus).mockResolvedValue({
    total_pending: 3, total_unclassified: 3, rows: [FILA],
  })
})

// El módulo dejó de ser tres listas hermanas (Pendientes, Bandeja, Empresas):
// es UNA lista de empresas con dos maneras de mirarla.
describe('Certificación — una lista, dos vistas', () => {
  it('abre en la vista por empresa, que responde cómo va cada una', async () => {
    setup()
    expect(await screen.findByText('Test Empresa Webcarga')).toBeInTheDocument()
    expect(screen.getByText('9 de 12')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Empresas' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('muestra en la misma fila lo que falta y lo que llegó sin clasificar', async () => {
    setup()
    const fila = (await screen.findByText('Test Empresa Webcarga')).closest('tr')!
    expect(fila).toHaveTextContent('9 de 12')
    // El contador de sin clasificar, en la misma fila que el avance.
    expect(fila.querySelector('.bg-red-50')).toHaveTextContent('3')
  })

  it('la vista viaja en la URL, así volver del detalle no pierde el lugar', async () => {
    setup()
    await screen.findByText('Test Empresa Webcarga')
    fireEvent.click(screen.getByRole('button', { name: 'Documentos' }))
    expect(replace).toHaveBeenCalledWith('/dashboard/compliance?vista=documentos')
  })

  it('con ?vista=documentos muestra la cola transversal', async () => {
    params = new URLSearchParams('vista=documentos')
    setup()
    expect(await screen.findByText(/no hay documentos sin clasificar/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Documentos' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('busca empresas sin recargar la vista', async () => {
    setup()
    await screen.findByText('Test Empresa Webcarga')
    fireEvent.change(screen.getByPlaceholderText(/buscar empresa/i), { target: { value: 'quilquen' } })

    await waitFor(() => {
      expect(complianceApi.listStatus).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'quilquen', group: 'carrier' }),
      )
    }, { timeout: 2000 })
  })

  it('agrupa por conductor y muestra la empresa de cada uno', async () => {
    params = new URLSearchParams('vista=conductores')
    vi.mocked(complianceApi.listStatus).mockResolvedValue({
      total_pending: 3, total_unclassified: 0,
      rows: [{ ...FILA, entity_id: 'd1', entity_name: 'Juan Pérez',
               carrier_id: 'c9', carrier_name: 'Transportes Sur Spa' }],
    })
    setup()

    expect(await screen.findByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Transportes Sur Spa' })).toBeInTheDocument()
    expect(complianceApi.listStatus).toHaveBeenCalledWith(
      expect.objectContaining({ group: 'driver' }),
    )
  })

  it('agrupa por vehículo', async () => {
    params = new URLSearchParams('vista=vehiculos')
    setup()
    await waitFor(() => {
      expect(complianceApi.listStatus).toHaveBeenCalledWith(
        expect.objectContaining({ group: 'asset' }),
      )
    })
  })

  it('no pide el estado cuando estás en la cola', async () => {
    params = new URLSearchParams('vista=documentos')
    setup()
    await screen.findByText(/no hay documentos sin clasificar/i)
    expect(complianceApi.listStatus).not.toHaveBeenCalled()
  })
})


// Una sola página: la selección abre el panel de al lado y viaja en la URL.
describe('Certificación — detalle embebido', () => {
  beforeEach(() => {
    vi.mocked(complianceApi.listStatus).mockResolvedValue({
      total_pending: 3, total_unclassified: 3, rows: [FILA],
    })
    vi.mocked(carriersApi.get).mockResolvedValue({
      id: 'c1', business_name: 'Test Empresa Webcarga', tax_id: '1-9',
      operational_status: 'ACTIVE', compliance_records: [], contacts: [],
    } as never)
  })

  it('sin selección el panel invita a elegir', async () => {
    setup()
    await screen.findByText('Test Empresa Webcarga')
    expect(screen.getByText(/selecciona una empresa/i)).toBeInTheDocument()
  })

  it('elegir una fila deja la selección en la URL', async () => {
    setup()
    fireEvent.click(await screen.findByRole('button', { name: /Test Empresa Webcarga/ }))
    expect(replace).toHaveBeenCalledWith('/dashboard/compliance?empresa=c1')
  })

  it('la selección se lee de la URL, así el enlace se comparte', async () => {
    params = new URLSearchParams('empresa=c1')
    setup()
    expect(await screen.findByRole('heading', { name: 'Test Empresa Webcarga' })).toBeInTheDocument()
  })

  it('bajar a un conductor queda en la URL', async () => {
    params = new URLSearchParams('empresa=c1&conductor=d1')
    setup()
    await waitFor(() => expect(driversApi.get).toHaveBeenCalledWith('d1'))
  })

  // La bandeja tiene su propia grilla de tres regiones: no lleva panel al lado.
  it('la vista Documentos sigue a todo el ancho', async () => {
    params = new URLSearchParams('vista=documentos')
    setup()
    expect(await screen.findByText(/no hay documentos sin clasificar/i)).toBeInTheDocument()
    expect(screen.queryByText(/selecciona una empresa/i)).not.toBeInTheDocument()
  })
})
