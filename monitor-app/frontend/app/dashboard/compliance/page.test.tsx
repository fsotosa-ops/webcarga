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
vi.mock('@/lib/api/compliance', () => ({
  complianceApi: {
    listCarrierStatus: vi.fn(),
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
vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { list: vi.fn().mockResolvedValue({ data: [] }) },
}))
vi.mock('@/hooks/useCanEdit', () => ({ useCanEdit: () => true }))

import { complianceApi } from '@/lib/api/compliance'
import CertificationPage from './page'

const FILA = {
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
  vi.mocked(complianceApi.listCarrierStatus).mockResolvedValue({
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
    expect(screen.getByRole('button', { name: 'Por empresa' })).toHaveAttribute('aria-pressed', 'true')
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
    fireEvent.click(screen.getByRole('button', { name: 'Por documento' }))
    expect(replace).toHaveBeenCalledWith('/dashboard/compliance?vista=documentos')
  })

  it('con ?vista=documentos muestra la cola transversal', async () => {
    params = new URLSearchParams('vista=documentos')
    setup()
    expect(await screen.findByText(/no hay documentos sin clasificar/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Por documento' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('busca empresas sin recargar la vista', async () => {
    setup()
    await screen.findByText('Test Empresa Webcarga')
    fireEvent.change(screen.getByLabelText(/buscar empresa/i), { target: { value: 'quilquen' } })

    await waitFor(() => {
      expect(complianceApi.listCarrierStatus).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'quilquen' }),
      )
    }, { timeout: 2000 })
  })

  it('no pide el estado de empresas cuando estás en la cola', async () => {
    params = new URLSearchParams('vista=documentos')
    setup()
    await screen.findByText(/no hay documentos sin clasificar/i)
    expect(complianceApi.listCarrierStatus).not.toHaveBeenCalled()
  })
})
