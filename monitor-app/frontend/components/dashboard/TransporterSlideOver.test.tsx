import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TransporterSlideOver } from './TransporterSlideOver'
import { carriersApi } from '@/lib/api/carriers'
import type { CarrierListItem, Carrier } from '@/lib/types'

vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { get: vi.fn(), listPolicies: vi.fn() },
}))

const ITEM: CarrierListItem = {
  id: 't1', tax_id: '11111111-1', country_code: 'CL', business_name: 'Transportes Test',
  operational_status: 'ACTIVE', total_requirements: 2, last_document_update: null,
  pending_mandatory: 0, compliance_health: 'OK',
}

const CARRIER: Carrier = {
  id: 't1', tax_id: '11111111-1', country_code: 'CL', business_name: 'Transportes Test',
  operational_status: 'ACTIVE', legacy_admin_id: null, erp_id: null, is_manual_override: false,
  overridden_by: null, overridden_at: null, created_at: null, updated_at: null,
  contacts: [{ id: 'ct1', contact_role: 'OPERATIONS', first_name: 'Juan', last_name: 'Pérez', job_title: null, email: 'juan@test.cl', phone: '+56911112222', is_primary: true, is_active: true }],
  compliance_records: [
    { id: 'd1', requirement_id: 'r1', requirement_code: 'D1', name: 'Doc 1', requirement_level: 'LEGAL_MANDATORY', requires_file: true, status: 'APPROVED', expiration_date: null, file_url: null, metadata: {}, is_manual_override: false, is_expired: false, is_expiring_soon: false, updated_at: null },
    { id: 'd2', requirement_id: 'r2', requirement_code: 'D2', name: 'Doc 2', requirement_level: 'LEGAL_MANDATORY', requires_file: true, status: 'PENDING_REVIEW', expiration_date: '2026-01-01', file_url: null, metadata: {}, is_manual_override: false, is_expired: false, is_expiring_soon: false, updated_at: null },
  ],
}

function renderSlideOver(item: CarrierListItem | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TransporterSlideOver item={item} onClose={vi.fn()} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(carriersApi.get).mockReset().mockResolvedValue(CARRIER)
  vi.mocked(carriersApi.listPolicies).mockReset().mockResolvedValue([])
})

describe('TransporterSlideOver', () => {
  it('renders nothing when item is null', () => {
    renderSlideOver(null)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('Transportes Test')).not.toBeInTheDocument()
  })

  it('renders the header immediately from the list item, before the detail fetch resolves', () => {
    renderSlideOver(ITEM)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Transportes Test')).toBeInTheDocument()
    expect(screen.getByText('Activa')).toBeInTheDocument()
  })

  it('shows the documents summary and lists non-approved documents once loaded', async () => {
    renderSlideOver(ITEM)
    await waitFor(() => expect(screen.getByText('Doc 2')).toBeInTheDocument())
    expect(screen.getByText(/documentos al día/)).toBeInTheDocument()
    expect(screen.getByText('En revisión')).toBeInTheDocument()
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
    vi.mocked(carriersApi.get).mockReset().mockRejectedValue(new Error('Error de red'))
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
