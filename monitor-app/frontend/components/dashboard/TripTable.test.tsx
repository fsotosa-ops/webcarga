import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TripTable } from './TripTable'
import { tripsApi } from '@/lib/api/trips'
import type { Trip } from '@/lib/types'

vi.mock('@/lib/api/trips', () => ({
  tripsApi: { patch: vi.fn().mockResolvedValue({}) },
}))

function makeTrip(id: string, overrides: Partial<Trip> = {}): Trip {
  return {
    id, source_system: 'qanalytics', client_name: 'walmart', planning_date: '2026-07-02',
    status_reported_at: null, current_status: 'ORIGEN', tractor_plate: 'ABCD12', tractor_plate_tms: null, trailer_plate: null,
    driver_name: 'Juan Perez', driver_name_tms: null, driver_tax_id: null, driver_phone: null, carrier_name: null, carrier_name_tms: null,
    origin: 'CD Quilicura', cargo_type: 'FRIO', stops: [], activo: true, trabajando: false, asignado: true,
    primera_vuelta: false, estado_manual: null, observaciones: null, comentarios: null, unassigned_reason_id: null,
    fleet_link_id: null, carrier_id: null, driver_id: null, tractor_asset_id: null, trailer_asset_id: null, manually_edited_fields: [], edited_at: null,
    edited_by: null, updated_at: null, created_at: null,
    source_system_trip_id: '2000711', milestone_status: null, pipeline_updated_at: null,
    ...overrides,
  }
}

describe('TripTable', () => {
  it('renders an "Indicadores" column with clickable dots for a manual trip', () => {
    render(<TripTable trips={[makeTrip('t1', { source_system: 'manual' })]} selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getAllByTitle('Activo').length).toBeGreaterThan(0)
  })

  it('also renders Indicadores for a TMS-sourced trip — el pipeline ya los deriva de trip_status, y la excepción de UAT permite override manual para cualquier origen', () => {
    render(<TripTable trips={[makeTrip('t1', { source_system: 'qanalytics' })]} selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getAllByTitle('Activo').length).toBeGreaterThan(0)
  })

  it('calls onSelect directly when a row is clicked (no intermediate expand step)', () => {
    const onSelect = vi.fn()
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={onSelect} onSaved={vi.fn()} meta={null} />)
    fireEvent.click(screen.getAllByText('ABCD12')[0])
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }))
  })

  it('clicking an indicator dot does not call onSelect', () => {
    const onSelect = vi.fn()
    render(<TripTable trips={[makeTrip('t1', { source_system: 'manual' })]} selectedId={null} onSelect={onSelect} onSaved={vi.fn()} meta={null} />)
    fireEvent.click(screen.getAllByTitle('Activo')[0])
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('shows an OFF TIME compliance badge when a stop is off time', () => {
    const stops: Trip['stops'] = [{
      stop_id: 's1', local: 'Parada 1', planning_date: null, arrival_date: null, departure_date: null,
      departure_date_prog: null, unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
      on_time_status: 'OFF TIME', destination_city: null, destination_region: null, s2s: null,
      temperature: null, milestone_status: null,
    }]
    render(<TripTable trips={[makeTrip('t1', { stops })]} selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getAllByText(/OFF TIME/).length).toBeGreaterThan(0)
  })

  it('does not show a compliance badge when no stop has on_time_status data', () => {
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.queryByText(/OFF TIME/)).not.toBeInTheDocument()
  })

  it('shows the ETA of the active stop next to the status', () => {
    const stops: Trip['stops'] = [{
      stop_id: 's1', local: 'Parada 1', planning_date: '2026-07-02 09:00:00', arrival_date: null, departure_date: null,
      departure_date_prog: null, unload_start: null, unload_end: null, gps_arrival_date: null, gps_departure_date: null,
      on_time_status: null, destination_city: null, destination_region: null, s2s: null,
      temperature: null, milestone_status: null,
    }]
    render(<TripTable trips={[makeTrip('t1', { stops })]} selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getAllByText(/llega ~\d{2}:\d{2}/).length).toBeGreaterThan(0)
  })

  it('shows time since the last TMS report next to the status', () => {
    const trip = makeTrip('t1', { status_reported_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() })
    render(<TripTable trips={[trip]} selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={null} />)
    expect(screen.getAllByText(/hace 5 min/).length).toBeGreaterThan(0)
  })
})

