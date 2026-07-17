import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { InsurancePolicyModal } from './InsurancePolicyModal'
import { carriersApi } from '@/lib/api/carriers'
import { policiesApi, coverageTypesApi } from '@/lib/api/policies'
import type { CarrierPolicyListItem, InsurancePolicy, CarrierAssetRosterItem, CoverageType } from '@/lib/types'

vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { listPolicies: vi.fn(), listAssets: vi.fn() },
}))
vi.mock('@/lib/api/policies', () => ({
  policiesApi: {
    get: vi.fn(), patch: vi.fn(), patchInstallment: vi.fn(),
    linkCoverage: vi.fn(), unlinkCoverage: vi.fn(), linkAsset: vi.fn(), unlinkAsset: vi.fn(),
  },
  coverageTypesApi: { list: vi.fn() },
}))

const LIST: CarrierPolicyListItem[] = [
  {
    id: 'p1', insurance_company: 'Chubb Generales', policy_number: '5663040',
    coverage_names: 'RC vehicular', total_assets_covered: 1, policy_expiration_date: '2027-03-23',
    policy_health: 'VALID', total_installments: 2, paid_installments: 0, overdue_installments: 1,
    next_payment_date: '2020-01-01',
  },
  {
    id: 'p2', insurance_company: 'HDI', policy_number: '89632',
    coverage_names: 'RC vehicular', total_assets_covered: 0, policy_expiration_date: null,
    policy_health: 'VALID', total_installments: 1, paid_installments: 1, overdue_installments: 0,
    next_payment_date: null,
  },
]

const DETAIL_P1: InsurancePolicy = {
  id: 'p1', carrier_id: 'c1', insurance_company: 'Chubb Generales', policy_number: '5663040',
  valid_from: '2026-03-23', valid_to: '2027-03-23', expiration_alert_days: 30,
  policy_document_url: null, has_endorsement: false, endorsement_document_url: null,
  external_portal_url: null, status: 'ACTIVE', is_manual_override: false,
  created_at: null, updated_at: null,
  coverages: [{ coverage_type_id: 'cov1', code: 'RC', name: 'RC vehicular' }],
  assets: [],
  installments: [
    { id: 'i1', installment_number: 1, total_installments: 2, amount_uf: 4, due_date: '2020-01-01', payment_status: 'PENDING', paid_at: null },
    { id: 'i2', installment_number: 2, total_installments: 2, amount_uf: 4, due_date: '2099-09-01', payment_status: 'PENDING', paid_at: null },
  ],
}

const DETAIL_P2: InsurancePolicy = {
  ...DETAIL_P1, id: 'p2', insurance_company: 'HDI', policy_number: '89632',
  installments: [
    { id: 'i3', installment_number: 1, total_installments: 1, amount_uf: 2.5, due_date: '2026-05-01', payment_status: 'PAID', paid_at: '2026-05-01' },
  ],
}

const COVERAGE_TYPES: CoverageType[] = [
  { id: 'cov1', code: 'RC', name: 'RC vehicular', description: null },
  { id: 'cov2', code: 'CARGA', name: 'Seguro de carga', description: null },
]
const ASSETS: CarrierAssetRosterItem[] = [
  { id: 'a1', license_plate: 'ABCD12', asset_type: 'TRACTOCAMION', operational_status: 'ACTIVE', total_requirements: 6, last_document_update: null },
]

function renderModal(carrierId: string | null, opts: { canAdmin?: boolean; canEdit?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={client}>
      <InsurancePolicyModal carrierId={carrierId} displayName="Transportes Vencido" onClose={vi.fn()} canAdmin={opts.canAdmin ?? true} canEdit={opts.canEdit ?? true} />
    </QueryClientProvider>,
  )
  return {
    ...utils,
    rerenderWithCarrier: (nextId: string | null) => utils.rerender(
      <QueryClientProvider client={client}>
        <InsurancePolicyModal carrierId={nextId} displayName="Otra Transportista" onClose={vi.fn()} canAdmin={opts.canAdmin ?? true} canEdit={opts.canEdit ?? true} />
      </QueryClientProvider>,
    ),
  }
}

beforeEach(() => {
  vi.mocked(carriersApi.listPolicies).mockReset().mockImplementation(async (id: string) => id === 'c1' ? LIST : [])
  vi.mocked(carriersApi.listAssets).mockReset().mockResolvedValue(ASSETS)
  vi.mocked(policiesApi.get).mockReset().mockImplementation(async (id: string) => id === 'p1' ? DETAIL_P1 : DETAIL_P2)
  vi.mocked(policiesApi.patch).mockReset()
  vi.mocked(policiesApi.linkCoverage).mockReset().mockResolvedValue({ ok: true })
  vi.mocked(policiesApi.unlinkCoverage).mockReset().mockResolvedValue({ ok: true })
  vi.mocked(policiesApi.linkAsset).mockReset().mockResolvedValue({ ok: true })
  vi.mocked(policiesApi.unlinkAsset).mockReset().mockResolvedValue({ ok: true })
  vi.mocked(coverageTypesApi.list).mockReset().mockResolvedValue(COVERAGE_TYPES)
})

