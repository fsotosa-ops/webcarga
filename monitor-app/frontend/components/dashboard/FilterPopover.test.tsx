import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FilterPopover } from './FilterPopover'
import { useDiarioFilters } from '@/hooks/useDiarioFilters'
import type { TripsMeta } from '@/lib/types'
import type { FilterGroup } from '@/lib/api/filterGroups'

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
  clients: [],
}

// Bug 5.2: Estado (grupos default + custom) se movió al popover — mismo
// shape que ya resuelve page.tsx (defaultGroups useMemo).
const defaultGroups = [
  { id: 'en_ruta', statuses: ['RUTA'], label: 'En Ruta', on: 'bg-blue-500', off: 'text-blue-600' },
]
const customGroups: FilterGroup[] = [
  { id: 'g1', name: 'Mis urgentes', color: 'red', statuses: ['CANCELADO'] } as FilterGroup,
]

function Harness({
  onDispatch, statusParam = '', onEditGroup = vi.fn(), onCreateGroup = vi.fn(), onSaveAsGroup = vi.fn(),
}: {
  onDispatch?: ReturnType<typeof useDiarioFilters>[1]
  statusParam?: string
  onEditGroup?: (g: FilterGroup) => void
  onCreateGroup?: () => void
  onSaveAsGroup?: () => void
}) {
  const [filters, dispatch] = useDiarioFilters()
  return (
    <FilterPopover
      filters={filters}
      dispatch={onDispatch ?? dispatch}
      meta={meta}
      defaultGroups={defaultGroups}
      customGroups={customGroups}
      statusParam={statusParam}
      onEditGroup={onEditGroup}
      onCreateGroup={onCreateGroup}
      onSaveAsGroup={onSaveAsGroup}
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
      return (
        <FilterPopover
          filters={{ ...filters, fOperationType: ['RM'] }}
          dispatch={dispatch}
          meta={meta}
          defaultGroups={defaultGroups}
          customGroups={customGroups}
          statusParam=""
          onEditGroup={vi.fn()}
          onCreateGroup={vi.fn()}
          onSaveAsGroup={vi.fn()}
        />
      )
    }
    renderWithQueryClient(<CountHarness />)
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('shows the filter count badge including an active Estado group', () => {
    function CountHarness() {
      const [filters, dispatch] = useDiarioFilters()
      return (
        <FilterPopover
          filters={{ ...filters, activeGroup: 'default:en_ruta' }}
          dispatch={dispatch}
          meta={meta}
          defaultGroups={defaultGroups}
          customGroups={customGroups}
          statusParam=""
          onEditGroup={vi.fn()}
          onCreateGroup={vi.fn()}
          onSaveAsGroup={vi.fn()}
        />
      )
    }
    renderWithQueryClient(<CountHarness />)
    expect(screen.getByText('1')).toBeInTheDocument()
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
          defaultGroups={defaultGroups}
          customGroups={customGroups}
          statusParam=""
          onEditGroup={vi.fn()}
          onCreateGroup={vi.fn()}
          onSaveAsGroup={vi.fn()}
        />
      )
    }
    renderWithQueryClient(<OriginHarness />)
    fireEvent.click(screen.getByText('Filtros'))
    expect(screen.getByText('CD Quilicura')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Quitar origen CD Quilicura'))
    expect(dispatch).toHaveBeenCalledWith({ type: 'toggleOrigin', id: 'CD Quilicura' })
  })

  // Bug 5.2: Estado se movió acá desde la barra principal — mismo
  // comportamiento (toggleGroup, crear/guardar grupo) que tenía en page.tsx.
  it('shows an "Estado" section with default groups and dispatches toggleGroup on click', () => {
    const dispatch = vi.fn()
    renderWithQueryClient(<Harness onDispatch={dispatch} />)
    fireEvent.click(screen.getByText('Filtros'))
    expect(screen.getByText('Estado')).toBeInTheDocument()
    fireEvent.click(screen.getByText('En Ruta'))
    expect(dispatch).toHaveBeenCalledWith({ type: 'toggleGroup', key: 'default:en_ruta' })
  })

  it('shows custom groups and calls onEditGroup when the pencil icon is clicked', () => {
    const onEditGroup = vi.fn()
    renderWithQueryClient(<Harness onEditGroup={onEditGroup} />)
    fireEvent.click(screen.getByText('Filtros'))
    expect(screen.getByText('Mis urgentes')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Editar grupo Mis urgentes'))
    expect(onEditGroup).toHaveBeenCalledWith(customGroups[0])
  })

  it('calls onCreateGroup when "Grupo" is clicked', () => {
    const onCreateGroup = vi.fn()
    renderWithQueryClient(<Harness onCreateGroup={onCreateGroup} />)
    fireEvent.click(screen.getByText('Filtros'))
    fireEvent.click(screen.getByText('Grupo'))
    expect(onCreateGroup).toHaveBeenCalled()
  })

  it('only shows "Guardar como grupo" when statusParam is set, and calls onSaveAsGroup', () => {
    const onSaveAsGroup = vi.fn()
    renderWithQueryClient(<Harness statusParam="RUTA" onSaveAsGroup={onSaveAsGroup} />)
    fireEvent.click(screen.getByText('Filtros'))
    fireEvent.click(screen.getByText('Guardar como grupo'))
    expect(onSaveAsGroup).toHaveBeenCalled()
  })

  it('does not show "Guardar como grupo" when statusParam is empty', () => {
    renderWithQueryClient(<Harness statusParam="" />)
    fireEvent.click(screen.getByText('Filtros'))
    expect(screen.queryByText('Guardar como grupo')).not.toBeInTheDocument()
  })
})
