import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NewCarrierPanel } from './NewCarrierPanel'
import { carriersApi } from '@/lib/api/carriers'

vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { create: vi.fn() },
}))

beforeEach(() => {
  vi.mocked(carriersApi.create).mockReset()
})

describe('NewCarrierPanel', () => {
  it('renders nothing when open=false', () => {
    render(<NewCarrierPanel open={false} onClose={vi.fn()} onCreated={vi.fn()} />)
    expect(screen.queryByText('Nueva empresa')).not.toBeInTheDocument()
  })

  it('pre-fills business_name from initialBusinessName', () => {
    render(<NewCarrierPanel open initialBusinessName="Agrocapilla Ltda" onClose={vi.fn()} onCreated={vi.fn()} />)
    expect(screen.getByLabelText('Razón social')).toHaveValue('Agrocapilla Ltda')
  })

  it('disables the create button until business_name is filled, tax_id is not required', () => {
    render(<NewCarrierPanel open onClose={vi.fn()} onCreated={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Crear empresa/ })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Tax ID'), { target: { value: '76217085-K' } })
    expect(screen.getByRole('button', { name: /Crear empresa/ })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Razón social'), { target: { value: 'Nueva Spa' } })
    expect(screen.getByRole('button', { name: /Crear empresa/ })).toBeEnabled()
  })

  it('enables the create button with only business_name filled (no tax_id)', () => {
    render(<NewCarrierPanel open onClose={vi.fn()} onCreated={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Razón social'), { target: { value: 'Nueva Spa' } })
    expect(screen.getByRole('button', { name: /Crear empresa/ })).toBeEnabled()
  })

  it('shows the Onboarding hint when tax_id is empty', () => {
    render(<NewCarrierPanel open onClose={vi.fn()} onCreated={vi.fn()} />)
    expect(screen.getByText('Se creará en estado Onboarding, pendiente de RUT.')).toBeInTheDocument()
  })

  it('hides the Onboarding hint once tax_id has content', () => {
    render(<NewCarrierPanel open onClose={vi.fn()} onCreated={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Tax ID'), { target: { value: '76217085-K' } })
    expect(screen.queryByText('Se creará en estado Onboarding, pendiente de RUT.')).not.toBeInTheDocument()
  })

  it('creates the carrier and calls onCreated with the result', async () => {
    const created = { id: 'c9', tax_id: '76217085-K', country_code: 'CL', business_name: 'Nueva Spa', operational_status: 'ACTIVE' as const, created_at: null }
    vi.mocked(carriersApi.create).mockResolvedValue(created)
    const onCreated = vi.fn()
    render(<NewCarrierPanel open onClose={vi.fn()} onCreated={onCreated} />)
    fireEvent.change(screen.getByLabelText('Tax ID'), { target: { value: '76217085-K' } })
    fireEvent.change(screen.getByLabelText('Razón social'), { target: { value: 'Nueva Spa' } })
    fireEvent.click(screen.getByRole('button', { name: /Crear empresa/ }))
    await waitFor(() => expect(carriersApi.create).toHaveBeenCalledWith({ tax_id: '76217085-K', business_name: 'Nueva Spa' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created))
  })

  it('creates the carrier without tax_id in the body when the field is empty (ONBOARDING)', async () => {
    const created = { id: 'c10', tax_id: '', country_code: 'CL', business_name: 'Onboarding Spa', operational_status: 'ONBOARDING' as const, created_at: null }
    vi.mocked(carriersApi.create).mockResolvedValue(created)
    const onCreated = vi.fn()
    render(<NewCarrierPanel open onClose={vi.fn()} onCreated={onCreated} />)
    fireEvent.change(screen.getByLabelText('Razón social'), { target: { value: 'Onboarding Spa' } })
    fireEvent.click(screen.getByRole('button', { name: /Crear empresa/ }))
    await waitFor(() => expect(carriersApi.create).toHaveBeenCalledWith({ business_name: 'Onboarding Spa' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created))
  })

  it('shows an inline error when creation fails, without calling onCreated', async () => {
    vi.mocked(carriersApi.create).mockRejectedValue(new Error('Tax ID duplicado'))
    const onCreated = vi.fn()
    render(<NewCarrierPanel open onClose={vi.fn()} onCreated={onCreated} />)
    fireEvent.change(screen.getByLabelText('Tax ID'), { target: { value: '76217085-K' } })
    fireEvent.change(screen.getByLabelText('Razón social'), { target: { value: 'Nueva Spa' } })
    fireEvent.click(screen.getByRole('button', { name: /Crear empresa/ }))
    expect(await screen.findByText('Tax ID duplicado')).toBeInTheDocument()
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('calls onClose when Cancelar is clicked', () => {
    const onClose = vi.fn()
    render(<NewCarrierPanel open onClose={onClose} onCreated={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Cancelar'))
    expect(onClose).toHaveBeenCalled()
  })
})
