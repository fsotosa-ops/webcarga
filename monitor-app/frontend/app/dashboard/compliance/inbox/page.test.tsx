import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi } from 'vitest'
import ComplianceInboxPage from './page'

vi.mock('@/lib/api/documentIngest', () => ({
  documentIngestApi: {
    listQueue: vi.fn().mockResolvedValue({ total: 0, rows: [] }),
    previewUrl: vi.fn(), upload: vi.fn(), remove: vi.fn(),
    classifyBatch: vi.fn(), moveItems: vi.fn(),
  },
}))
vi.mock('@/lib/api/compliance', () => ({
  complianceApi: {
    listPending: vi.fn().mockResolvedValue({ total: 0, rows: [] }),
    listRequirements: vi.fn().mockResolvedValue([]),
  },
}))
vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { list: vi.fn().mockResolvedValue({ data: [] }) },
}))
vi.mock('@/hooks/useCanEdit', () => ({ useCanEdit: () => true }))

function setup() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ComplianceInboxPage />
    </QueryClientProvider>,
  )
}

describe('ComplianceInboxPage', () => {
  it('muestra la bandeja vacia con un mensaje util, no una tabla pelada', async () => {
    setup()
    expect(await screen.findByText(/no hay documentos sin clasificar/i)).toBeInTheDocument()
  })

  it('se llama Bandeja', () => {
    setup()
    expect(screen.getByRole('heading', { name: 'Bandeja' })).toBeInTheDocument()
  })
})
