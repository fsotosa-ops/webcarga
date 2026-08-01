import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TripTable } from './TripTable'
import type { Trip } from '@/lib/types'

function makeTrip(id: string, overrides: Partial<Trip> = {}): Trip {
  return {
    id, source_system: 'qanalytics', client_name: 'walmart', planning_date: '2026-07-02',
    status_reported_at: null, current_status: 'ORIGEN', tractor_plate: 'ABCD12', tractor_plate_tms: null, trailer_plate: null,
    driver_name: 'Juan Perez', driver_name_tms: null, driver_tax_id: null, driver_phone: null, carrier_name: null, carrier_name_tms: null,
    origin: 'CD Quilicura', cargo_type: 'FRIO', cargo_delivered: false, temp_status: null, stops: [], is_active: true, is_working: false, is_assigned: true,
    is_first_leg: false, manual_status: null, notes: null, comments: null, unassigned_reason_id: null,
    fleet_link_id: null, carrier_id: null, driver_id: null, tractor_asset_id: null, trailer_asset_id: null, manually_edited_fields: [], edited_at: null,
    edited_by: null, updated_at: null, created_at: null,
    source_system_trip_id: '2000711', milestone_status: null, pipeline_updated_at: null,
    ...overrides,
  }
}

describe('TripTable', () => {
  it('calls onSelect directly when a row is clicked (no intermediate expand step)', () => {
    const onSelect = vi.fn()
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={onSelect} onSelectFocusNotes={vi.fn()} meta={null} />)
    fireEvent.click(screen.getAllByText('ABCD12')[0])
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }))
  })

  it('never shows an OFF TIME badge, even when a stop has on_time_status OFF TIME (2026-08-01: concepto retirado)', () => {
    const stops: Trip['stops'] = [{
      stop_id: 's1', local: 'Parada 1', planning_date: null, arrival_date: null, departure_date: null,
      departure_date_prog: null, unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
      on_time_status: 'OFF TIME', destination_city: null, destination_region: null, s2s: null,
      temperature: null, milestone_status: null,
    }]
    render(<TripTable trips={[makeTrip('t1', { stops })]} selectedId={null} onSelect={vi.fn()} onSelectFocusNotes={vi.fn()} meta={null} />)
    expect(screen.queryByText(/OFF TIME/)).not.toBeInTheDocument()
  })

  it('does not show a compliance badge when no stop has on_time_status data', () => {
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={vi.fn()} onSelectFocusNotes={vi.fn()} meta={null} />)
    expect(screen.queryByText(/OFF TIME/)).not.toBeInTheDocument()
  })

  it('shows the ETA of the active stop next to the status', () => {
    const stops: Trip['stops'] = [{
      stop_id: 's1', local: 'Parada 1', planning_date: '2026-07-02 09:00:00', arrival_date: null, departure_date: null,
      departure_date_prog: null, unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
      on_time_status: null, destination_city: null, destination_region: null, s2s: null,
      temperature: null, milestone_status: null, is_active: true,
    }]
    render(<TripTable trips={[makeTrip('t1', { stops })]} selectedId={null} onSelect={vi.fn()} onSelectFocusNotes={vi.fn()} meta={null} />)
    expect(screen.getAllByText(/llega ~\d{2}:\d{2}/).length).toBeGreaterThan(0)
  })

  // "hace X hrs" (tiempo desde el último reporte TMS) fue reemplazado por el
  // semáforo de tiempo en local (Hito 14, ver describe('DwellSeverityBadge...
  // más abajo) — 2026-08-01.

  it('shows the RM/Zona Cero classification badge next to a stop when operation_type resolved (H2.6, catálogo de locales)', () => {
    const stops: Trip['stops'] = [{
      stop_id: 's1', local: 'ALAMEDA - 72', planning_date: null, arrival_date: null, departure_date: null,
      departure_date_prog: null, unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
      on_time_status: null, destination_city: null, destination_region: null, s2s: null,
      temperature: null, milestone_status: null, operation_type: 'RM',
    }]
    const meta = {
      statuses: [], tms_sources: [], operational_states: [], alert_thresholds: [], csv_columns: [],
      temperature_ranges: [], unassigned_reasons: [],
      operation_types: [{ id: 'RM', label: 'RM', bg_color: '#e8eeff', text_color: '#053bfa' }],
    }
    render(<TripTable trips={[makeTrip('t1', { stops })]} selectedId={null} onSelect={vi.fn()} onSelectFocusNotes={vi.fn()} meta={meta} />)
    expect(screen.getAllByText('RM').length).toBeGreaterThan(0)
  })

  it('does not show a classification badge when operation_type could not be resolved', () => {
    const stops: Trip['stops'] = [{
      stop_id: 's1', local: 'CD LO AGUIRRE', planning_date: null, arrival_date: null, departure_date: null,
      departure_date_prog: null, unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
      on_time_status: null, destination_city: null, destination_region: null, s2s: null,
      temperature: null, milestone_status: null, operation_type: null,
    }]
    render(<TripTable trips={[makeTrip('t1', { stops })]} selectedId={null} onSelect={vi.fn()} onSelectFocusNotes={vi.fn()} meta={null} />)
    expect(screen.queryByText('RM')).not.toBeInTheDocument()
  })
})

