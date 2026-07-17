import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { InstallmentRow } from './InstallmentRow'
import { policiesApi } from '@/lib/api/policies'
import type { InsuranceInstallment } from '@/lib/types'

vi.mock('@/lib/api/policies', () => ({
  policiesApi: { patchInstallment: vi.fn() },
}))

const PENDING: InsuranceInstallment = {
  id: 'i1', installment_number: 4, total_installments: 5,
  amount_uf: 4.54, due_date: '2099-01-01', payment_status: 'PENDING', paid_at: null,
}

const PAID: InsuranceInstallment = {
  ...PENDING, payment_status: 'PAID', paid_at: '2026-06-01',
}

beforeEach(() => {
  vi.mocked(policiesApi.patchInstallment).mockReset()
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
    vi.mocked(policiesApi.patchInstallment).mockResolvedValue(PAID)
    render(<InstallmentRow installment={PENDING} canAdmin={true} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: /Pagar/i }))
    await waitFor(() => expect(policiesApi.patchInstallment).toHaveBeenCalledWith('i1', expect.objectContaining({ payment_status: 'PAID' })))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(PAID))
  })

  it('shows a visible error when marking as paid fails', async () => {
    vi.mocked(policiesApi.patchInstallment).mockRejectedValue(new Error('La cuota fue modificada por otro usuario'))
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
    expect(policiesApi.patchInstallment).not.toHaveBeenCalled()
  })

  it('calls patchInstallment with PENDING and onChanged when confirmed with "Sí"', async () => {
    const onChanged = vi.fn()
    vi.mocked(policiesApi.patchInstallment).mockResolvedValue(PENDING)
    render(<InstallmentRow installment={PAID} canAdmin={true} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: /revertir/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Sí' }))
    await waitFor(() => expect(policiesApi.patchInstallment).toHaveBeenCalledWith('i1', { payment_status: 'PENDING' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(PENDING))
  })

  it('shows a visible error when reverting fails', async () => {
    vi.mocked(policiesApi.patchInstallment).mockRejectedValue(new Error('Error al revertir'))
    render(<InstallmentRow installment={PAID} canAdmin={true} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /revertir/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Sí' }))
    expect(await screen.findByText('Error al revertir')).toBeInTheDocument()
  })
})