describe('InsurancePolicyModal', () => {
  it('renders no dialog content when carrierId is null', () => {
    renderModal(null)
    expect(screen.queryByText('Chubb Generales')).not.toBeInTheDocument()
  })

  it('shows a policy switcher when the company has more than one policy', async () => {
    renderModal('c1')
    expect(await screen.findByText('Chubb Generales')).toBeInTheDocument()
    expect(screen.getByText('Pólizas (2)')).toBeInTheDocument()
    expect(screen.getByText('HDI')).toBeInTheDocument()
  })

  it('spotlights the oldest overdue installment as "próxima cuota"', async () => {
    renderModal('c1')
    await screen.findByText('Póliza 5663040')
    expect(screen.getByText('Próxima cuota')).toBeInTheDocument()
    expect(screen.getByText(/Cuota 1 de 2/)).toBeInTheDocument()
  })

  it('switches the selected policy when clicking another one in the list', async () => {
    renderModal('c1')
    await screen.findByText('Chubb Generales')
    await act(async () => { fireEvent.click(screen.getByText('HDI')) })
    await waitFor(() => expect(screen.getByText('Póliza 89632')).toBeInTheDocument())
    expect(screen.queryByText('Próxima cuota')).not.toBeInTheDocument()
  })

  it('expands the full installment list when "Ver todas las cuotas" is clicked', async () => {
    renderModal('c1')
    await screen.findByText('Chubb Generales')
    await act(async () => {})
    await act(async () => { fireEvent.click(screen.getByText(/Ver todas las cuotas \(2\)/)) })
    await waitFor(() => expect(screen.getByText(/Cuota 2 de 2/)).toBeInTheDocument())
  })

  it('shows linked coverages and lets an editor add one from the available list', async () => {
    renderModal('c1')
    await screen.findByText('Póliza 5663040')
    expect(screen.getByText('RC vehicular')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Agregar cobertura'), { target: { value: 'cov2' } })
    await waitFor(() => expect(policiesApi.linkCoverage).toHaveBeenCalledWith('p1', 'cov2'))
  })

  it('removes a linked coverage when its X is clicked', async () => {
    renderModal('c1')
    await screen.findByText('Póliza 5663040')
    fireEvent.click(screen.getByLabelText('Quitar cobertura RC vehicular'))
    await waitFor(() => expect(policiesApi.unlinkCoverage).toHaveBeenCalledWith('p1', 'cov1'))
  })

  it('lets an editor link an available asset', async () => {
    renderModal('c1')
    await screen.findByText('Póliza 5663040')
    fireEvent.change(screen.getByLabelText('Agregar activo cubierto'), { target: { value: 'a1' } })
    await waitFor(() => expect(policiesApi.linkAsset).toHaveBeenCalledWith('p1', 'a1'))
  })

  it('saves the external portal link and reflects it immediately', async () => {
    vi.mocked(policiesApi.patch).mockResolvedValue({ ...DETAIL_P1, external_portal_url: 'https://portal.example.com/p1' })
    renderModal('c1')
    await screen.findByText('Póliza 5663040')

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Editar enlace de Portal' })) })
    const input = screen.getByLabelText('Enlace de Portal')
    fireEvent.change(input, { target: { value: 'https://portal.example.com/p1' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Guardar enlace de Portal' })) })

    expect(policiesApi.patch).toHaveBeenCalledWith('p1', { external_portal_url: 'https://portal.example.com/p1' })
    expect(await screen.findByRole('link', { name: 'https://portal.example.com/p1' })).toBeInTheDocument()
  })

  it('does not poison the link draft after Cancelar', async () => {
    renderModal('c1')
    await screen.findByText('Póliza 5663040')

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Editar enlace de Portal' })) })
    const input = screen.getByLabelText('Enlace de Portal')
    expect(input).toHaveValue('')
    fireEvent.change(input, { target: { value: 'https://tentativo.example.com/no' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar edición de Portal' }))

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Editar enlace de Portal' })) })
    expect(screen.getByLabelText('Enlace de Portal')).toHaveValue('')
    expect(policiesApi.patch).not.toHaveBeenCalled()
  })
})
