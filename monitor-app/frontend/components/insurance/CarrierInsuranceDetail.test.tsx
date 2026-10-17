import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CarrierInsuranceDetail as Detail, CarrierInsuranceRow } from '@/lib/api/insurance'

const carrier = vi.fn()
const push = vi.fn()
const nav = vi.hoisted(() => ({ ruta: '/dashboard/insurance' }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => nav.ruta }))
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: () => true }))
vi.mock('@/lib/api/insurance', async orig => ({ ...(await orig<object>()), insuranceApi: { carrier: (id: string) => carrier(id) } }))

import { CarrierInsuranceDetail } from './CarrierInsuranceDetail'
import { CarrierInsurancePanelProvider, useOpenCarrierInsurance } from './CarrierInsurancePanel'

const SUMMARY: CarrierInsuranceRow = {
  carrier_id: 'c1', carrier_name: 'Fletes Maipo Ltda', carrier_tax_id: '76.777.777-9', operational_status: 'ACTIVE',
  policies: 1, worst_state: 'EXPIRED', insurance_verdict: 'EXPIRED', insurance_alert: 'EXPIRED', severe_overdue: true,
  unpaid_installments: 3, overdue_installments: 2, unpaid_uf: 8.4, oldest_overdue_date: '2026-09-05',
  next_due_date: '2026-09-05', reason_insurer: 'HDI', reason_valid_to: '2026-09-23',
}
const cuota = (n: number, state: 'PAID' | 'OVERDUE' | 'PENDING', due: string) => ({
  id: `i${n}`, policy_id: 'p1', carrier_id: 'c1', carrier_name: 'Fletes Maipo Ltda', insurance_company: 'HDI',
  policy_number: '2024-118', installment_number: n, installments_total: 12, due_date: due, due_in_days: 0, amount_uf: 2.8,
  installment_state: state, paid: state === 'PAID', paid_on: state === 'PAID' ? due : null, paid_by: null, outside_validity: false,
})
const DETAIL: Detail = {
  summary: SUMMARY,
  policies: [{
    id: 'p1', carrier_id: 'c1', carrier_name: 'Fletes Maipo Ltda', carrier_tax_id: '76.777.777-9', insurance_company: 'HDI',
    policy_number: '2024-118', valid_from: '2025-09-23', valid_to: '2026-09-23', has_file: true, policy_state: 'EXPIRED',
    expires_in_days: -24, installments_total: 12, paid_installments: 8, unpaid_installments: 3, overdue_installments: 2,
    next_due_date: '2026-09-05', has_outside_validity: false,
    installments: [cuota(8, 'PAID', '2026-08-05'), cuota(9, 'OVERDUE', '2026-09-05'), cuota(10, 'OVERDUE', '2026-10-05'), cuota(11, 'PENDING', '2026-11-05')],
  }],
}

describe('CarrierInsuranceDetail (E6)', () => {
  it('una tarjeta por póliza con sus cuotas impagas, cuántas pagadas y el enlace a la póliza', () => {
    render(<CarrierInsuranceDetail detail={DETAIL} canEdit={false} />)
    const tarjeta = screen.getByRole('article', { name: 'HDI · Póliza 2024-118' })
    expect(within(tarjeta).getAllByRole('listitem').map(li => li.textContent)).toEqual([
      expect.stringContaining('Cuota 9 de 12'), expect.stringContaining('Cuota 10 de 12'), expect.stringContaining('Cuota 11 de 12'),
    ])
    expect(within(tarjeta).getByText('1 pagada')).toBeInTheDocument()
    expect(within(tarjeta).getByRole('link', { name: 'Abrir la póliza' })).toHaveAttribute('href', expect.stringContaining('/p1'))
  })

  it('sin pólizas lo dice, y ofrece registrar una solo a quien puede', () => {
    const vacio = { ...DETAIL, policies: [] }
    const { rerender } = render(<CarrierInsuranceDetail detail={vacio} canEdit={false} onAddPolicy={() => {}} />)
    expect(screen.getByText('Sin pólizas registradas')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Registrar póliza' })).toBeNull()
    rerender(<CarrierInsuranceDetail detail={vacio} canEdit onAddPolicy={() => {}} />)
    expect(screen.getByRole('button', { name: 'Registrar póliza' })).toBeInTheDocument()
  })
})

function Abrir() {
  const open = useOpenCarrierInsurance()
  return <button onClick={() => open({ id: 'c1', label: 'Fletes Maipo Ltda' })}>Abrir</button>
}

describe('CarrierInsurancePanel', () => {
  it('abre con el nombre, el RUT y el veredicto, y se cierra con Escape', async () => {
    carrier.mockResolvedValue(DETAIL)
    render(<QueryClientProvider client={new QueryClient()}><CarrierInsurancePanelProvider><Abrir /></CarrierInsurancePanelProvider></QueryClientProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    const panel = screen.getByRole('dialog', { name: 'Fletes Maipo Ltda' })
    expect(await within(panel).findByText('Póliza vencida')).toBeInTheDocument()
    expect(within(panel).getByText('76.777.777-9')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Fletes Maipo Ltda' })).toBeNull()
  })
})

describe('CarrierInsurancePanel: registrar', () => {
  it('"Registrar póliza" lleva a la pestaña Seguros de la ficha, donde vive el formulario', async () => {
    carrier.mockResolvedValue({ ...DETAIL, policies: [] })
    render(<QueryClientProvider client={new QueryClient()}><CarrierInsurancePanelProvider><Abrir /></CarrierInsurancePanelProvider></QueryClientProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar póliza' }))
    expect(push).toHaveBeenCalledWith('/dashboard/carriers/c1?tab=seguros')
  })
})

describe('CarrierInsurancePanel: al cambiar de pantalla', () => {
  const montar = () => (
    <QueryClientProvider client={new QueryClient()}><CarrierInsurancePanelProvider><Abrir /></CarrierInsurancePanelProvider></QueryClientProvider>
  )

  it('se cierra (el proveedor vive en el layout de Seguros y no se desmonta entre rutas)', async () => {
    carrier.mockResolvedValue(DETAIL)
    nav.ruta = '/dashboard/insurance'
    const { rerender } = render(montar())
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    await screen.findByRole('dialog', { name: 'Fletes Maipo Ltda' })
    nav.ruta = '/dashboard/insurance/policies/p1'
    rerender(montar())
    expect(screen.queryByRole('dialog', { name: 'Fletes Maipo Ltda' })).toBeNull()
  })

  it('"Abrir la póliza" vuelve a la vista desde la que se abrió, con su filtro', async () => {
    carrier.mockResolvedValue(DETAIL)
    nav.ruta = '/dashboard/insurance'
    window.history.replaceState(null, '', '/dashboard/insurance?f.standing=Al+d%C3%ADa')
    render(montar())
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    const enlace = await screen.findByRole('link', { name: 'Abrir la póliza' })
    expect(enlace.getAttribute('href')).toBe(`/dashboard/insurance/policies/p1?next=${encodeURIComponent('/dashboard/insurance?f.standing=Al+d%C3%ADa')}`)
    window.history.replaceState(null, '', '/')
  })
})
