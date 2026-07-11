import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { InstallmentRow } from './InstallmentRow'
import { insuranceApi } from '@/lib/api/insurance'
import type { InsuranceInstallment } from '@/lib/types'

vi.mock('@/lib/api/insurance', () => ({
  insuranceApi: {
    patchInstallment:   vi.fn(),
    revertInstallment:  vi.fn(),
  },
}))

const PENDING: InsuranceInstallment = {
  id: 'i1', policy_id: 'p1', installment_number: 4, total_installments: 5,
  amount_uf: 4.54, due_date: '2099-01-01', status: 'pendiente', paid_at: null,
  payment_url: null, manual_override: false, updated_at: '2026-07-01T00:00:00Z',
}

const PAID: InsuranceInstallment = {
  ...PENDING, status: 'pagada', paid_at: '2026-06-01',
}

beforeEach(() => {
  vi.mocked(insuranceApi.patchInstallment).mockReset()
  vi.mocked(insuranceApi.revertInstallment).mockReset()
})

describe('InstallmentRow — pendiente', () => {
  it('shows the "Cuota N de M" label and amount', () => {
    render(<InstallmentRow installment={PENDING} canAdmin={true} onChanged={vi.fn()} />)
    expect(screen.getByText(/Cuota 4 de 5/)).toBeInTheDocument()
    expect(screen.getByText('4.54 UF')).toBeInTheDocument()
  })

  it('disables Pagar for a non-admin', () => {
    render(<InstallmentRow installment={PENDING} canAdmin={false} onChanged={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Pagar/i })).toBeDisabled()
  })

  it('calls patchInstallment and onChanged when Pagar is clicked by an admin', async () => {
    const onChanged = vi.fn()
    vi.mocked(insuranceApi.patchInstallment).mockResolvedValue(PAID)
    render(<InstallmentRow installment={PENDING} canAdmin={true} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: /Pagar/i }))
    await waitFor(() => expect(insuranceApi.patchInstallment).toHaveBeenCalledWith('i1', expect.objectContaining({ status: 'pagada' })))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(PAID))
  })

  it('shows a visible error when marking as paid fails', async () => {
    vi.mocked(insuranceApi.patchInstallment).mockRejectedValue(new Error('La cuota fue modificada por otro usuario'))
    render(<InstallmentRow installment={PENDING} canAdmin={true} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Pagar/i }))
    expect(await screen.findByText('La cuota fue modificada por otro usuario')).toBeInTheDocument()
  })

  it('does not render a revert control', () => {
    render(<InstallmentRow installment={PENDING} canAdmin={true} onChanged={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /revertir/i })).not.toBeInTheDocument()
  })
})

describe('InstallmentRow — pagada', () => {
  it('does not render a Pagar button', () => {
    render(<InstallmentRow installment={PAID} canAdmin={true} onChanged={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /^Pagar$/i })).not.toBeInTheDocument()
  })

  it('does not render a revert control for a non-admin', () => {
    render(<InstallmentRow installment={PAID} canAdmin={false} onChanged={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /revertir/i })).not.toBeInTheDocument()
  })

  it('shows a confirmation popover when revertir is clicked, and does nothing on "No"', () => {
    render(<InstallmentRow installment={PAID} canAdmin={true} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /revertir/i }))
    expect(screen.getByText('¿Revertir a pendiente?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'No' }))
    expect(screen.queryByText('¿Revertir a pendiente?')).not.toBeInTheDocument()
    expect(insuranceApi.revertInstallment).not.toHaveBeenCalled()
  })

  it('calls revertInstallment and onChanged when confirmed with "Sí"', async () => {
    const onChanged = vi.fn()
    vi.mocked(insuranceApi.revertInstallment).mockResolvedValue(PENDING)
    render(<InstallmentRow installment={PAID} canAdmin={true} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: /revertir/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Sí' }))
    await waitFor(() => expect(insuranceApi.revertInstallment).toHaveBeenCalledWith('i1', expect.objectContaining({ expected_updated_at: PAID.updated_at })))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(PENDING))
  })

  it('shows a visible error when reverting fails', async () => {
    vi.mocked(insuranceApi.revertInstallment).mockRejectedValue(new Error('Solo se puede revertir una cuota marcada como pagada'))
    render(<InstallmentRow installment={PAID} canAdmin={true} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /revertir/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Sí' }))
    expect(await screen.findByText('Solo se puede revertir una cuota marcada como pagada')).toBeInTheDocument()
  })
})
