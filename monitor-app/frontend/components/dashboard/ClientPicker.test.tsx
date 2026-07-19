import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ClientPicker } from './ClientPicker'
import { shippersApi } from '@/lib/api/locations'
import { ApiError } from '@/lib/api/client'

vi.mock('@/lib/api/locations', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api/locations')>()
  return { ...actual, shippersApi: { list: vi.fn(), create: vi.fn() } }
})

const SHIPPERS = [
  { id: 's1', name: 'Walmart', status: 'ACTIVE' },
  { id: 's2', name: 'Colún', status: 'ACTIVE' },
]

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

function Harness({ value = '', onChange }: { value?: string; onChange?: (n: string) => void }) {
  return (
    <Wrapper>
      <ClientPicker value={value} onChange={onChange ?? vi.fn()} />
    </Wrapper>
  )
}

beforeEach(() => {
  vi.mocked(shippersApi.list).mockReset().mockResolvedValue(SHIPPERS as never)
  vi.mocked(shippersApi.create).mockReset()
})

describe('ClientPicker', () => {
  it('shows all shippers when the field is focused and empty', async () => {
    render(<Harness />)
    fireEvent.focus(screen.getByLabelText('Cliente'))
    expect(await screen.findByText('Walmart')).toBeInTheDocument()
    expect(screen.getByText('Colún')).toBeInTheDocument()
  })

  it('filters shippers by the typed text and calls onChange when one is clicked', async () => {
    const onChange = vi.fn()
    render(<Harness value="wal" onChange={onChange} />)
    fireEvent.focus(screen.getByLabelText('Cliente'))
    fireEvent.click(await screen.findByText('Walmart'))
    expect(onChange).toHaveBeenCalledWith('Walmart')
    expect(screen.queryByText('Colún')).not.toBeInTheDocument()
  })

  it('offers to create a new shipper when no exact match exists', async () => {
    render(<Harness value="Agrosuper" />)
    fireEvent.focus(screen.getByLabelText('Cliente'))
    expect(await screen.findByText('Crear cliente “Agrosuper”')).toBeInTheDocument()
  })

  it('does not offer to create when the typed name exactly matches an existing shipper', async () => {
    render(<Harness value="Walmart" />)
    fireEvent.focus(screen.getByLabelText('Cliente'))
    await screen.findByText('Walmart')
    expect(screen.queryByText(/Crear cliente/)).not.toBeInTheDocument()
  })

  it('creates the shipper and selects it on click', async () => {
    vi.mocked(shippersApi.create).mockResolvedValue({ id: 's3', name: 'Agrosuper', status: 'ACTIVE' } as never)
    const onChange = vi.fn()
    render(<Harness value="Agrosuper" onChange={onChange} />)
    fireEvent.focus(screen.getByLabelText('Cliente'))
    fireEvent.click(await screen.findByText('Crear cliente “Agrosuper”'))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('Agrosuper'))
    expect(shippersApi.create).toHaveBeenCalledWith({ name: 'Agrosuper' })
  })

  it('on a 409 duplicate race, selects the name anyway instead of showing an error', async () => {
    vi.mocked(shippersApi.create).mockRejectedValue(new ApiError('Ya existe', 409, {}))
    const onChange = vi.fn()
    render(<Harness value="Agrosuper" onChange={onChange} />)
    fireEvent.focus(screen.getByLabelText('Cliente'))
    fireEvent.click(await screen.findByText('Crear cliente “Agrosuper”'))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('Agrosuper'))
    expect(screen.queryByText('Ya existe')).not.toBeInTheDocument()
  })
})