describe('TripTable — errores de edición inline visibles', () => {
  it('shows an inline error and stays in edit mode when saving a driver edit fails', async () => {
    vi.mocked(tripsApi.patch).mockRejectedValueOnce(new Error('fallo de red'))
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={null} />)
    // [0] es la card mobile (abre detalle); [1] es la celda desktop editable
    fireEvent.click(screen.getAllByText('Juan Perez')[1])
    const input = screen.getByDisplayValue('Juan Perez')
    fireEvent.change(input, { target: { value: 'Pedro Soto' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText('fallo de red')).toBeInTheDocument()
    // sigue en modo edición para poder reintentar
    expect(screen.getByDisplayValue('Pedro Soto')).toBeInTheDocument()
  })
})

describe('TripTable — estado manual resuelto contra estados operacionales', () => {
  it('muestra el label del estado operacional (no el uuid) cuando hay override', () => {
    const meta = {
      statuses: [{ id: 'ORIGEN', label: 'ORIGEN', bg_color: '#fff', text_color: '#000', group: 'en_ruta' }],
      operational_states: [{ id: 'op-uuid-1', label: 'Confirmado en panne', bg_color: '#fee', text_color: '#b00', group: 'problema' }],
      tms_sources: [], alert_thresholds: [], csv_columns: [], temperature_ranges: [], unassigned_reasons: [],
    }
    const trip = makeTrip('t1', { estado_manual: 'op-uuid-1' })
    render(<TripTable trips={[trip]} selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={meta} />)
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
    render(<TripTable trips={trips} selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={null} />)
    fireEvent.click(screen.getByText('ID Viaje'))
    const ids = screen.getAllByText(/^(9|10)$/).map(el => el.textContent)
    expect(ids).toEqual(['9', '10'])
  })

  it('sorts null values last regardless of direction', () => {
    const trips = [
      makeTrip('a', { driver_name: null }),
      makeTrip('b', { driver_name: 'Ana' }),
    ]
    render(<TripTable trips={trips} selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={null} />)
    fireEvent.click(screen.getByText('Conductor'))
    const rows = document.querySelectorAll('tbody tr')
    expect(rows[0].textContent).toContain('Ana')
  })
})

describe('TripTable — accesibilidad por teclado', () => {
  it('opens the detail with Enter on a focused row', () => {
    const onSelect = vi.fn()
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={onSelect} onSaved={vi.fn()} meta={null} />)
    const row = screen.getAllByText('ABCD12')[1].closest('tr')!
    expect(row).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }))
  })

  it('moves focus to the next/previous row with arrow keys', () => {
    render(
      <TripTable
        trips={[makeTrip('t1'), makeTrip('t2', { tractor_plate: 'WXYZ99' })]}
        selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={null}
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
  it('Patente queda fija a la izquierda y Estado/Indicadores a la derecha', () => {
    render(<TripTable trips={[makeTrip('t1')]} selectedId={null} onSelect={vi.fn()} onSaved={vi.fn()} meta={null} />)
    const patenteTh = screen.getByText('Patente').closest('th')!
    const estadoTh  = screen.getByText('Estado').closest('th')!
    const indTh     = screen.getByText('Indicadores').closest('th')!
    expect(patenteTh.className).toContain('sticky left-0')
    expect(estadoTh.className).toContain('sticky right-')
    expect(indTh.className).toContain('sticky right-0')
  })
})
