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
  { id: 's5', name: 'Agrícola Vieja', status: 'INACTIVE' },
]

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

type Cliente = { id: string; name: string } | null

/** El selector entrega el cliente del directorio por id (spec 2026-10-11). */
function Harness({ value = null, onChange }: { value?: Cliente; onChange?: (c: Cliente) => void }) {
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
  it('muestra todos los clientes del directorio al enfocar el campo vacío', async () => {
    render(<Harness />)
    fireEvent.focus(screen.getByLabelText('Cliente'))
    expect(await screen.findByText('Walmart')).toBeInTheDocument()
    expect(screen.getByText('Colún')).toBeInTheDocument()
  })

  it('filtra por lo escrito y al elegir entrega el id y el nombre', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'wal' } })
    fireEvent.click(await screen.findByText('Walmart'))
    expect(onChange).toHaveBeenCalledWith({ id: 's1', name: 'Walmart' })
  })

  it('con un cliente elegido lo muestra fijo y "Cambiar" lo suelta', () => {
    const onChange = vi.fn()
    render(<Harness value={{ id: 's1', name: 'Walmart' }} onChange={onChange} />)
    expect(screen.getByText('Walmart')).toBeInTheDocument()
    expect(screen.queryByLabelText('Cliente')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar cliente' }))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('ofrece crear un cliente cuando lo escrito no existe', async () => {
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'Agrosuper' } })
    expect(await screen.findByText('Crear cliente “Agrosuper”')).toBeInTheDocument()
  })

  it('no ofrece crear si lo escrito ya existe, sin importar mayúsculas', async () => {
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'WALMART' } })
    await screen.findByText('Walmart')
    expect(screen.queryByText(/Crear cliente/)).not.toBeInTheDocument()
  })

  it('crea el cliente y lo elige con el id que devolvió el directorio', async () => {
    vi.mocked(shippersApi.create).mockResolvedValue({ id: 's3', name: 'Agrosuper', status: 'ACTIVE' } as never)
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'Agrosuper' } })
    fireEvent.click(await screen.findByText('Crear cliente “Agrosuper”'))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ id: 's3', name: 'Agrosuper' }))
    expect(shippersApi.create).toHaveBeenCalledWith({ name: 'Agrosuper' })
  })

  it('si otro lo creó justo antes (409), elige el del directorio en vez de mostrar error', async () => {
    vi.mocked(shippersApi.create).mockRejectedValue(new ApiError('Ya existe', 409, {}))
    vi.mocked(shippersApi.list)
      .mockResolvedValueOnce(SHIPPERS as never)
      .mockResolvedValue([...SHIPPERS, { id: 's4', name: 'Agrosuper', status: 'ACTIVE' }] as never)
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'agrosuper' } })
    fireEvent.click(await screen.findByText('Crear cliente “agrosuper”'))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ id: 's4', name: 'Agrosuper' }))
    expect(screen.queryByText('Ya existe')).not.toBeInTheDocument()
  })

  it('no ofrece clientes inactivos, y si lo escrito es uno, lo dice en vez de ofrecer crearlo', async () => {
    render(<Harness />)
    fireEvent.focus(screen.getByLabelText('Cliente'))
    await screen.findByText('Walmart')
    expect(screen.queryByText('Agrícola Vieja')).toBeNull()
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'agrícola vieja' } })
    expect(await screen.findByText('«Agrícola Vieja» está inactivo en el directorio')).toBeInTheDocument()
    expect(screen.queryByText(/Crear cliente/)).toBeNull()
  })

  it('crear un cliente refresca Directorio › Clientes', async () => {
    vi.mocked(shippersApi.create).mockResolvedValue({ id: 's3', name: 'Agrosuper', status: 'ACTIVE' } as never)
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalida = vi.spyOn(qc, 'invalidateQueries')
    render(<QueryClientProvider client={qc}><ClientPicker value={null} onChange={vi.fn()} /></QueryClientProvider>)
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'Agrosuper' } })
    fireEvent.click(await screen.findByText('Crear cliente “Agrosuper”'))
    await waitFor(() => expect(invalida).toHaveBeenCalledWith({ queryKey: ['clients'] }))
  })
})
