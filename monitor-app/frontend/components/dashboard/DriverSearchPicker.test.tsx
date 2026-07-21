import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DriverSearchPicker } from './DriverSearchPicker'
import { driversApi } from '@/lib/api/drivers'
import type { DriverPickCandidate } from '@/lib/types'

vi.mock('@/lib/api/drivers', () => ({
  driversApi: { search: vi.fn() },
}))

const SUGGESTED: DriverPickCandidate = {
  driver_id: 's1', driver_name: 'Pedro Soto', driver_rut: '11111111-1', driver_phone: null,
  carrier_id: 'c1', carrier_name: 'TransCargo', tractor_asset_id: 'a1', tractor_plate: 'ZZZZ11',
}
const FOUND: DriverPickCandidate = {
  driver_id: 'd1', driver_name: 'Juan Pérez', driver_rut: '12345678-9', driver_phone: null,
  carrier_id: 'c2', carrier_name: 'Transportes Sur', tractor_asset_id: null, tractor_plate: null,
}

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

function Controlled(props: Partial<React.ComponentProps<typeof DriverSearchPicker>> = {}) {
  const [q, setQ] = useState('')
  return (
    <Wrapper>
      <DriverSearchPicker query={q} onQueryChange={setQ} onPick={vi.fn()} {...props} />
    </Wrapper>
  )
}

beforeEach(() => {
  vi.mocked(driversApi.search).mockReset().mockResolvedValue([FOUND])
})

describe('DriverSearchPicker', () => {
  it('shows the suggested list when the query is empty', () => {
    render(<Controlled suggested={[SUGGESTED]} />)
    expect(screen.getByText('Pedro Soto')).toBeInTheDocument()
    expect(driversApi.search).not.toHaveBeenCalled()
  })

  it('searches and shows results once minChars is reached, hiding the suggested list', async () => {
    render(<Controlled suggested={[SUGGESTED]} />)
    fireEvent.change(screen.getByLabelText('Buscar conductor'), { target: { value: 'Juan' } })
    expect(await screen.findByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.queryByText('Pedro Soto')).not.toBeInTheDocument()
  })

  it('calls onPick with the full candidate when a row is clicked', async () => {
    const onPick = vi.fn()
    render(<Controlled onPick={onPick} suggested={[SUGGESTED]} />)
    fireEvent.click(screen.getByText('Pedro Soto'))
    expect(onPick).toHaveBeenCalledWith(SUGGESTED)
  })

  it('shows an empty state distinct from the suggested-list empty state when a search has no results', async () => {
    vi.mocked(driversApi.search).mockResolvedValue([])
    render(<Controlled />)
    fireEvent.change(screen.getByLabelText('Buscar conductor'), { target: { value: 'Nadie' } })
    expect(await screen.findByText('Sin resultados en el directorio de Empresas')).toBeInTheDocument()
  })

  // HU-06 (Fase 3): % de similitud en sugerencias de fuzzy match
  it('shows a similarity percentage badge when the candidate carries one', () => {
    render(<Controlled suggested={[{ ...SUGGESTED, similarity: 0.87 }]} />)
    expect(screen.getByText('87%')).toBeInTheDocument()
  })

  it('does not show a similarity badge for a plain manual-search candidate', () => {
    render(<Controlled suggested={[SUGGESTED]} />)
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument()
  })
})
