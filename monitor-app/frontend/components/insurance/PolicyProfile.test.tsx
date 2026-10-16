import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: () => true }))
vi.mock('@/lib/api/insurance', () => ({
  insuranceApi: { get: vi.fn(), renewalCandidates: vi.fn(), renewedBy: vi.fn(), pay: vi.fn(), unpay: vi.fn() },
}))
vi.mock('@/lib/api/policies', () => ({
  policiesApi: { patch: vi.fn(), uploadFile: vi.fn(), deleteFile: vi.fn(), linkCoverage: vi.fn(), unlinkCoverage: vi.fn(), linkAsset: vi.fn(), unlinkAsset: vi.fn() },
  coverageTypesApi: { list: vi.fn().mockResolvedValue([]) },
}))
vi.mock('@/lib/api/carriers', () => ({ carriersApi: { listAssets: vi.fn().mockResolvedValue([]) } }))

import { insuranceApi } from '@/lib/api/insurance'
import { QuickViewContext } from '@/components/dashboard/QuickViewProvider'
import { PolicyProfile } from './PolicyProfile'

const DETALLE = {
  id: 'p1', carrier_id: 'c1', carrier_name: 'Transportes Aguilera Spa', insurance_company: 'SURA', policy_number: '8581440-RC',
  valid_from: '2025-05-22', valid_to: '2026-05-22', policy_document_url: null, has_endorsement: false, endorsement_number: null,
  endorsement_document_url: null, external_portal_url: null, cancelled_at: null, cancelled_reason: null, updated_at: null,
  policy_state: 'EXPIRED', expires_in_days: -146, renews_policy_id: null, renewed_by_policy_id: null,
  coverages: [{ coverage_type_id: 'ct', code: 'OTROS', name: 'Otros / Por Asignar' }],
  assets: [{ asset_id: 'a1', license_plate: 'LXDY42', asset_type: 'TRACTOCAMION' }],
  installments: [], term_changes: [],
}

function renderProfile() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <QuickViewContext.Provider value={vi.fn()}><PolicyProfile id="p1" /></QuickViewContext.Provider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(insuranceApi.get).mockResolvedValue(DETALLE as never)
  vi.mocked(insuranceApi.renewalCandidates).mockResolvedValue([])
  vi.mocked(insuranceApi.renewedBy).mockReset().mockResolvedValue(DETALLE as never)
})

describe('Ficha de póliza', () => {
  it('S9: Cuotas y Documentos al centro; Detalles, Coberturas y Equipos cubiertos al costado', async () => {
    renderProfile()
    expect(await screen.findByRole('heading', { level: 1, name: /SURA · 8581440-RC/ })).toBeInTheDocument()
    expect(screen.getByText('Venció el 22/05')).toBeInTheDocument()
    const aside = screen.getByRole('complementary')
    expect(within(aside).getAllByRole('heading', { level: 2 }).map(h => h.textContent))
      .toEqual(['Detalles', 'Coberturas', 'Equipos cubiertos'])
    expect(screen.getByRole('region', { name: 'Cuotas' })).not.toContainElement(aside)
    expect(screen.getByRole('region', { name: 'Documentos' })).toBeInTheDocument()
  })

  it('el ⋯ ofrece renovar, extender vigencia y cancelar', async () => {
    renderProfile()
    fireEvent.click(await screen.findByRole('button', { name: 'Más acciones' }))
    expect(screen.getAllByRole('menuitem').map(m => m.textContent)).toEqual(
      expect.arrayContaining(['Renovar', 'Extender vigencia', 'Cancelar póliza']))
  })

  it('S19: con una candidata propone el enlace y no enlaza nada hasta confirmar', async () => {
    vi.mocked(insuranceApi.renewalCandidates).mockResolvedValue([
      { id: 'p9', insurance_company: 'Chubb Generales', policy_number: '77', valid_from: '2026-05-22', valid_to: '2027-05-22' },
    ])
    renderProfile()
    const aviso = await screen.findByText(/¿La reemplazó Chubb Generales · 77/)
    expect(insuranceApi.renewedBy).not.toHaveBeenCalled()
    fireEvent.click(within(aviso.closest('[role="status"]') as HTMLElement).getByRole('button', { name: 'Sí, enlazar' }))
    await waitFor(() => expect(insuranceApi.renewedBy).toHaveBeenCalledWith('p1', 'p9'))
  })
})
