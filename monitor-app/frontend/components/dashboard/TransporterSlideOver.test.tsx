import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TransporterSlideOver } from './TransporterSlideOver'
import { transportersApi } from '@/lib/api/transporters'
import { insuranceApi } from '@/lib/api/insurance'
import type { TransporterListItem, TransporterProfile } from '@/lib/types'

vi.mock('@/lib/api/transporters', () => ({
  transportersApi: { get: vi.fn() },
}))
vi.mock('@/lib/api/insurance', () => ({
  insuranceApi: { getForTransporter: vi.fn() },
}))

const ITEM: TransporterListItem = {
  id: 't1', admin_id: null, business_name: 'Transportes Test', rut: '11111111-1',
  account_stage: null, driver_count: 4, vehicle_count: 6, trailer_count: 2, tracto_count: 4,
  has_manual_edits: false, has_active_alerts: false, in_admin: true, clients: ['Walmart'],
  avance_80_20: 85, avance_total: 70, compliance_pct: 85, eligible: false, insurance_ok: true,
  policies_count: 2, blocking_reasons: ['docs_below_threshold'],
  operational_status: 'operativa', matched_by_upload: false, admin_account_id: null,
}

const PROFILE: TransporterProfile = {
  id: 't1', admin_id: null, business_name: 'Transportes Test', rut: '11111111-1',
  account_stage: null, contactability: null,
  contacts: [{ role: 'operacional', name: 'Juan Pérez', phone: '+56911112222', email: 'juan@test.cl' }],
  drivers: [], vehicles: [], trailers: [],
  manually_edited_fields: [], edited_at: null, in_admin: true,
  clients: ['Walmart'],
  eligibility: { eligible: false, compliance_pct: 85, insurance_ok: true, blocking_reasons: ['docs_below_threshold'] },
  documents: [
    { doc_code: 'd1', label: 'Doc 1', status: 'ok', expiry_date: null, file_url: null, storage_path: null, manual_override: false, updated_at: null },
    { doc_code: 'd2', label: 'Doc 2', status: 'pendiente', expiry_date: '2026-01-01', file_url: null, storage_path: null, manual_override: false, updated_at: null },
  ],
  operational_status: 'operativa', matched_by_upload: false, admin_account_id: null,
}

function renderSlideOver(item: TransporterListItem | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TransporterSlideOver item={item} onClose={vi.fn()} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(transportersApi.get).mockReset().mockResolvedValue(PROFILE)
  vi.mocked(insuranceApi.getForTransporter).mockReset().mockResolvedValue({
    rut: '11111111-1', transporter_id: 't1', policies: [],
  })
})

describe('TransporterSlideOver', () => {
  it('renders the panel off-screen with no content when item is null', () => {
    renderSlideOver(null)
    const panel = screen.getByRole('dialog')
    expect(panel.className).toContain('translate-x-full')
    expect(screen.queryByText('Transportes Test')).not.toBeInTheDocument()
  })

  it('renders the header immediately from the list item, before the detail fetch resolves', () => {
    renderSlideOver(ITEM)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Transportes Test')).toBeInTheDocument()
    expect(screen.getByText(/Documentación bajo el umbral/)).toBeInTheDocument()
  })

  it('shows the documents summary and lists non-ok documents once loaded', async () => {
    renderSlideOver(ITEM)
    await waitFor(() => expect(screen.getByText('Doc 2')).toBeInTheDocument())
    expect(screen.getByText(/documentos OK/)).toBeInTheDocument()
    expect(screen.getByText('Pendiente')).toBeInTheDocument()
    // Doc 1 (status ok) is not listed among the issues
    expect(screen.queryByText('Doc 1')).not.toBeInTheDocument()
  })

  it('shows contacts with tel/mailto links once loaded', async () => {
    renderSlideOver(ITEM)
    const phoneLink = await screen.findByText('+56911112222')
    expect(phoneLink.closest('a')).toHaveAttribute('href', 'tel:+56911112222')
    const emailLink = screen.getByText('juan@test.cl')
    expect(emailLink.closest('a')).toHaveAttribute('href', 'mailto:juan@test.cl')
  })

  it('shows a visible error when the detail fetch fails (no silent failure)', async () => {
    vi.mocked(transportersApi.get).mockReset().mockRejectedValue(new Error('Error de red'))
    renderSlideOver(ITEM)
    expect(await screen.findAllByText('Error de red')).not.toHaveLength(0)
  })

  it('links to the full ficha', () => {
    renderSlideOver(ITEM)
    const link = screen.getByText('Ver ficha completa').closest('a')
    expect(link).toHaveAttribute('href', '/dashboard/transportistas/empresa/t1')
  })

  it('closes on Escape', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const onClose = vi.fn()
    render(
      <QueryClientProvider client={client}>
        <TransporterSlideOver item={ITEM} onClose={onClose} />
      </QueryClientProvider>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
