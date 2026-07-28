import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouteEditor } from './RouteEditor'
import { locationsApi } from '@/lib/api/locations'
import type { TripStopCreatePayload } from '@/lib/types'

vi.mock('@/lib/api/locations', () => ({
  locationsApi: { list: vi.fn() },
}))

beforeEach(() => {
  vi.mocked(locationsApi.list).mockReset().mockResolvedValue({ data: [], count: 0, page: 1, limit: 8 })
})

function Harness({
  initial = [] as TripStopCreatePayload[], onChangeSpy,
}: {
  initial?: TripStopCreatePayload[]
  onChangeSpy?: (s: TripStopCreatePayload[]) => void
}) {
  const [stops, setStops] = useState<TripStopCreatePayload[]>(initial)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <RouteEditor
        stops={stops}
        onChange={s => { setStops(s); onChangeSpy?.(s) }}
      />
    </QueryClientProvider>
  )
}

describe('RouteEditor', () => {
  it('starts with an empty origin field and no destinations', () => {
    render(<Harness />)
    expect(screen.getByLabelText('Origen')).toHaveValue('')
    expect(screen.queryByLabelText(/Nombre destino/)).not.toBeInTheDocument()
  })

  it('typing in Origen adds a stop_type=ORIGIN entry at the front', () => {
    const spy = vi.fn()
    render(<Harness onChangeSpy={spy} />)
    fireEvent.change(screen.getByLabelText('Origen'), { target: { value: 'CD Lo Aguirre' } })
    expect(spy).toHaveBeenCalledWith([{ local: 'CD Lo Aguirre', stop_type: 'ORIGIN' }])
  })

  it('renders an existing origin stop and lets it be edited without duplicating it', () => {
    const spy = vi.fn()
    render(<Harness initial={[{ local: 'CD Viejo', stop_type: 'ORIGIN' }]} onChangeSpy={spy} />)
    expect(screen.getByLabelText('Origen')).toHaveValue('CD Viejo')
    fireEvent.change(screen.getByLabelText('Origen'), { target: { value: 'CD Nuevo' } })
    expect(spy).toHaveBeenCalledWith([{ local: 'CD Nuevo', stop_type: 'ORIGIN' }])
  })

  it('adds a destination row with "Agregar destino"', () => {
    const spy = vi.fn()
    render(<Harness onChangeSpy={spy} />)
    fireEvent.click(screen.getByText('Agregar destino'))
    expect(spy).toHaveBeenCalledWith([{ local: '', planning_date: null, stop_type: 'DESTINATION' }])
  })

  it('edits a destination name without touching the origin entry', () => {
    const spy = vi.fn()
    render(<Harness
      initial={[
        { local: 'CD Origen', stop_type: 'ORIGIN' },
        { local: '', planning_date: null, stop_type: 'DESTINATION' },
      ]}
      onChangeSpy={spy}
    />)
    fireEvent.change(screen.getByLabelText('Nombre destino 1'), { target: { value: 'Local Maipú' } })
    expect(spy).toHaveBeenCalledWith([
      { local: 'CD Origen', stop_type: 'ORIGIN' },
      { local: 'Local Maipú', planning_date: null, stop_type: 'DESTINATION' },
    ])
  })

  it('removes a destination row via its trash button, keeping the origin', () => {
    const spy = vi.fn()
    render(<Harness
      initial={[
        { local: 'CD Origen', stop_type: 'ORIGIN' },
        { local: 'Destino A', planning_date: null, stop_type: 'DESTINATION' },
      ]}
      onChangeSpy={spy}
    />)
    fireEvent.click(screen.getByLabelText('Quitar destino 1'))
    expect(spy).toHaveBeenCalledWith([{ local: 'CD Origen', stop_type: 'ORIGIN' }])
  })

  it('sets region/city on a destination via RegionCityPicker without touching its name', () => {
    const spy = vi.fn()
    render(<Harness
      initial={[{ local: 'Destino A', planning_date: null, stop_type: 'DESTINATION' }]}
      onChangeSpy={spy}
    />)
    fireEvent.change(screen.getByLabelText('Región destino 1'), { target: { value: 'Biobío' } })
    expect(spy).toHaveBeenCalledWith([
      { local: 'Destino A', planning_date: null, stop_type: 'DESTINATION', destination_region: 'Biobío', destination_city: null },
    ])
  })
})
