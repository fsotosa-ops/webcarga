import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { InsurancePolicyModal } from './InsurancePolicyModal'
import { insuranceApi } from '@/lib/api/insurance'
import type { InsuranceSummaryRow, InsuranceTransporterResponse } from '@/lib/types'

vi.mock('@/lib/api/insurance', () => ({
  insuranceApi: {
    getForTransporter:  vi.fn(),
    patchInstallment:   vi.fn(),
    revertInstallment:  vi.fn(),
    listPolicyDocuments: vi.fn(),
    uploadDocumentFile:  vi.fn(),
  },
}))

const ROW: InsuranceSummaryRow = {
  rut: '22222222-2', business_name: 'Transportes Vencido', transporter_id: 't2',
  policies_count: 2, next_due: null, overdue_count: 1, paid_pct: 50, insurance_ok: false,
}

const TWO_POLICIES: InsuranceTransporterResponse = {
  rut: '22222222-2', transporter_id: 't2',
  policies: [
    {
      id: 'p1', transporter_id: 't2', rut: '22222222-2', contractor_name: null, client_group: null,
      company: 'Chubb Generales', policy_number: '5663040', endorsement: null, coverage: 'RC vehicular',
      plate: null, policy_type: 'otro', valid_from: '2026-03-23', valid_to: '2027-03-23',
      payment_url: null, file_url: null, storage_path: null, updated_at: '2026-07-01T00:00:00Z',
      installments: [
        { id: 'i1', policy_id: 'p1', installment_number: 1, total_installments: 2, amount_uf: 4, due_date: '2020-01-01', status: 'vencida', paid_at: null, payment_url: null, manual_override: false, updated_at: '2026-07-01T00:00:00Z' },
        { id: 'i2', policy_id: 'p1', installment_number: 2, total_installments: 2, amount_uf: 4, due_date: '2099-09-01', status: 'pendiente', paid_at: null, payment_url: null, manual_override: false, updated_at: '2026-07-01T00:00:00Z' },
      ],
    },
    {
      id: 'p2', transporter_id: 't2', rut: '22222222-2', contractor_name: null, client_group: null,
      company: 'HDI', policy_number: '89632', endorsement: null, coverage: 'RC vehicular',
      plate: null, policy_type: 'otro', valid_from: null, valid_to: null,
      payment_url: null, file_url: null, storage_path: null, updated_at: '2026-07-01T00:00:00Z',
      installments: [
        { id: 'i3', policy_id: 'p2', installment_number: 1, total_installments: 1, amount_uf: 2.5, due_date: '2026-05-01', status: 'pagada', paid_at: '2026-05-01', payment_url: null, manual_override: false, updated_at: '2026-07-01T00:00:00Z' },
      ],
    },
  ],
}

const ROW_B: InsuranceSummaryRow = {
  rut: '33333333-3', business_name: 'Otra Transportista', transporter_id: 't3',
  policies_count: 1, next_due: null, overdue_count: 0, paid_pct: 50, insurance_ok: true,
}

const ONE_POLICY_B: InsuranceTransporterResponse = {
  rut: '33333333-3', transporter_id: 't3',
  policies: [
    {
      id: 'p3', transporter_id: 't3', rut: '33333333-3', contractor_name: null, client_group: null,
      company: 'Mapfre', policy_number: '1000', endorsement: null, coverage: 'RC vehicular',
      plate: null, policy_type: 'otro', valid_from: '2026-01-01', valid_to: '2027-01-01',
      payment_url: null, file_url: null, storage_path: null, updated_at: '2026-07-01T00:00:00Z',
      installments: [
        { id: 'i4', policy_id: 'p3', installment_number: 1, total_installments: 2, amount_uf: 3, due_date: '2026-08-01', status: 'pendiente', paid_at: null, payment_url: null, manual_override: false, updated_at: '2026-07-01T00:00:00Z' },
        { id: 'i5', policy_id: 'p3', installment_number: 2, total_installments: 2, amount_uf: 3, due_date: '2026-09-01', status: 'pendiente', paid_at: null, payment_url: null, manual_override: false, updated_at: '2026-07-01T00:00:00Z' },
      ],
    },
  ],
}

function renderModal(row: InsuranceSummaryRow | null, opts: { canAdmin?: boolean; canEdit?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={client}>
      <InsurancePolicyModal row={row} onClose={vi.fn()} canAdmin={opts.canAdmin ?? true} canEdit={opts.canEdit ?? true} />
    </QueryClientProvider>,
  )
  return {
    ...utils,
    /** Vuelve a renderizar el MISMO árbol (mismo QueryClient, sin key/remount
     *  del modal) con otra `row` — simula cerrar y reabrir el modal tal como
     *  lo hace PolizasTab.tsx, que monta InsurancePolicyModal sin key. */
    rerenderWithRow: (nextRow: InsuranceSummaryRow | null) => utils.rerender(
      <QueryClientProvider client={client}>
        <InsurancePolicyModal row={nextRow} onClose={vi.fn()} canAdmin={opts.canAdmin ?? true} canEdit={opts.canEdit ?? true} />
      </QueryClientProvider>,
    ),
  }
}

