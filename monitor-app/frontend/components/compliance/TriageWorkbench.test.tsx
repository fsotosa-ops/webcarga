import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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
  complianceApi: { listPending: vi.fn(), listRequirements: vi.fn(), matchUploadFiles: vi.fn() },
}))
vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { list: vi.fn().mockResolvedValue({ data: [] }) },
}))
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: () => true }))
import { documentIngestApi } from '@/lib/api/documentIngest'
import { complianceApi } from '@/lib/api/compliance'
import { carriersApi } from '@/lib/api/carriers'

const row = (id: string, carrier: string | null, over: Record<string, unknown> = {}) => ({
  id, file_name: `${id}.png`, mime_type: 'image/png', size_bytes: 10,
  storage_path: `s/${id}`, match_status: 'UNMATCHED' as const,
  created_at: '2026-08-14T10:00:00Z',
  carrier_id: carrier?.toLowerCase() ?? null, carrier_name: carrier,
  confidence: null, suggested_requirement_name: null, candidate_count: 0,
  mismo_casillero: 1, mismo_contenido: 1, casillero_ocupado: false,
  ...over,
})

const PENDIENTE = {
  id: 'r1', carrier_id: 'acme', carrier_name: 'ACME', carrier_tax_id: '1-9',
  carrier_operation_types: [], certification_type: 'BASICA', category: 'EQUIPO',
  entity_type: 'ASSET', entity_id: 'a1', subject_name: 'HKXW55',
  requirement_id: 'req-1', requirement_code: 'PADRON', document_name: 'Padrón',
  status: 'MISSING', expiration_date: null,
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><TriageWorkbench /></QueryClientProvider>)
}

const filaDe = (nombre: string) => within(screen.getByRole('table')).getByText(nombre).closest('tr')!

beforeEach(() => {
  vi.mocked(documentIngestApi.listQueue).mockReset().mockResolvedValue({
    total: 2, rows: [row('i1', 'ACME'), row('i2', 'ACME')],
  })
  vi.mocked(documentIngestApi.previewUrl).mockReset().mockResolvedValue({ preview_url: 'https://x/1' })
  vi.mocked(documentIngestApi.remove).mockReset().mockResolvedValue(undefined as never)
  vi.mocked(documentIngestApi.moveItems).mockReset().mockResolvedValue({ moved: 1 })
  vi.mocked(documentIngestApi.classifyBatch).mockReset().mockResolvedValue({ applied: ['i1'], errors: [] })
  vi.mocked(complianceApi.listPending).mockReset().mockResolvedValue({ total: 1, rows: [PENDIENTE] } as never)
  vi.mocked(complianceApi.listRequirements).mockReset().mockResolvedValue([])
  vi.mocked(carriersApi.list).mockReset().mockResolvedValue({ data: [] } as never)
})

describe('Por asignar (TriageWorkbench, Entrega D)', () => {
  // E2-7 (Entrega 2 de fichas): el total queda en el menú y en los grupos, no en el título.
  it('E2-7: el título no lleva el total', async () => {
    setup()
    await screen.findByText('i1.png')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Por asignar$/)
  })

  it('D7: vacía dice "Todo asignado" y ofrece subir, sin zona de arrastre ni selector de empresa', async () => {
    vi.mocked(documentIngestApi.listQueue).mockResolvedValue({ total: 0, rows: [] })
    setup()
    expect(await screen.findByText('Todo asignado')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Subir documentos/ })).toBeInTheDocument()
    expect(screen.queryByText(/Arrastra aquí/i)).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/Elegir empresa/i)).not.toBeInTheDocument()
  })

  it('H2: si la cola falla lo dice como error, nunca como una bandeja vacía', async () => {
    vi.mocked(documentIngestApi.listQueue).mockReset().mockRejectedValueOnce(new Error('500'))
      .mockResolvedValue({ total: 2, rows: [row('i1', 'ACME'), row('i2', 'ACME')] })
    setup()
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar Por asignar')
    expect(screen.queryByText('Todo asignado')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('i1.png')).toBeInTheDocument()
  })

  it('D6: al asignar, el foco pasa solo al siguiente archivo', async () => {
    setup()
    await screen.findByText('i1.png')
    fireEvent.click(filaDe('i1.png'))
    await waitFor(() => expect(filaDe('i1.png')).toHaveAttribute('aria-current', 'true'))

    fireEvent.click(await screen.findByRole('button', { name: /Padrón/ }))
    fireEvent.click(await screen.findByRole('button', { name: /^Asignar$/ }))

    await waitFor(() => expect(filaDe('i2.png')).toHaveAttribute('aria-current', 'true'))
    expect(filaDe('i1.png')).not.toHaveAttribute('aria-current')
  })

  it('un archivo sin empresa la pregunta en su detalle, y elegirla se la asigna a él', async () => {
    vi.mocked(documentIngestApi.listQueue).mockResolvedValue({ total: 1, rows: [row('i9', null)] })
    vi.mocked(carriersApi.list).mockResolvedValue({ data: [{ id: 'c2', business_name: 'Fletes Sur', tax_id: '76000000-0' }] } as never)
    setup()
    fireEvent.click(await screen.findByText('i9.png'))
    fireEvent.change(await screen.findByPlaceholderText('Buscar empresa…'), { target: { value: 'fletes' } })
    fireEvent.click(await screen.findByRole('button', { name: /Fletes Sur/ }))
    await waitFor(() => expect(documentIngestApi.moveItems).toHaveBeenCalledWith(['i9'], 'c2'))
  })

  it('Descartar desde el detalle lo saca de la bandeja, con forma de restaurarlo', async () => {
    setup()
    fireEvent.click(await screen.findByText('i1.png'))
    fireEvent.click(await screen.findByRole('button', { name: 'Descartar' }))
    await waitFor(() => expect(documentIngestApi.remove).toHaveBeenCalledWith('i1'))
    expect(await screen.findByText(/Puedes restaurarlos en Descartados/)).toBeInTheDocument()
  })
})
