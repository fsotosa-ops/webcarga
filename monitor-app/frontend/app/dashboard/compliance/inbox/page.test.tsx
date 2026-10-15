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
  carriersApi: { list: vi.fn().mockResolvedValue({ data: [] }) },
}))
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: () => true }))

import { documentIngestApi } from '@/lib/api/documentIngest'
import { complianceApi } from '@/lib/api/compliance'
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
  vi.mocked(documentIngestApi.listQueue).mockReset().mockResolvedValue({ total: 0, rows: [] })
  vi.mocked(complianceApi.listStatus).mockReset()
  vi.mocked(complianceApi.listPending).mockReset().mockResolvedValue({ total: 0, rows: [] })
  vi.mocked(complianceApi.listRequirements).mockReset().mockResolvedValue([])
})

// Por asignar es un destino propio, no una vista de Certificación: la página
// SÓLO monta la bandeja, así que jamás pide el estado de certificación.
describe('ComplianceInboxPage — Por asignar es otro trabajo, no otra vista', () => {
  it('no pide el estado de certificación por empresa', async () => {
    setup()
    await screen.findByText('Todo asignado')
    expect(complianceApi.listStatus).not.toHaveBeenCalled()
  })

  it('el encabezado dice "Por asignar", la etiqueta que ve el usuario', async () => {
    setup()
    expect(await screen.findByRole('heading', { name: /por asignar/i })).toBeInTheDocument()
  })
})
