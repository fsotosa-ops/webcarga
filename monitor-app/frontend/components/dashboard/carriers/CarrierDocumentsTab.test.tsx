import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CarrierDocumentsTab } from './CarrierDocumentsTab'

vi.mock('@/lib/api/documentIngest', () => ({
  documentIngestApi: {
    listQueue: vi.fn().mockResolvedValue({ total: 0, rows: [] }),
    previewUrl: vi.fn().mockResolvedValue({ preview_url: null }),
    upload: vi.fn(), remove: vi.fn(), classifyBatch: vi.fn(), moveItems: vi.fn(),
  },
}))
vi.mock('@/lib/api/compliance', () => ({
  complianceApi: {
    listPending: vi.fn().mockResolvedValue({ total: 0, rows: [] }),
    listRequirements: vi.fn().mockResolvedValue([]),
    listFiles: vi.fn().mockResolvedValue([]),
  },
}))
vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { list: vi.fn().mockResolvedValue({ data: [] }) },
}))
vi.mock('@/hooks/useCanEdit', () => ({ useCanEdit: () => true }))

import { documentIngestApi } from '@/lib/api/documentIngest'

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <CarrierDocumentsTab
        carrierId="c1" carrierName="ACME" records={[]}
        onExport={vi.fn()} exporting={false}
      />
    </QueryClientProvider>,
  )
}

describe('CarrierDocumentsTab', () => {
  beforeEach(() => vi.clearAllMocks())

  it('permite cargar documentos sin salir de la ficha', async () => {
    setup()
    expect(await screen.findByLabelText(/arrastrá acá los documentos de ACME/i)).toBeInTheDocument()
  })

  it('ya no manda a otro módulo para cargar', () => {
    setup()
    expect(screen.queryByText(/subir en certificación/i)).not.toBeInTheDocument()
  })

  it('usa la misma bandeja, acotada a esta empresa', async () => {
    setup()
    await screen.findByLabelText(/arrastrá acá/i)
    expect(documentIngestApi.listQueue).toHaveBeenCalledWith(
      expect.objectContaining({ carrierId: 'c1' }),
    )
  })

  it('conserva la exportación', () => {
    setup()
    expect(screen.getByRole('button', { name: /exportar todo/i })).toBeInTheDocument()
  })
})
