import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FilterPopover } from './FilterPopover'
import { useDiarioFilters } from '@/hooks/useDiarioFilters'
import type { TripsMeta } from '@/lib/types'
import type { Shipper } from '@/lib/api/locations'

vi.mock('@/lib/api/locations', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/api/locations')>()),
  locationsApi: { list: vi.fn().mockResolvedValue({ data: [], count: 0, page: 1, limit: 8 }) },
}))

// FilterPopover incluye LocationPicker (autocomplete de Origen, 2026-08-02),
// que usa useQuery internamente — todos los renders necesitan un
// QueryClientProvider, mismo patrón que LocationPicker.test.tsx.
function renderWithQueryClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const meta: TripsMeta = {
  statuses: [], tms_sources: [], operational_states: [], alert_thresholds: [], csv_columns: [],
  temperature_ranges: [
    { cargo_type: 'FRIO', label: 'Frío', min_c: 2, max_c: 5 },
    { cargo_type: 'CONGELADO', label: 'Congelado', min_c: -25, max_c: -15 },
  ],
  unassigned_reasons: [],
  operation_types: [
    { id: 'RM', label: 'RM', bg_color: '#e8eeff', text_color: '#053bfa' },
    { id: 'ZONA_CERO', label: 'Zona Cero', bg_color: '#fef3e8', text_color: '#a35b00' },
  ],
}

const shippers: Shipper[] = [
  { id: '1', name: 'Walmart', status: 'ACTIVE' },
  { id: '2', name: 'Sodimac', status: 'ACTIVE' },
]

function Harness({ onDispatch }: { onDispatch?: ReturnType<typeof useDiarioFilters>[1] }) {
  const [filters, dispatch] = useDiarioFilters()
  return (
    <FilterPopover
      filters={filters}
      dispatch={onDispatch ?? dispatch}
      meta={meta}
      shippers={shippers}
    />
  )
}

describe('FilterPopover', () => {
  it('opens the panel and shows a "Tipo de operación" toggle for each catalog entry', () => {
    renderWithQueryClient(<Harness />)
    fireEvent.click(screen.getByText('Filtros'))
    expect(screen.getByText('Tipo de operación')).toBeInTheDocument()
    expect(screen.getByText('RM')).toBeInTheDocument()
    expect(screen.getByText('Zona Cero')).toBeInTheDocument()
  })

  it('clicking a operation_type button dispatches toggleOperationType', () => {
    const dispatch = vi.fn()
    renderWithQueryClient(<Harness onDispatch={dispatch} />)
    fireEvent.click(screen.getByText('Filtros'))
    fireEvent.click(screen.getByText('RM'))
    expect(dispatch).toHaveBeenCalledWith({ type: 'toggleOperationType', id: 'RM' })
  })

  it('no longer shows a región/ciudad de origen picker', () => {
    renderWithQueryClient(<Harness />)
    fireEvent.click(screen.getByText('Filtros'))
    expect(screen.queryByText('Ubicación de origen')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Región (filtro)')).not.toBeInTheDocument()
  })

  it('shows the filter count badge including active operation_type selections', () => {
    function CountHarness() {
      const [filters, dispatch] = useDiarioFilters()
      return <FilterPopover filters={{ ...filters, fOperationType: ['RM'] }} dispatch={dispatch} meta={meta} />
    }
    renderWithQueryClient(<CountHarness />)
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  // 2026-08-02: filtros nuevos — Cliente, Tipo de carga, Origen
  it('shows a "Cliente" chip per shipper and dispatches toggleClient on click', () => {
    const dispatch = vi.fn()
    renderWithQueryClient(<Harness onDispatch={dispatch} />)
    fireEvent.click(screen.getByText('Filtros'))
    expect(screen.getByText('Cliente')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Walmart'))
    expect(dispatch).toHaveBeenCalledWith({ type: 'toggleClient', id: 'Walmart' })
  })

  it('does not render the Cliente section when no shippers are given', () => {
    function NoShippersHarness() {
      const [filters, dispatch] = useDiarioFilters()
      return <FilterPopover filters={filters} dispatch={dispatch} meta={meta} />
    }
    renderWithQueryClient(<NoShippersHarness />)
    fireEvent.click(screen.getByText('Filtros'))
    expect(screen.queryByText('Cliente')).not.toBeInTheDocument()
  })

  it('shows a "Tipo de carga" chip per temperature range and dispatches toggleCargoType on click', () => {
    const dispatch = vi.fn()
    renderWithQueryClient(<Harness onDispatch={dispatch} />)
    fireEvent.click(screen.getByText('Filtros'))
    expect(screen.getByText('Tipo de carga')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Frío'))
    expect(dispatch).toHaveBeenCalledWith({ type: 'toggleCargoType', id: 'FRIO' })
  })

  it('shows selected origins as removable chips and dispatches toggleOrigin on remove', () => {
    const dispatch = vi.fn()
    function OriginHarness() {
      const [filters] = useDiarioFilters()
      return (
        <FilterPopover
          filters={{ ...filters, fOrigin: ['CD Quilicura'] }}
          dispatch={dispatch}
          meta={meta}
        />
      )
    }
    renderWithQueryClient(<OriginHarness />)
    fireEvent.click(screen.getByText('Filtros'))
    expect(screen.getByText('CD Quilicura')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Quitar origen CD Quilicura'))
    expect(dispatch).toHaveBeenCalledWith({ type: 'toggleOrigin', id: 'CD Quilicura' })
  })
})
