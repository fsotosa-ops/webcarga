import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TriageWorkbench } from './TriageWorkbench'

vi.mock('@/lib/api/documentIngest', () => ({
  documentIngestApi: {
    listQueue: vi.fn(), previewUrl: vi.fn(), upload: vi.fn(),
    remove: vi.fn(), classifyBatch: vi.fn(), moveItems: vi.fn(),
  },
}))
vi.mock('@/lib/api/compliance', () => ({
  complianceApi: { listPending: vi.fn(), listRequirements: vi.fn() },
}))
vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { list: vi.fn().mockResolvedValue({ data: [] }) },
}))
vi.mock('@/hooks/useCanEdit', () => ({ useCanEdit: () => true }))
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

describe('TriageWorkbench', () => {
  it('sin empresa pide la cola completa', async () => {
    setup()
    await screen.findByText('i1.png')
    expect(documentIngestApi.listQueue).toHaveBeenCalledWith(
      expect.objectContaining({ carrierId: undefined }),
    )
  })

  it('con empresa acota la cola a esa empresa', async () => {
    setup({ carrierId: 'acme', carrierName: 'ACME' })
    await screen.findByText('i1.png')
    expect(documentIngestApi.listQueue).toHaveBeenCalledWith(
      expect.objectContaining({ carrierId: 'acme' }),
    )
  })

  it('no abre ningun modal', async () => {
    setup()
    await screen.findByText('i1.png')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('la barra contextual aparece al seleccionar', async () => {
    setup()
    await screen.findByText('i1.png')
    fireEvent.click(screen.getByRole('checkbox', { name: /i1\.png/ }))
    expect(await screen.findByText(/^1 seleccionado$/i)).toBeInTheDocument()
  })

  it('marcar un archivo de otra empresa reemplaza la seleccion', async () => {
    setup()
    await screen.findByText('i1.png')
    fireEvent.click(screen.getByRole('checkbox', { name: /i1\.png/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /i2\.png/ }))

    // El formulario aplica un requisito de UNA entidad: mezclar empresas
    // dejaria la eleccion de sujeto sin sentido.
    expect(await screen.findByText(/^1 seleccionado$/i)).toBeInTheDocument()
  })

  it('subir solo se ofrece con una empresa definida', async () => {
    setup()
    await screen.findByText('i1.png')
    expect(screen.queryByLabelText(/arrastrá acá/i)).not.toBeInTheDocument()
  })

  it('desde la ficha si se puede subir', async () => {
    setup({ carrierId: 'acme', carrierName: 'ACME' })
    expect(await screen.findByLabelText(/arrastrá acá los documentos de ACME/i)).toBeInTheDocument()
  })

  it('pide la url firmada solo del archivo enfocado', async () => {
    setup()
    await screen.findByText('i1.png')
    fireEvent.click(screen.getByText('i1.png'))
    await waitFor(() => {
      expect(documentIngestApi.previewUrl).toHaveBeenCalledWith('i1')
    })
    expect(documentIngestApi.previewUrl).toHaveBeenCalledTimes(1)
  })

  it('deriva los sujetos de la empresa de la seleccion', async () => {
    setup()
    await screen.findByText('i1.png')
    fireEvent.click(screen.getByRole('checkbox', { name: /i1\.png/ }))
    await waitFor(() => {
      expect(complianceApi.listPending).toHaveBeenCalledWith(
        expect.objectContaining({ carrierId: 'acme' }),
      )
    })
  })
})
