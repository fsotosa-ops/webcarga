import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TriageWorkbench } from './TriageWorkbench'

vi.mock('@/lib/api/documentIngest', () => ({
  documentIngestApi: {
    listQueue: vi.fn(), previewUrl: vi.fn(), upload: vi.fn(),
    remove: vi.fn(), classifyBatch: vi.fn(), moveItems: vi.fn(),
    undoClassify: vi.fn(),
  },
}))
vi.mock('@/lib/api/compliance', () => ({
  complianceApi: { listPending: vi.fn(), listRequirements: vi.fn() },
}))
vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { list: vi.fn().mockResolvedValue({ data: [] }) },
}))
vi.mock('@/hooks/useCanEdit', () => ({ useCanEdit: () => true }))

// TriageClassifyForm hace la llamada a classifyBatch y reporta hacia arriba
// con onApplied. Acá interesa qué hace el Workbench con ese aviso, no volver
// a probar el formulario, que tiene sus propios tests.
vi.mock('./TriageClassifyForm', () => ({
  TriageClassifyForm: ({ onApplied }: { onApplied: (ids: string[]) => void }) => (
    <button type="button" onClick={() => onApplied(['i1', 'i2'])}>simular lote aplicado</button>
  ),
}))

import { documentIngestApi } from '@/lib/api/documentIngest'
import { complianceApi } from '@/lib/api/compliance'

const row = (id: string, carrier: string) => ({
  id, file_name: `${id}.png`, mime_type: 'image/png', size_bytes: 10,
  storage_path: `s/${id}`, match_status: 'UNMATCHED' as const,
  created_at: '2026-08-14T10:00:00Z',
  carrier_id: carrier.toLowerCase(), carrier_name: carrier,
  confidence: null, suggested_requirement_name: null, candidate_count: 0,
})

function setup(props: Record<string, unknown> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <TriageWorkbench {...props} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(documentIngestApi.listQueue).mockReset().mockResolvedValue({
    total: 2, rows: [row('i1', 'ACME'), row('i2', 'NORTE')],
  })
  vi.mocked(documentIngestApi.previewUrl).mockReset()
    .mockResolvedValue({ preview_url: 'https://x/1' })
  vi.mocked(documentIngestApi.undoClassify).mockReset()
  vi.mocked(complianceApi.listPending).mockReset().mockResolvedValue({
    total: 1,
    rows: [{
      id: 'r1', carrier_id: 'acme', carrier_name: 'ACME', carrier_tax_id: '1-9',
      carrier_operation_types: [], certification_type: 'BASICA', category: 'EQUIPO',
      entity_type: 'ASSET', entity_id: 'a1', subject_name: 'HKXW55',
      requirement_code: 'PADRON', document_name: 'Padrón',
      status: 'MISSING', expiration_date: null,
    }],
  } as never)
  vi.mocked(complianceApi.listRequirements).mockReset().mockResolvedValue([])
})

describe('TriageWorkbench — deshacer un lote', () => {
  it('aplicar un lote deja el aviso de deshacer', async () => {
    setup({ carrierId: 'c1', carrierName: 'Transportes Charlotte Spa' })
    fireEvent.click(await screen.findByRole('button', { name: /simular lote aplicado/i }))
    expect(await screen.findByRole('status')).toHaveTextContent(/2 archivos/)
    expect(screen.getByRole('button', { name: /deshacer/i })).toBeInTheDocument()
  })

  it('deshacer revierte exactamente el lote que se acaba de aplicar', async () => {
    vi.mocked(documentIngestApi.undoClassify).mockResolvedValue({ reverted: ['i1', 'i2'], errors: [] })
    setup({ carrierId: 'c1', carrierName: 'Transportes Charlotte Spa' })
    fireEvent.click(await screen.findByRole('button', { name: /simular lote aplicado/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^deshacer$/i }))
    await waitFor(() =>
      expect(documentIngestApi.undoClassify).toHaveBeenCalledWith(['i1', 'i2']),
    )
  })
})
