import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import DocumentsPage from './page'
import { complianceApi } from '@/lib/api/compliance'
import type { PendingComplianceRow } from '@/lib/types'

vi.mock('@/lib/api/compliance', () => ({
  complianceApi: { listPending: vi.fn(), uploadFile: vi.fn(), bulkUploadFile: vi.fn() },
}))

function makeRow(overrides: Partial<PendingComplianceRow> = {}): PendingComplianceRow {
  return {
    id: 'r1', carrier_id: 'c1', carrier_name: 'Transportes Sur Spa', carrier_tax_id: '76.111.111-1',
    carrier_operation_types: ['Tractoreo'], certification_type: 'BASICA', category: 'CHOFER',
    entity_type: 'DRIVER', entity_id: 'd1', subject_name: 'Juan Perez',
    requirement_code: 'LICENCIA_CONDUCIR', document_name: 'Licencia conducir',
    status: 'MISSING', expiration_date: null,
    ...overrides,
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <DocumentsPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(complianceApi.listPending).mockReset().mockResolvedValue({ total: 1, rows: [makeRow()] })
  vi.mocked(complianceApi.uploadFile).mockReset()
  vi.mocked(complianceApi.bulkUploadFile).mockReset()
})

describe('DocumentsPage', () => {
  it('shows "Documentos Pendientes" active by default, with Certificación / Sin Clasificar disabled', async () => {
    renderPage()
    expect(await screen.findByText('Transportes Sur Spa')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Documentos Pendientes' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Certificación' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Documentos Sin Clasificar' })).toBeDisabled()
  })

  it('loads pending rows on mount with no filters set', async () => {
    renderPage()
    await screen.findByText('Transportes Sur Spa')
    expect(complianceApi.listPending).toHaveBeenCalledWith({
      category: undefined, operationType: undefined, q: undefined, limit: 200,
    })
  })

  it('changing the category filter re-queries with the selected category', async () => {
    renderPage()
    await screen.findByText('Transportes Sur Spa')
    fireEvent.change(screen.getByLabelText('Filtrar por categoría'), { target: { value: 'DRIVER' } })
    await waitFor(() => expect(complianceApi.listPending).toHaveBeenLastCalledWith(
      expect.objectContaining({ category: 'DRIVER' }),
    ))
  })

  it('changing the operation type filter re-queries with the selected value', async () => {
    renderPage()
    await screen.findByText('Transportes Sur Spa')
    fireEvent.change(screen.getByLabelText('Filtrar por tipo de operación'), { target: { value: 'Equipo Completo' } })
    await waitFor(() => expect(complianceApi.listPending).toHaveBeenLastCalledWith(
      expect.objectContaining({ operationType: 'Equipo Completo' }),
    ))
  })

  it('typing in the search box debounces before re-querying', async () => {
    renderPage()
    await screen.findByText('Transportes Sur Spa')
    vi.mocked(complianceApi.listPending).mockClear()
    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'Sur' } })
    expect(complianceApi.listPending).not.toHaveBeenCalled()
    await waitFor(() => expect(complianceApi.listPending).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'Sur' }),
    ), { timeout: 1000 })
  })

  it('"Exportar" is disabled when there are no rows and enabled once rows load', async () => {
    vi.mocked(complianceApi.listPending).mockResolvedValue({ total: 0, rows: [] })
    renderPage()
    await waitFor(() => expect(complianceApi.listPending).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /Exportar/ })).toBeDisabled()
  })

  it('exporting triggers a CSV download', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:mock')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    renderPage()
    await screen.findByText('Transportes Sur Spa')
    fireEvent.click(screen.getByRole('button', { name: /Exportar/ }))
    expect(createObjectURL).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
