import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { IndicatorDots } from './IndicatorDots'
import { tripsApi } from '@/lib/api/trips'
import type { Trip } from '@/lib/types'

vi.mock('@/lib/api/trips', () => ({
  tripsApi: { patch: vi.fn() },
}))

const baseTrip: Trip = {
  id: 't1', source_system: 'qanalytics', client_name: null, planning_date: null,
  status_reported_at: null, current_status: null, tractor_plate: null, tractor_plate_tms: null, trailer_plate: null,
  driver_name: null, driver_name_tms: null, driver_tax_id: null, driver_phone: null, carrier_name: null, carrier_name_tms: null,
  origin: null, cargo_type: null, stops: [], activo: false, trabajando: false, asignado: false,
  primera_vuelta: false, estado_manual: null, observaciones: null, comentarios: null, unassigned_reason_id: null,
  fleet_link_id: null, carrier_id: null, driver_id: null, tractor_asset_id: null, trailer_asset_id: null, manually_edited_fields: [], edited_at: null,
  edited_by: null, created_at: null,
  updated_at: null, source_system_trip_id: null, milestone_status: null, pipeline_updated_at: null,
}

describe('IndicatorDots', () => {
  beforeEach(() => { vi.mocked(tripsApi.patch).mockReset() })

  it('calls tripsApi.patch with the toggled value immediately on click', () => {
    vi.mocked(tripsApi.patch).mockResolvedValue({ ...baseTrip, activo: true })
    render(<IndicatorDots trip={baseTrip} onSaved={vi.fn()} />)

    fireEvent.click(screen.getByTitle('Activo'))

    expect(tripsApi.patch).toHaveBeenCalledWith('t1', { activo: true })
  })

  it('calls onSaved with the server response on success', async () => {
    const updated = { ...baseTrip, activo: true }
    vi.mocked(tripsApi.patch).mockResolvedValue(updated)
    const onSaved = vi.fn()
    render(<IndicatorDots trip={baseTrip} onSaved={onSaved} />)

    fireEvent.click(screen.getByTitle('Activo'))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated))
  })

  it('shows a visible error message and does not call onSaved when the PATCH fails', async () => {
    vi.mocked(tripsApi.patch).mockRejectedValue(new Error('network down'))
    const onSaved = vi.fn()
    render(<IndicatorDots trip={baseTrip} onSaved={onSaved} />)

    fireEvent.click(screen.getByTitle('Activo'))

    await waitFor(() => expect(screen.getByText('network down')).toBeInTheDocument())
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('toggles off a currently-active indicator', () => {
    vi.mocked(tripsApi.patch).mockResolvedValue({ ...baseTrip, trabajando: false })
    render(<IndicatorDots trip={{ ...baseTrip, trabajando: true }} onSaved={vi.fn()} />)

    fireEvent.click(screen.getByTitle('Trabajando'))

    expect(tripsApi.patch).toHaveBeenCalledWith('t1', { trabajando: false })
  })

  it('clicking a dot does not bubble up to a parent onClick', () => {
    vi.mocked(tripsApi.patch).mockResolvedValue(baseTrip)
    const parentClick = vi.fn()
    render(
      <div onClick={parentClick}>
        <IndicatorDots trip={baseTrip} onSaved={vi.fn()} />
      </div>
    )

    fireEvent.click(screen.getByTitle('Activo'))

    expect(parentClick).not.toHaveBeenCalled()
  })

  it('rolls back optimistic state when PATCH fails, computing correct toggle on second click', async () => {
    // First call rejects, second call succeeds
    vi.mocked(tripsApi.patch).mockRejectedValueOnce(new Error('network error'))
    vi.mocked(tripsApi.patch).mockResolvedValueOnce({ ...baseTrip, activo: true })
    const onSaved = vi.fn()
    render(<IndicatorDots trip={baseTrip} onSaved={onSaved} />)

    // First click: since trip.activo is false, next = !(false) = true
    fireEvent.click(screen.getByTitle('Activo'))
    expect(tripsApi.patch).toHaveBeenNthCalledWith(1, 't1', { activo: true })

    // Wait for error message to appear (proves catch was executed and optimistic state rolled back)
    await waitFor(() => expect(screen.getByText('network error')).toBeInTheDocument())

    // Second click: if rollback worked, optimistic state was cleared, so next should again be !(false) = true
    // If rollback had NOT worked, optimistic.activo would still be true, and next would be !(true) = false
    fireEvent.click(screen.getByTitle('Activo'))

    // Verify the second call computed the correct toggle from the original state
    expect(tripsApi.patch).toHaveBeenNthCalledWith(2, 't1', { activo: true })
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ activo: true })))
  })

  it('shows a lock icon with attribution tooltip when a field is in manually_edited_fields', () => {
    const trip = { ...baseTrip, manually_edited_fields: ['asignado'], edited_by: 'Felipe Sumadots', edited_at: '2026-07-02 10:15:00' }
    render(<IndicatorDots trip={trip} onSaved={vi.fn()} />)
    expect(screen.getByTitle(/Felipe Sumadots/)).toBeInTheDocument()
  })

  it('does not show a lock icon for a field not in manually_edited_fields', () => {
    const trip = { ...baseTrip, manually_edited_fields: ['asignado'], edited_by: 'Felipe Sumadots', edited_at: '2026-07-02 10:15:00' }
    render(<IndicatorDots trip={trip} onSaved={vi.fn()} />)
    // Trabajando no está congelado — su title queda exactamente "Trabajando", sin sufijo "congelado por..."
    expect(screen.getByTitle('Trabajando')).toBeInTheDocument()
  })
})
