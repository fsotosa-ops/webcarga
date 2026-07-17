import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BajaReasonModal } from './BajaReasonModal'

describe('BajaReasonModal', () => {
  it('renders the label', () => {
    render(<BajaReasonModal label="conductor Juan Pérez" onClose={vi.fn()} onConfirm={vi.fn().mockResolvedValue(undefined)} />)
    expect(screen.getByText('Dar de baja: conductor Juan Pérez')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('calls onConfirm, then onClose', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    render(<BajaReasonModal label="esta empresa" onClose={onClose} onConfirm={onConfirm} />)

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar baja' }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalled())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('shows an error message and does not close when onConfirm rejects', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('boom'))
    const onClose = vi.fn()
    render(<BajaReasonModal label="esta empresa" onClose={onClose} onConfirm={onConfirm} />)

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar baja' }))

    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onClose when the backdrop, X, or Cancelar are clicked', () => {
    const onClose = vi.fn()
    const { container } = render(<BajaReasonModal label="esta empresa" onClose={onClose} onConfirm={vi.fn().mockResolvedValue(undefined)} />)

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByLabelText('Cerrar'))
    expect(onClose).toHaveBeenCalledTimes(2)

    const backdrop = container.querySelector('.absolute.inset-0')
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop!)
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})
