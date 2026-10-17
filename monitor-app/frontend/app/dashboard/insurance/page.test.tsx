import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CarrierInsuranceRow } from '@/lib/api/insurance'
import { memoryUrl } from '@/lib/testing/inMemoryNavigation'

vi.mock('next/navigation', async () => (await import('@/lib/testing/inMemoryNavigation')).nextNavigation)
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: () => true }))
vi.mock('@/components/ui/tabla/data/useTablePreferences', () => ({
  useTablePreferences: () => ({ columns: null, save: vi.fn(), reset: vi.fn() }),
}))
const carrierOverview = vi.fn()
const carrier = vi.fn()
vi.mock('@/lib/api/insurance', async orig => ({
  ...(await orig<object>()), insuranceApi: { carrierOverview: () => carrierOverview(), carrier: (id: string) => carrier(id) },
}))

import EmpresasPage from './page'
import InsuranceLayout from './layout'

const fila = (id: string, name: string, p: Partial<CarrierInsuranceRow>): CarrierInsuranceRow => ({
  carrier_id: id, carrier_name: name, carrier_tax_id: `76.${id}`, operational_status: 'ACTIVE', policies: 1,
  worst_state: 'VALID', insurance_verdict: 'UP_TO_DATE', insurance_alert: null, severe_overdue: false,
  unpaid_installments: 0, overdue_installments: 0, unpaid_uf: null, oldest_overdue_date: null, next_due_date: null,
  reason_insurer: null, reason_valid_to: null, ...p,
})
const FILAS = [
  fila('1', 'Fletes Maipo Ltda', { insurance_verdict: 'EXPIRED', reason_insurer: 'HDI', reason_valid_to: '2026-09-23' }),
  fila('2', 'Transportes Sur SpA', { insurance_verdict: 'NO_POLICY', policies: 0 }),
  fila('3', 'Transportes Andes Ltda', { insurance_verdict: 'OVERDUE', overdue_installments: 3, severe_overdue: true }),
  fila('4', 'Logistica Pacifico SpA', { insurance_verdict: 'EXPIRING', reason_insurer: 'Mapfre', reason_valid_to: '2026-11-02' }),
  fila('5', 'Transportes Cordillera SpA', { insurance_verdict: 'UP_TO_DATE' }),
]
const FACETS = { EXPIRED: 1, NO_POLICY: 1, OVERDUE: 1, NO_DATES: 0, EXPIRING: 1, UP_TO_DATE: 1, total: 5 }

function montar() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <InsuranceLayout><EmpresasPage /></InsuranceLayout>
    </QueryClientProvider>,
  )
}
const tabla = () => screen.getByRole('table', { name: 'Seguros por empresa' })
const empresas = () => within(tabla()).getAllByRole('row').slice(1).map(r => within(r).getAllByRole('cell')[0].textContent)

beforeEach(() => {
  memoryUrl.reset('/dashboard/insurance')
  carrierOverview.mockResolvedValue({ data: FILAS, facets: FACETS })
  carrier.mockResolvedValue({ summary: FILAS[0], policies: [] })
})

describe('Seguros › Empresas', () => {
  it('abre en "No al día": solo esas, por gravedad, con su veredicto y su razón (E4)', async () => {
    montar()
    await screen.findByRole('table', { name: 'Seguros por empresa' })
    expect(empresas().map(t => t?.split('76.')[0])).toEqual(['Fletes Maipo Ltda', 'Transportes Sur SpA', 'Transportes Andes Ltda'])
    const fletes = within(tabla()).getAllByRole('row')[1]
    expect(within(fletes).getByText('Póliza vencida')).toBeInTheDocument()
    expect(within(fletes).getByText('HDI venció el 23/09')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^No al día, 3/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('los recuadros cuentan No al día, Por vencer y Al día; tocar "Al día" deja solo esas (E4)', async () => {
    montar()
    await screen.findByRole('table', { name: 'Seguros por empresa' })
    expect(screen.getByRole('button', { name: /^Por vencer, 1/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Al día, 1/ }))
    expect(empresas().map(t => t?.split('76.')[0])).toEqual(['Transportes Cordillera SpA'])
  })

  it('sin empresas "No al día", lo dice en vez de una tabla vacía', async () => {
    carrierOverview.mockResolvedValue({ data: [FILAS[4]], facets: { ...FACETS, EXPIRED: 0, NO_POLICY: 0, OVERDUE: 0, total: 1 } })
    montar()
    expect(await screen.findByText('Todas las empresas están al día')).toBeInTheDocument()
  })

  it('un enlace con ?q=RUT abre con esa búsqueda, sin el filtro inicial', async () => {
    memoryUrl.reset('/dashboard/insurance?q=76.4')
    montar()
    await screen.findByRole('table', { name: 'Seguros por empresa' })
    expect(empresas().map(t => t?.split('76.')[0])).toEqual(['Logistica Pacifico SpA'])
  })

  it('el nombre de la empresa abre su panel de Seguros', async () => {
    montar()
    fireEvent.click(await screen.findByRole('link', { name: 'Ver empresa Fletes Maipo Ltda' }))
    expect(await screen.findByRole('dialog', { name: 'Fletes Maipo Ltda' })).toBeInTheDocument()
    expect(carrier).toHaveBeenCalledWith('1')
  })
})
