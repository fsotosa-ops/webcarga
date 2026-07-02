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
  status_reported_at: null, current_status: null, tractor_plate: null, trailer_plate: null,
  driver_name: null, driver_rut: null, driver_phone: null, transporter: null, transporter_tms: null,
  origin: null, cargo_type: null, stops: [], activo: false, trabajando: false, asignado: false,
  primera_vuelta: false, estado_manual: null, observaciones: null, comentarios: null,
  fleet_link_id: null, transporter_profile_id: null, manually_edited_fields: [], edited_at: null,
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
})
