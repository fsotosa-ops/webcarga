import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FilterPopover } from './FilterPopover'
import { useDiarioFilters } from '@/hooks/useDiarioFilters'
import type { TripsMeta } from '@/lib/types'

const meta: TripsMeta = {
  statuses: [], tms_sources: [], operational_states: [], alert_thresholds: [], csv_columns: [],
  temperature_ranges: [], unassigned_reasons: [],
  operation_types: [
    { id: 'RM', label: 'RM', bg_color: '#e8eeff', text_color: '#053bfa' },
    { id: 'ZONA_CERO', label: 'Zona Cero', bg_color: '#fef3e8', text_color: '#a35b00' },
  ],
}

function Harness({ onDispatch }: { onDispatch?: ReturnType<typeof useDiarioFilters>[1] }) {
  const [filters, dispatch] = useDiarioFilters('2026-07-04')
  return (
    <FilterPopover
      filters={filters}
      dispatch={onDispatch ?? dispatch}
      meta={meta}
    />
  )
}

describe('FilterPopover', () => {
  it('opens the panel and shows a "Tipo de operación" toggle for each catalog entry', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('Filtros'))
    expect(screen.getByText('Tipo de operación')).toBeInTheDocument()
    expect(screen.getByText('RM')).toBeInTheDocument()
    expect(screen.getByText('Zona Cero')).toBeInTheDocument()
  })

  it('clicking a operation_type button dispatches toggleOperationType', () => {
    const dispatch = vi.fn()
    render(<Harness onDispatch={dispatch} />)
    fireEvent.click(screen.getByText('Filtros'))
    fireEvent.click(screen.getByText('RM'))
    expect(dispatch).toHaveBeenCalledWith({ type: 'toggleOperationType', id: 'RM' })
  })

  it('no longer shows a región/ciudad de origen picker', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('Filtros'))
    expect(screen.queryByText('Ubicación de origen')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Región (filtro)')).not.toBeInTheDocument()
  })

  it('shows the filter count badge including active operation_type selections', () => {
    function CountHarness() {
      const [filters, dispatch] = useDiarioFilters('2026-07-04')
      return <FilterPopover filters={{ ...filters, fOperationType: ['RM'] }} dispatch={dispatch} meta={meta} />
    }
    render(<CountHarness />)
    expect(screen.getByText('1')).toBeInTheDocument()
  })
})