// Gap cerrado 2026-07-22: el badge de compliance (conductor/tracto/empresa)
// dependía de un `alertSummary` que nunca se poblaba (endpoint viejo
// borrado en Checkpoint A-E) — ahora viene directo del trip, live.
describe('TripTable — documentación pendiente (conductor/tracto/empresa)', () => {
  it('shows a pending-docs count next to the driver when driver_pending_docs > 0, with a title identifying the entity', () => {
    render(<TripTable trips={[makeTrip('t1', { driver_pending_docs: 2 })]} selectedId={null} onSelect={vi.fn()} onSelectFocusNotes={vi.fn()} meta={null} />)
    expect(screen.getAllByTitle('Conductor: 2 documento(s) pendiente(s)').length).toBeGreaterThan(0)
  })

  it('shows a pending-docs count next to the plate when tractor_pending_docs > 0, with a title identifying the entity', () => {
    render(<TripTable trips={[makeTrip('t1', { tractor_pending_docs: 7 })]} selectedId={null} onSelect={vi.fn()} onSelectFocusNotes={vi.fn()} meta={null} />)
    expect(screen.getAllByTitle('Tracto: 7 documento(s) pendiente(s)').length).toBeGreaterThan(0)
  })

  it('does not show a pending-docs badge when the count is 0 or null', () => {
    render(<TripTable trips={[makeTrip('t1', { driver_pending_docs: 0, tractor_pending_docs: null })]} selectedId={null} onSelect={vi.fn()} onSelectFocusNotes={vi.fn()} meta={null} />)
    expect(screen.queryByTitle(/documento/)).not.toBeInTheDocument()
  })
})

describe('TripTable — solo lectura (Fase 2, Plan 6)', () => {
  it('renders conductor, patente and phone as read-only text, with no editable inputs anywhere in the table', () => {
    render(<TripTable trips={[makeTrip('t1', { driver_phone: JSON.stringify(['+56911112222']) })]} selectedId={null} onSelect={vi.fn()} onSelectFocusNotes={vi.fn()} meta={null} />)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByText('+56911112222')).toBeInTheDocument()
  })

  it('clicking the conductor cell opens the detail instead of entering edit mode', () => {
    const onSelect = vi.fn()
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={onSelect} onSelectFocusNotes={vi.fn()} meta={null} />)
    fireEvent.click(screen.getAllByText('Juan Perez')[1])
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }))
    expect(screen.queryByDisplayValue('Juan Perez')).not.toBeInTheDocument()
  })

  it('clicking the patente cell opens the detail instead of entering edit mode', () => {
    const onSelect = vi.fn()
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={onSelect} onSelectFocusNotes={vi.fn()} meta={null} />)
    fireEvent.click(screen.getAllByText('ABCD12')[1])
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }))
    expect(screen.queryByPlaceholderText('XXNN00')).not.toBeInTheDocument()
  })

  it('shows both plates when tractor and trailer are set', () => {
    render(<TripTable trips={[makeTrip('t1', { tractor_plate: 'ABCD12', trailer_plate: 'RMPL01' })]} selectedId={null} onSelect={vi.fn()} onSelectFocusNotes={vi.fn()} meta={null} />)
    expect(screen.getAllByText('ABCD12').length).toBeGreaterThan(0)
    expect(screen.getAllByText('RMPL01').length).toBeGreaterThan(0)
  })

  it('clicking a phone number does not trigger onSelect (tel: link stays a distinct action from opening the detail)', () => {
    const onSelect = vi.fn()
    render(<TripTable trips={[makeTrip('t1', { driver_phone: JSON.stringify(['+56911112222']) })]} selectedId={null} onSelect={onSelect} onSelectFocusNotes={vi.fn()} meta={null} />)
    fireEvent.click(screen.getByText('+56911112222'))
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('TripTable — estado manual resuelto contra estados operacionales', () => {
  it('muestra el label del estado operacional (no el uuid) cuando hay override', () => {
    const meta = {
      statuses: [{ id: 'ORIGEN', label: 'ORIGEN', bg_color: '#fff', text_color: '#000', group: 'en_ruta' }],
      operational_states: [{ id: 'op-uuid-1', label: 'Confirmado en panne', bg_color: '#fee', text_color: '#b00', group: 'problema' }],
      tms_sources: [], alert_thresholds: [], csv_columns: [], temperature_ranges: [], unassigned_reasons: [], operation_types: [],
    }
    const trip = makeTrip('t1', { manual_status: 'op-uuid-1' })
    render(<TripTable trips={[trip]} selectedId={null} onSelect={vi.fn()} onSelectFocusNotes={vi.fn()} meta={meta} />)
    expect(screen.getAllByText('Confirmado en panne').length).toBeGreaterThan(0)
    expect(screen.queryByText('op-uuid-1')).not.toBeInTheDocument()
  })
})

describe('TripTable — orden tipado', () => {
  it('sorts ID Viaje numerically, not lexicographically', () => {
    const trips = [
      makeTrip('a', { source_system_trip_id: '10' }),
      makeTrip('b', { source_system_trip_id: '9' }),
    ]
    render(<TripTable trips={trips} selectedId={null} onSelect={vi.fn()} onSelectFocusNotes={vi.fn()} meta={null} />)
    fireEvent.click(screen.getByText('ID Viaje'))
    const ids = screen.getAllByText(/^(9|10)$/).map(el => el.textContent)
    expect(ids).toEqual(['9', '10'])
  })

  it('sorts null values last regardless of direction', () => {
    const trips = [
      makeTrip('a', { driver_name: null }),
      makeTrip('b', { driver_name: 'Ana' }),
    ]
    render(<TripTable trips={trips} selectedId={null} onSelect={vi.fn()} onSelectFocusNotes={vi.fn()} meta={null} />)
    fireEvent.click(screen.getByText('Conductor'))
    const rows = document.querySelectorAll('tbody tr')
    expect(rows[0].textContent).toContain('Ana')
  })
})

describe('TripTable — accesibilidad por teclado', () => {
  it('opens the detail with Enter on a focused row', () => {
    const onSelect = vi.fn()
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={onSelect} onSelectFocusNotes={vi.fn()} meta={null} />)
    const row = screen.getAllByText('ABCD12')[1].closest('tr')!
    expect(row).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }))
  })

  it('moves focus to the next/previous row with arrow keys', () => {
    render(
      <TripTable
        trips={[makeTrip('t1'), makeTrip('t2', { tractor_plate: 'WXYZ99' })]}
        selectedId={null} onSelect={vi.fn()} onSelectFocusNotes={vi.fn()} meta={null}
      />,
    )
    const rows = document.querySelectorAll('tbody tr')
    ;(rows[0] as HTMLElement).focus()
    fireEvent.keyDown(rows[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows[1])
    fireEvent.keyDown(rows[1], { key: 'ArrowUp' })
    expect(document.activeElement).toBe(rows[0])
  })
})

