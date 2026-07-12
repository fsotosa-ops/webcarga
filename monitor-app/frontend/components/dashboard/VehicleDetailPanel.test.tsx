import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { VehicleDetailPanel } from './VehicleDetailPanel'
import type { TransporterVehicle } from '@/lib/types'

const VEHICLE: TransporterVehicle = {
  id: 'v1', type: 'Tractocamión', plate: 'ABCD12',
  governance: {
    year: 2020, circ_permit_expiry: '2099-01-01', tech_inspection_expiry: '2099-01-01',
    gas_emissions_expiry: '2099-01-01', soap_insurance_expiry: '2099-01-01',
    padron: 'ok', poliza_rc: null, gps: 'ok', seguro_carga: 'ok',
    mantencion_camara_frio: 'n_a', creacion_gc_vehicle: 'ok',
  },
}

function renderPanel(vehicle: TransporterVehicle | null, opts: {
  canEdit?: boolean; canAdmin?: boolean
  onPatch?: (vid: string, body: unknown) => Promise<void>
  onRemove?: () => Promise<void>
} = {}) {
  return render(
    <VehicleDetailPanel
      vehicle={vehicle}
      canEdit={opts.canEdit ?? true}
      canAdmin={opts.canAdmin ?? true}
      onClose={vi.fn()}
      onPatch={opts.onPatch ?? vi.fn().mockResolvedValue(undefined)}
      onRemove={opts.onRemove ?? vi.fn().mockResolvedValue(undefined)}
      onTransferClick={vi.fn()}
    />,
  )
}

describe('VehicleDetailPanel', () => {
  it('renders nothing meaningful when vehicle is null', () => {
    renderPanel(null)
    expect(screen.queryByText('ABCD12')).not.toBeInTheDocument()
  })

  it('shows the plate, type and document checklist', () => {
    renderPanel(VEHICLE)
    expect(screen.getByText('ABCD12')).toBeInTheDocument()
    expect(screen.getByText('Padrón')).toBeInTheDocument()
  })

  it('calls onPatch with the updated governance field when a status select changes', async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined)
    renderPanel(VEHICLE, { onPatch })
    fireEvent.change(screen.getByLabelText('Estado de Póliza RC'), { target: { value: 'ok' } })
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith('v1', {
      governance: expect.objectContaining({ poliza_rc: 'ok', padron: 'ok' }),
    }))
  })

  it('saves edited plate/type/expiry dates when "Guardar" is clicked', async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined)
    renderPanel(VEHICLE, { onPatch })
    fireEvent.change(screen.getByLabelText('Vencimiento permiso de circulación'), { target: { value: '2030-05-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith('v1', {
      type: 'Tractocamión', plate: 'ABCD12',
      governance: expect.objectContaining({ circ_permit_expiry: '2030-05-01' }),
    }))
  })

  it('shows a "Transferir a otra empresa" button only for canAdmin', () => {
    renderPanel(VEHICLE, { canAdmin: false })
    expect(screen.queryByRole('button', { name: /Transferir/ })).not.toBeInTheDocument()
  })

  it('does not show the transfer button when onTransferClick is not provided (trailers)', () => {
    render(
      <VehicleDetailPanel
        vehicle={VEHICLE} canEdit={true} canAdmin={true}
        onClose={vi.fn()} onPatch={vi.fn().mockResolvedValue(undefined)}
        onRemove={vi.fn().mockResolvedValue(undefined)}
      />,
    )
    expect(screen.queryByRole('button', { name: /Transferir/ })).not.toBeInTheDocument()
  })

  it('shows "Eliminar equipo" only when canEdit, and calls onRemove when clicked', async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined)
    renderPanel(VEHICLE, { onRemove, canEdit: false })
    expect(screen.queryByRole('button', { name: /Eliminar equipo/ })).not.toBeInTheDocument()

    renderPanel(VEHICLE, { onRemove, canEdit: true })
    fireEvent.click(screen.getByRole('button', { name: /Eliminar equipo/ }))
    await waitFor(() => expect(onRemove).toHaveBeenCalled())
  })
})
