import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api/documentIngest', () => ({
  documentIngestApi: {
    listQueue: vi.fn(), previewUrl: vi.fn(), upload: vi.fn(),
    remove: vi.fn(), classifyBatch: vi.fn(), moveItems: vi.fn(),
  },
}))
vi.mock('@/lib/api/compliance', () => ({
  complianceApi: { listStatus: vi.fn(), listPending: vi.fn(), listRequirements: vi.fn() },
}))
vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { list: vi.fn().mockResolvedValue({ data: [] }), get: vi.fn() },
}))
const searchParams = new URLSearchParams()
vi.mock('next/navigation', () => ({ useSearchParams: () => searchParams }))
vi.mock('@/hooks/useCanEdit', () => ({ useCanEdit: () => true }))

import { documentIngestApi } from '@/lib/api/documentIngest'
import { complianceApi } from '@/lib/api/compliance'
import { carriersApi } from '@/lib/api/carriers'
import ComplianceInboxPage from './page'

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <ComplianceInboxPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  searchParams.delete('empresa')
  vi.mocked(carriersApi.get).mockReset()
  vi.mocked(documentIngestApi.listQueue).mockReset().mockResolvedValue({ total: 0, rows: [] })
  vi.mocked(complianceApi.listStatus).mockReset()
  vi.mocked(complianceApi.listPending).mockReset().mockResolvedValue({ total: 0, rows: [] })
  vi.mocked(complianceApi.listRequirements).mockReset().mockResolvedValue([])
})

// La Bandeja es un destino propio, no una vista de Certificación (Task 5):
// antes esta aserción vivía en app/dashboard/compliance/page.test.tsx
// ("no pide el estado cuando estás en la cola"), pegada a un componente que
// alternaba entre la cola y el estado por empresa. Acá no hay ese
// conmutador: la página SÓLO monta la bandeja, así que jamás pide el estado
// de certificación.
describe('ComplianceInboxPage — la Bandeja es otro trabajo, no otra vista', () => {
  it('monta la bandeja de triaje', async () => {
    setup()
    expect(await screen.findByText(/no hay documentos sin clasificar/i)).toBeInTheDocument()
  })

  it('no pide el estado de certificación por empresa', async () => {
    setup()
    await screen.findByText(/no hay documentos sin clasificar/i)
    expect(complianceApi.listStatus).not.toHaveBeenCalled()
  })

  it('el encabezado dice "Sin clasificar", la etiqueta que ve el usuario', async () => {
    setup()
    expect(await screen.findByRole('heading', { name: /sin clasificar/i })).toBeInTheDocument()
  })

  // Llegar "a la Bandeja" desde la ficha de una empresa tiene que llegar con
  // esa empresa ya elegida: el motor acota el universo a sus entidades (~2
  // conductores y ~3 vehículos contra 87 y 124). Sin esto la capacidad existe
  // y no tiene puerta.
  it('llegando desde la ficha de una empresa, el lote arranca con ella elegida', async () => {
    searchParams.set('empresa', 'c1')
    vi.mocked(carriersApi.get).mockResolvedValue({
      id: 'c1', business_name: 'Transportes Charlotte Spa', tax_id: '76.111.111-1',
    } as never)
    setup()

    expect(await screen.findByText(/Transportes Charlotte Spa/)).toBeInTheDocument()
  })

  it('sin empresa en el enlace no pregunta por ninguna', async () => {
    setup()
    await screen.findByText(/no hay documentos sin clasificar/i)
    expect(carriersApi.get).not.toHaveBeenCalled()
  })
})