beforeEach(() => {
  vi.mocked(insuranceApi.getForTransporter).mockReset().mockImplementation(async (transporterId: string) =>
    transporterId === 't3' ? ONE_POLICY_B : TWO_POLICIES,
  )
  vi.mocked(insuranceApi.listPolicyDocuments).mockReset().mockResolvedValue([
    { doc_code: 'poliza_firmada', label: 'Póliza firmada', has_expiry: false, status: 'ok', expiry_date: null, file_url: null, storage_path: null, notes: null, manual_override: false, updated_at: '2026-07-01T00:00:00Z' },
  ])
  vi.mocked(insuranceApi.uploadDocumentFile).mockReset()
  vi.mocked(insuranceApi.patchInstallment).mockReset()
  vi.mocked(insuranceApi.revertInstallment).mockReset()
})

describe('InsurancePolicyModal', () => {
  it('renders no dialog content when row is null', () => {
    renderModal(null)
    expect(screen.queryByText('Chubb Generales')).not.toBeInTheDocument()
  })

  it('moves focus into the dialog when it opens', async () => {
    renderModal(ROW)
    await screen.findByText('Chubb Generales')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('dialog')))
  })

  it('shows a policy switcher when the company has more than one policy', async () => {
    renderModal(ROW)
    expect(await screen.findByText('Chubb Generales')).toBeInTheDocument()
    expect(screen.getByText('Pólizas (2)')).toBeInTheDocument()
    expect(screen.getByText('HDI')).toBeInTheDocument()
  })

  it('spotlights the oldest overdue installment as "próxima cuota"', async () => {
    renderModal(ROW)
    await screen.findByText('Chubb Generales')
    expect(screen.getByText('Próxima cuota')).toBeInTheDocument()
    expect(screen.getByText(/Cuota 1 de 2/)).toBeInTheDocument()
  })

  it('switches the selected policy when clicking another one in the list', async () => {
    renderModal(ROW)
    await screen.findByText('Chubb Generales')
    await act(async () => {
      fireEvent.click(screen.getByText('HDI'))
    })
    await waitFor(() => expect(screen.getByText('Póliza 89632')).toBeInTheDocument())
    // HDI solo tiene una cuota, ya pagada — no hay "próxima cuota" que destacar
    expect(screen.queryByText('Próxima cuota')).not.toBeInTheDocument()
  })

  it('expands the full installment list when "Ver todas las cuotas" is clicked', async () => {
    renderModal(ROW)
    await screen.findByText('Chubb Generales')
    // El auto-select de la póliza inicial (efecto disparado al resolver la
    // query) y el efecto que colapsa "ver todas" ante ese cambio de
    // `selectedPolicyId` quedan agendados como passive effects que aún no
    // se flushean en el momento en que `findByText` resuelve su promesa —
    // sólo espera a que el DOM tenga el texto, no a que TODOS los efectos
    // pendientes del componente hayan corrido. Si el click se dispara antes
    // de ese flush, el efecto pendiente corre después y revierte el toggle.
    // Un `act()` vacío fuerza a asentar esos efectos antes de interactuar.
    await act(async () => {})
    await act(async () => {
      fireEvent.click(screen.getByText(/Ver todas las cuotas \(2\)/))
    })
    await waitFor(() => expect(screen.getByText(/Cuota 2 de 2/)).toBeInTheDocument())
  })

  it('fetches and renders the document checklist for the selected policy', async () => {
    renderModal(ROW)
    await screen.findByText('Chubb Generales')
    expect(await screen.findByText('Póliza firmada')).toBeInTheDocument()
    expect(insuranceApi.listPolicyDocuments).toHaveBeenCalledWith('p1')
  })

  it('shows a message when the company has no linked transporter profile', () => {
    renderModal({ ...ROW, transporter_id: null })
    expect(screen.getByText(/no tiene ficha vinculada/)).toBeInTheDocument()
  })

  it('collapses "ver todas las cuotas" again when reopening for a different company', async () => {
    const { rerenderWithRow } = renderModal(ROW)
    await screen.findByText('Chubb Generales')
    // Ver comentario en el test de "expands..." — asienta los passive effects
    // pendientes del auto-select antes de interactuar con el toggle.
    await act(async () => {})
    await act(async () => {
      fireEvent.click(screen.getByText(/Ver todas las cuotas \(2\)/))
    })
    await waitFor(() => expect(screen.getByText(/Cuota 2 de 2/)).toBeInTheDocument())

    // Cerrar el modal (row=null) y reabrir para OTRA empresa. PolizasTab.tsx
    // monta InsurancePolicyModal sin `key`, así que el componente nunca se
    // remonta: el único mecanismo que puede colapsar "ver todas" acá es el
    // efecto ligado a `selectedPolicyId`, disparado por el auto-select que
    // corre cuando cambia `policies` (no un click en el switcher).
    await act(async () => {
      rerenderWithRow(null)
    })
    await act(async () => {
      rerenderWithRow(ROW_B)
    })

    await screen.findByText('Mapfre')
    expect(screen.getByText(/Ver todas las cuotas \(2\)/)).toBeInTheDocument()
    expect(screen.queryByText(/Cuota 2 de 2/)).not.toBeInTheDocument()
  })
})
