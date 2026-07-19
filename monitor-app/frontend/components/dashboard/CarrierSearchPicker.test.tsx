import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CarrierSearchPicker } from './CarrierSearchPicker'
import { carriersApi } from '@/lib/api/carriers'

vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { list: vi.fn() },
}))

const CARRIERS = [
  { id: 'c1', business_name: 'Transportes Sur Spa', tax_id: '76111222-3' },
  { id: 'c2', business_name: 'Transportes Norte Ltda', tax_id: '76333444-5' },
]

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

function Controlled(props: Partial<React.ComponentProps<typeof CarrierSearchPicker>> = {}) {
  return (
    <Wrapper>
      <CarrierSearchPickerHarness {...props} />
    </Wrapper>
  )
}

function CarrierSearchPickerHarness(props: Partial<React.ComponentProps<typeof CarrierSearchPicker>>) {
  const [q, setQ] = useState('')
  return (
    <CarrierSearchPicker
      query={q}
      onQueryChange={setQ}
      onPick={vi.fn()}
      {...props}
    />
  )
}

beforeEach(() => {
  vi.mocked(carriersApi.list).mockReset().mockResolvedValue({ data: CARRIERS, count: 2, page: 1, limit: 10 } as never)
})

describe('CarrierSearchPicker', () => {
  it('does not query until minChars is reached', () => {
    render(<Controlled />)
    fireEvent.change(screen.getByLabelText('Buscar empresa transportista'), { target: { value: 'T' } })
    expect(carriersApi.list).not.toHaveBeenCalled()
  })

  it('shows results once minChars is reached and calls onPick when a row is clicked', async () => {
    const onPick = vi.fn()
    render(<Controlled onPick={onPick} />)
    fireEvent.change(screen.getByLabelText('Buscar empresa transportista'), { target: { value: 'Transportes' } })
    fireEvent.click(await screen.findByText('Transportes Sur Spa'))
    expect(onPick).toHaveBeenCalledWith({ id: 'c1', business_name: 'Transportes Sur Spa', tax_id: '76111222-3' })
  })

  it('excludes the row matching excludeId from results', async () => {
    render(<Controlled excludeId="c1" />)
    fireEvent.change(screen.getByLabelText('Buscar empresa transportista'), { target: { value: 'Transportes' } })
    await screen.findByText('Transportes Norte Ltda')
    expect(screen.queryByText('Transportes Sur Spa')).not.toBeInTheDocument()
  })

  it('shows a spinner on the picked row and an error message when onPick rejects', async () => {
    const onPick = vi.fn().mockRejectedValue(new Error('fallo de red'))
    render(<Controlled onPick={onPick} />)
    fireEvent.change(screen.getByLabelText('Buscar empresa transportista'), { target: { value: 'Transportes' } })
    fireEvent.click(await screen.findByText('Transportes Sur Spa'))
    expect(await screen.findByText('fallo de red')).toBeInTheDocument()
  })

  it('shows the min-chars hint when showMinCharsHint is set, instead of hiding the list', () => {
    render(<Controlled showMinCharsHint minChars={2} />)
    expect(screen.getByText('Escribe al menos 2 caracteres…')).toBeInTheDocument()
  })

  it('does not render a results container below minChars when showMinCharsHint is false', () => {
    render(<Controlled />)
    expect(screen.queryByText(/Escribe al menos/)).not.toBeInTheDocument()
    expect(screen.queryByText('Sin resultados')).not.toBeInTheDocument()
  })

  it('highlights the row matching selectedId', async () => {
    render(<Controlled selectedId="c2" />)
    fireEvent.change(screen.getByLabelText('Buscar empresa transportista'), { target: { value: 'Transportes' } })
    const row = (await screen.findByText('Transportes Norte Ltda')).closest('button')!
    expect(row.className).toContain('bg-accent/10')
  })
})
