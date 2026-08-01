import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { IndicatorSwitches } from './IndicatorSwitches'
import { tripsApi } from '@/lib/api/trips'
import type { Trip } from '@/lib/types'

vi.mock('@/lib/api/trips', () => ({
  tripsApi: { patch: vi.fn(), resetField: vi.fn() },
}))

const baseTrip: Trip = {
  id: 't1', source_system: 'qanalytics', client_name: null, planning_date: null,
  status_reported_at: null, current_status: null, tractor_plate: null, tractor_plate_tms: null, trailer_plate: null,
  driver_name: null, driver_name_tms: null, driver_tax_id: null, driver_phone: null, carrier_name: null, carrier_name_tms: null,
  origin: null, cargo_type: null, cargo_delivered: false, temp_status: null, stops: [], is_active: false, is_working: false, is_assigned: false,
  is_first_leg: false, manual_status: null, notes: null, comments: null, unassigned_reason_id: null,
  fleet_link_id: null, carrier_id: null, driver_id: null, tractor_asset_id: null, trailer_asset_id: null, manually_edited_fields: [], edited_at: null,
  edited_by: null, created_at: null,
  updated_at: null, source_system_trip_id: null, milestone_status: null, pipeline_updated_at: null,
}

describe('IndicatorSwitches', () => {
  beforeEach(() => {
    vi.mocked(tripsApi.patch).mockReset()
    vi.mocked(tripsApi.resetField).mockReset()
  })

  it('renders Activo/Trabajando/Asignado as switches, without "1ra Vuelta"', () => {
    render(<IndicatorSwitches trip={baseTrip} onSaved={vi.fn()} />)
    expect(screen.getByRole('switch', { name: 'Activo' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Trabajando' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Asignado' })).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: '1ra Vuelta' })).not.toBeInTheDocument()
    expect(screen.queryByText('1ra Vuelta')).not.toBeInTheDocument()
  })

  it('calls tripsApi.patch with the toggled value immediately on click', () => {
    vi.mocked(tripsApi.patch).mockResolvedValue({ ...baseTrip, is_active: true })
    render(<IndicatorSwitches trip={baseTrip} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Activo' }))
    expect(tripsApi.patch).toHaveBeenCalledWith('t1', { is_active: true })
  })

  it('calls onSaved with the server response on success', async () => {
    const updated = { ...baseTrip, is_active: true }
    vi.mocked(tripsApi.patch).mockResolvedValue(updated)
    const onSaved = vi.fn()
    render(<IndicatorSwitches trip={baseTrip} onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Activo' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated))
  })

  it('shows a visible error message and does not call onSaved when the PATCH fails', async () => {
    vi.mocked(tripsApi.patch).mockRejectedValue(new Error('network down'))
    const onSaved = vi.fn()
    render(<IndicatorSwitches trip={baseTrip} onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Activo' }))
    await waitFor(() => expect(screen.getByText('network down')).toBeInTheDocument())
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('toggles off a currently-active indicator', () => {
    vi.mocked(tripsApi.patch).mockResolvedValue({ ...baseTrip, is_working: false })
    render(<IndicatorSwitches trip={{ ...baseTrip, is_working: true }} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Trabajando' }))
    expect(tripsApi.patch).toHaveBeenCalledWith('t1', { is_working: false })
  })

  it('shows explicit override attribution text and a revert control when a field is manually edited', () => {
    const trip = { ...baseTrip, manually_edited_fields: ['is_assigned'], edited_by: 'Felipe Sumadots', edited_at: '2026-07-02 10:15:00' }
    render(<IndicatorSwitches trip={trip} onSaved={vi.fn()} />)
    expect(screen.getByText(/Editado manualmente por Felipe Sumadots/)).toBeInTheDocument()
    expect(screen.getByText('Revertir a automático')).toBeInTheDocument()
  })

  it('does not show the override text for a field not in manually_edited_fields', () => {
    const trip = { ...baseTrip, manually_edited_fields: ['is_assigned'], edited_by: 'Felipe Sumadots', edited_at: '2026-07-02 10:15:00' }
    render(<IndicatorSwitches trip={trip} onSaved={vi.fn()} />)
    expect(screen.getAllByText('Revertir a automático').length).toBe(1)
  })

  it('reverting calls tripsApi.resetField and clears the field from manually_edited_fields via onSaved', async () => {
    vi.mocked(tripsApi.resetField).mockResolvedValue({ ok: true, field: 'is_assigned' })
    const onSaved = vi.fn()
    const trip = { ...baseTrip, manually_edited_fields: ['is_assigned'], is_assigned: true }
    render(<IndicatorSwitches trip={trip} onSaved={onSaved} />)
    fireEvent.click(screen.getByText('Revertir a automático'))
    await waitFor(() => expect(tripsApi.resetField).toHaveBeenCalledWith('t1', 'is_assigned'))
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ manually_edited_fields: [] }))
  })

  it('shows a visible error when reverting fails', async () => {
    vi.mocked(tripsApi.resetField).mockRejectedValue(new Error('revert failed'))
    const trip = { ...baseTrip, manually_edited_fields: ['is_assigned'] }
    render(<IndicatorSwitches trip={trip} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByText('Revertir a automático'))
    expect(await screen.findByText('revert failed')).toBeInTheDocument()
  })
})