describe('TripTable — columnas fijas (sticky)', () => {
  it('Estado (con el chevron de apertura adentro) queda fijo — Patente pasa a ser una columna normal (Hito 11)', () => {
    // 2026-08-01: la minuta pide Estado al inicio de la tabla porque
    // operaciones filtra por Estado primero — reemplaza a Patente como
    // única columna sticky al hacer scroll horizontal.
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={vi.fn()} onSelectFocusNotes={vi.fn()} meta={null} />)
    const patenteTh = screen.getByText('Patente').closest('th')!
    const estadoTh  = screen.getByText('Estado').closest('th')!
    expect(estadoTh.className).toContain('sticky left-0')
    expect(patenteTh.className).not.toContain('sticky')
    expect(estadoTh.textContent).toContain('Abrir detalle')
  })
})

describe('DwellSeverityBadge in TripTable (Hito 14)', () => {
  const NOW = Date.parse('2026-07-04T18:00:00Z')

  function stopStuckFor(minutes: number): Trip['stops'] {
    return [{
      stop_id: 's1', local: 'Parada 1', planning_date: null,
      arrival_date: new Date(NOW - minutes * 60_000).toISOString(),
      departure_date: null,
      departure_date_prog: null, unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
      on_time_status: null, destination_city: null, destination_region: null, s2s: null,
      temperature: null, milestone_status: null, is_active: true,
    }]
  }

  it('shows the semáforo when the active stop has been arrived at for a while', () => {
    vi.setSystemTime(NOW)
    const trip = makeTrip('t1', { stops: stopStuckFor(150) }) // 150min → rojo
    render(<TripTable trips={[trip]} selectedId={null} onSelect={vi.fn()} onSelectFocusNotes={vi.fn()} meta={null} />)
    expect(screen.getAllByText(/en local/).length).toBeGreaterThan(0)
    vi.useRealTimers()
  })

  it('hides the semáforo when there is no active stop dwelling', () => {
    vi.setSystemTime(NOW)
    const trip = makeTrip('t1')
    render(<TripTable trips={[trip]} selectedId={null} onSelect={vi.fn()} onSelectFocusNotes={vi.fn()} meta={null} />)
    expect(screen.queryByText(/en local/)).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it('clicking the semáforo calls onSelectFocusNotes without also triggering the row onSelect', () => {
    vi.setSystemTime(NOW)
    const onSelect = vi.fn()
    const onSelectFocusNotes = vi.fn()
    const trip = makeTrip('t1', { stops: stopStuckFor(150) })
    render(<TripTable trips={[trip]} selectedId={null} onSelect={onSelect} onSelectFocusNotes={onSelectFocusNotes} meta={null} />)
    fireEvent.click(screen.getAllByText(/en local/)[0])
    expect(onSelectFocusNotes).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }))
    expect(onSelect).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
