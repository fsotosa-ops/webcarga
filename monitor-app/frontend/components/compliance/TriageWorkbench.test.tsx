import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TriageWorkbench } from './TriageWorkbench'

vi.mock('@/lib/api/documentIngest', () => ({
  documentIngestApi: {
    listTray: vi.fn(), upload: vi.fn(), remove: vi.fn(),
    classifyBatch: vi.fn(), moveItems: vi.fn(),
  },
}))
vi.mock('@/lib/api/compliance', () => ({
  complianceApi: { listPending: vi.fn(), listRequirements: vi.fn() },
}))
vi.mock('@/hooks/useCanEdit', () => ({ useCanEdit: () => true }))
import { documentIngestApi } from '@/lib/api/documentIngest'
import { complianceApi } from '@/lib/api/compliance'

const item = (id: string) => ({
  id, file_name: `${id}.png`, mime_type: 'image/png', size_bytes: 10,
  storage_path: `s/${id}`, match_status: 'UNMATCHED' as const, preview_url: `https://x/${id}`,
})

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <TriageWorkbench carrierId="c1" carrierName="ACME" />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(documentIngestApi.listTray).mockReset().mockResolvedValue([item('i1'), item('i2')])
  vi.mocked(complianceApi.listPending).mockReset().mockResolvedValue({
    total: 1,
    rows: [{
      id: 'r1', carrier_id: 'c1', carrier_name: 'ACME', carrier_tax_id: '1-9',
      carrier_operation_types: [], certification_type: 'BASICA', category: 'EQUIPO',
      entity_type: 'ASSET', entity_id: 'a1', subject_name: 'HKXW55',
      requirement_code: 'PADRON', document_name: 'Padrón',
      status: 'MISSING', expiration_date: null,
    }],
  })
  vi.mocked(complianceApi.listRequirements).mockReset().mockResolvedValue([])
})

describe('TriageWorkbench', () => {
  it('muestra los tres paneles sin abrir ningún modal', async () => {
    setup()
    await screen.findByText('i1.png')
    expect(screen.getByRole('listbox', { name: /sin clasificar/i })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('al marcar dos archivos, el formulario ofrece aplicar a los dos', async () => {
    setup()
    await screen.findByText('i1.png')
    fireEvent.click(screen.getByRole('checkbox', { name: /i1\.png/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /i2\.png/ }))

    expect(await screen.findByRole('button', { name: /aplicar a los 2/i })).toBeInTheDocument()
  })

  it('deriva los sujetos de los pendientes de la empresa', async () => {
    setup()
    await screen.findByText('i1.png')
    fireEvent.click(screen.getByRole('checkbox', { name: /i1\.png/ }))

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'HKXW55' })).toBeInTheDocument()
    })
  })
})
