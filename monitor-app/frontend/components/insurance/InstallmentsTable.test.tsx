import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: () => true }))
vi.mock('@/lib/api/insurance', async orig => ({ ...(await orig<object>()), insuranceApi: { pay: vi.fn(), unpay: vi.fn(), carrier: vi.fn() } }))
vi.mock('@/lib/utils/datetime', async orig => ({ ...(await orig<object>()), hoyEnChile: () => '2026-10-15' }))

import { insuranceApi } from '@/lib/api/insurance'
import type { ReactNode } from 'react'
import { InstallmentsTable, PayInstallmentsDialog } from './InstallmentsTable'
import { CarrierInsurancePanelProvider } from './CarrierInsurancePanel'

/** Donde vive la tabla en la app: el nombre de la empresa abre el panel de Seguros. */
const Seguros = ({ client, children }: { client: QueryClient; children: ReactNode }) => (
  <QueryClientProvider client={client}><CarrierInsurancePanelProvider>{children}</CarrierInsurancePanelProvider></QueryClientProvider>
)

const cuota = (id: string, n: number, over: Record<string, unknown> = {}) => ({
  id, policy_id: 'p1', carrier_id: 'c1', carrier_name: 'Aguilera', insurance_company: 'SURA', policy_number: '1',
  installment_number: n, installments_total: 3, due_date: '2026-09-01', due_in_days: -44, amount_uf: 2.1,
  installment_state: 'OVERDUE', paid: false, paid_on: null, paid_by: null, outside_validity: false, ...over,
})

function renderTable(rows = [cuota('i1', 1), cuota('i2', 2), cuota('i3', 3, { installment_state: 'PAID', paid: true, paid_on: '2026-09-02' })]) {
  return render(
    <Seguros client={new QueryClient()}>
      <InstallmentsTable rows={rows as never} />
    </Seguros>,
  )
}

beforeEach(() => vi.mocked(insuranceApi.pay).mockReset())

describe('InstallmentsTable', () => {
  it('el pago sin cuotas no se puede confirmar', () => {
    render(<PayInstallmentsDialog rows={[]} onClose={vi.fn()} onDone={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Marcar 0 pagadas' })).toBeDisabled()
  })

  it('al cambiar de filtro, lo seleccionado que ya no está a la vista no cuenta ni se paga', async () => {
    vi.mocked(insuranceApi.pay).mockResolvedValue({ paid: ['i2'], errors: [] })
    const client = new QueryClient()
    const { rerender } = render(<Seguros client={client}><InstallmentsTable rows={[cuota('i1', 1), cuota('i2', 2)] as never} /></Seguros>)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar cuota 1' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar cuota 2' }))
    rerender(<Seguros client={client}><InstallmentsTable rows={[cuota('i2', 2), cuota('i4', 4)] as never} /></Seguros>)
    expect(screen.getByText(/^1 seleccionad/)).toBeInTheDocument()
    rerender(<Seguros client={client}><InstallmentsTable rows={[cuota('i4', 4)] as never} /></Seguros>)
    expect(screen.getByText('Ninguno seleccionado')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Marcar pagadas…' })).toBeNull()
  })

  it('S14: marcar varias pagadas pide la fecha (hoy por defecto) y la manda a POST /installments/pay', async () => {
    vi.mocked(insuranceApi.pay).mockResolvedValue({ paid: ['i1', 'i2'], errors: [] })
    renderTable()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar cuota 1' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar cuota 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Marcar pagadas…' }))
    const panel = await screen.findByRole('dialog')
    expect(within(panel).getByLabelText('Fecha de pago')).toHaveValue('2026-10-15')
    fireEvent.click(within(panel).getByRole('button', { name: 'Marcar 2 pagadas' }))
    await waitFor(() => expect(insuranceApi.pay).toHaveBeenCalledWith(['i1', 'i2'], '2026-10-15'))
  })

  it('S14: lo que no se pudo pagar se dice por cuota', async () => {
    vi.mocked(insuranceApi.pay).mockResolvedValue({ paid: ['i1'], errors: [{ id: 'i2', error: 'Ya estaba pagada' }] })
    renderTable()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar cuota 1' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar cuota 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Marcar pagadas…' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Marcar 2 pagadas' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Cuota 2: Ya estaba pagada')
  })

  it('una pagada no se selecciona; dice cuándo, y se puede deshacer', () => {
    renderTable()
    expect(screen.queryByRole('checkbox', { name: 'Seleccionar cuota 3' })).not.toBeInTheDocument()
    expect(screen.getByText('Pagada el 02/09')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deshacer pago de la cuota 3' })).toBeInTheDocument()
  })

  it('en Cuotas, lo que no se pudo pagar dice de qué póliza es, y no se pierde si la lista queda vacía', async () => {
    vi.mocked(insuranceApi.pay).mockResolvedValue({ paid: [], errors: [{ id: 'i1', error: 'Ya estaba pagada' }] })
    const client = new QueryClient()
    const tabla = (rows: unknown[]) => (
      <Seguros client={client}><InstallmentsTable rows={rows as never} showPolicy empty={<p>No hay cuotas vencidas</p>} /></Seguros>
    )
    const { rerender } = render(tabla([cuota('i1', 1)]))
    fireEvent.click(screen.getByRole('checkbox', { name: /Seleccionar cuota 1/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Marcar pagadas…' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Marcar 1 pagada' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Cuota 1 · SURA 1: Ya estaba pagada')
    rerender(tabla([]))
    expect(screen.getByText('No hay cuotas vencidas')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Ya estaba pagada')
  })

  it('si deshacer un pago falla, lo dice', async () => {
    vi.mocked(insuranceApi.unpay).mockRejectedValue(new Error('Sin conexión'))
    renderTable()
    fireEvent.click(screen.getByRole('button', { name: /Deshacer pago/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Sin conexión')
  })

  it('mientras la lista se actualiza, "Marcar pagadas…" espera', () => {
    render(<Seguros client={new QueryClient()}><InstallmentsTable rows={[cuota('i1', 1)] as never} busy /></Seguros>)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar cuota 1' }))
    expect(screen.getByRole('button', { name: 'Marcar pagadas…' })).toBeDisabled()
  })

  it('los chips de estado van en una línea: la fila no mide el doble con "Fuera de vigencia"', () => {
    renderTable([cuota('i1', 1, { outside_validity: true })])
    const celda = screen.getByText('Fuera de vigencia').closest('span.flex') as HTMLElement
    expect(celda).not.toHaveClass('flex-wrap')
    expect(screen.getByRole('columnheader', { name: 'Estado' })).not.toHaveClass('w-64')
  })
})
