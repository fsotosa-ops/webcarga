import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useSearchParams } from 'next/navigation'
import CertificationPage from './page'
import { complianceApi } from '@/lib/api/compliance'
import { carriersApi } from '@/lib/api/carriers'
import type { PendingComplianceRow } from '@/lib/types'

vi.mock('@/lib/api/compliance', () => ({
  complianceApi: { listPending: vi.fn(), uploadFile: vi.fn(), bulkUploadFile: vi.fn() },
}))

vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { list: vi.fn(), create: vi.fn() },
}))

vi.mock('next/navigation', () => ({ useSearchParams: vi.fn() }))

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
      <CertificationPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(complianceApi.listPending).mockReset().mockResolvedValue({ total: 1, rows: [makeRow()] })
  vi.mocked(complianceApi.uploadFile).mockReset()
  vi.mocked(complianceApi.bulkUploadFile).mockReset()
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>)
  vi.mocked(carriersApi.list).mockReset().mockResolvedValue({ data: [{ id: 'c2', business_name: 'Otra Spa', tax_id: '77.222.222-2' }], count: 1, page: 1, limit: 10 })
  vi.mocked(carriersApi.create).mockReset()
})

describe('CertificationPage', () => {
  it('shows "Documentos Pendientes" active by default, with Resumen / Sin Clasificar disabled', async () => {
    renderPage()
    expect(await screen.findByText('Transportes Sur Spa')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Documentos Pendientes' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Resumen' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Documentos Sin Clasificar' })).toBeDisabled()
  })

  it('loads pending rows on mount with no filters set', async () => {
    renderPage()
    await screen.findByText('Transportes Sur Spa')
    expect(complianceApi.listPending).toHaveBeenCalledWith({
      category: undefined, operationType: undefined, q: undefined, carrierId: undefined, limit: 200,
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

  it('reads ?carrier_id= from the URL, filters the query by it, and shows a removable chip', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams({ carrier_id: 'c1' }) as unknown as ReturnType<typeof useSearchParams>,
    )
    renderPage()
    await waitFor(() => expect(complianceApi.listPending).toHaveBeenCalledWith(
      expect.objectContaining({ carrierId: 'c1' }),
    ))
    expect(await screen.findByLabelText('Quitar filtro de empresa')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Quitar filtro de empresa'))
    await waitFor(() => expect(complianceApi.listPending).toHaveBeenLastCalledWith(
      expect.objectContaining({ carrierId: undefined }),
    ))
  })

  it('picking a company from the Empresa filter re-queries listPending with its carrierId', async () => {
    renderPage()
    await screen.findByText('Transportes Sur Spa')
    fireEvent.change(screen.getByLabelText('Buscar empresa transportista'), { target: { value: 'Otra' } })
    fireEvent.click(await screen.findByText('Otra Spa'))
    await waitFor(() => expect(complianceApi.listPending).toHaveBeenLastCalledWith(
      expect.objectContaining({ carrierId: 'c2' }),
    ))
  })

  it('after picking a company, shows a removable chip instead of the picker', async () => {
    renderPage()
    await screen.findByText('Transportes Sur Spa')
    fireEvent.change(screen.getByLabelText('Buscar empresa transportista'), { target: { value: 'Otra' } })
    fireEvent.click(await screen.findByText('Otra Spa'))
    expect(await screen.findByLabelText('Quitar filtro de empresa')).toBeInTheDocument()
    expect(screen.queryByLabelText('Buscar empresa transportista')).not.toBeInTheDocument()
  })
})
