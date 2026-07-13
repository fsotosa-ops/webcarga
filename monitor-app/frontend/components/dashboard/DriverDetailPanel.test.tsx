import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DriverDetailPanel } from './DriverDetailPanel'
import type { TransporterDriver } from '@/lib/types'

const DRIVER: TransporterDriver = {
  id: 'd1', rut: '11111111-1', name: 'Juan Pérez',
  governance: {
    id_expiry: '2099-01-01', license_expiry: '2099-01-01',
    anexo_3_gc: 'ok', epp: null, das_odi: 'ok', hoja_de_vida: 'ok',
    cert_antecedentes: 'ok', validado_gc_driver: 'ok', contrato_trabajo: 'ok',
    creacion_gc_driver: 'ok', avance_total: 90,
  },
  baja_override: false, baja_reason: null,
}

function renderPanel(driver: TransporterDriver | null, opts: {
  canEdit?: boolean; canAdmin?: boolean
  onPatch?: (did: string, body: unknown) => Promise<void>
  onRemove?: () => Promise<void>
  onDeactivate?: (body: unknown) => Promise<void>
  onReactivate?: () => Promise<void>
} = {}) {
  return render(
    <DriverDetailPanel
      driver={driver}
      canEdit={opts.canEdit ?? true}
      canAdmin={opts.canAdmin ?? true}
      onClose={vi.fn()}
      onPatch={opts.onPatch ?? vi.fn().mockResolvedValue(undefined)}
      onRemove={opts.onRemove ?? vi.fn().mockResolvedValue(undefined)}
      onTransferClick={vi.fn()}
      onDeactivate={opts.onDeactivate ?? vi.fn().mockResolvedValue(undefined)}
      onReactivate={opts.onReactivate ?? vi.fn().mockResolvedValue(undefined)}
    />,
  )
}

describe('DriverDetailPanel', () => {
  it('renders nothing meaningful when driver is null', () => {
    renderPanel(null)
    expect(screen.queryByText('Juan Pérez')).not.toBeInTheDocument()
  })

  it('shows the driver name, rut and document checklist', () => {
    renderPanel(DRIVER)
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByText('11111111-1')).toBeInTheDocument()
    expect(screen.getByText('Anexo 3 GC')).toBeInTheDocument()
  })

  it('calls onPatch with the updated governance field when a status select changes', async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined)
    renderPanel(DRIVER, { onPatch })
    fireEvent.change(screen.getByLabelText('Estado de EPP'), { target: { value: 'ok' } })
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith('d1', {
      governance: expect.objectContaining({ epp: 'ok', anexo_3_gc: 'ok' }),
    }))
  })

  it('does not show the status select when canEdit is false', () => {
    renderPanel(DRIVER, { canEdit: false })
    expect(screen.queryByLabelText('Estado de EPP')).not.toBeInTheDocument()
  })

  it('saves edited expiry dates when "Guardar" is clicked', async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined)
    renderPanel(DRIVER, { onPatch })
    fireEvent.change(screen.getByLabelText('Vencimiento cédula de identidad'), { target: { value: '2030-05-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith('d1', {
      rut: '11111111-1', name: 'Juan Pérez',
      governance: expect.objectContaining({ id_expiry: '2030-05-01', license_expiry: '2099-01-01' }),
    }))
  })

  it('shows a "Transferir a otra empresa" button only for canAdmin', () => {
    renderPanel(DRIVER, { canAdmin: false })
    expect(screen.queryByRole('button', { name: /Transferir/ })).not.toBeInTheDocument()
  })

  it('calls onTransferClick when the transfer button is clicked', () => {
    const onTransferClick = vi.fn()
    render(
      <DriverDetailPanel
        driver={DRIVER} canEdit={true} canAdmin={true}
        onClose={vi.fn()} onPatch={vi.fn().mockResolvedValue(undefined)}
        onRemove={vi.fn().mockResolvedValue(undefined)}
        onTransferClick={onTransferClick}
        onDeactivate={vi.fn().mockResolvedValue(undefined)}
        onReactivate={vi.fn().mockResolvedValue(undefined)}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Transferir/ }))
    expect(onTransferClick).toHaveBeenCalled()
  })

  it('shows "Eliminar conductor" only when canEdit, and calls onRemove when clicked', async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined)
    renderPanel(DRIVER, { onRemove, canEdit: false })
    expect(screen.queryByRole('button', { name: /Eliminar conductor/ })).not.toBeInTheDocument()

    renderPanel(DRIVER, { onRemove, canEdit: true })
    fireEvent.click(screen.getByRole('button', { name: /Eliminar conductor/ }))
    await waitFor(() => expect(onRemove).toHaveBeenCalled())
  })

  it('shows "Dar de baja" for an active driver, opens the reason modal, and calls onDeactivate on confirm', async () => {
    const onDeactivate = vi.fn().mockResolvedValue(undefined)
    renderPanel(DRIVER, { onDeactivate })
    expect(screen.queryByRole('button', { name: 'Reactivar' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dar de baja' }))
    expect(screen.getByText(/Dar de baja: conductor/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar baja' }))
    await waitFor(() => expect(onDeactivate).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'documentacion_vencida' }),
    ))
  })

  it('shows "Reactivar" for a driver with baja_override, and calls onReactivate when clicked', () => {
    const onReactivate = vi.fn().mockResolvedValue(undefined)
    renderPanel({ ...DRIVER, baja_override: true, baja_reason: 'documentacion_vencida' }, { onReactivate })
    expect(screen.queryByRole('button', { name: 'Dar de baja' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reactivar' }))
    expect(onReactivate).toHaveBeenCalled()
  })

  it('does not show baja/reactivar buttons when canAdmin is false', () => {
    renderPanel(DRIVER, { canAdmin: false })
    expect(screen.queryByRole('button', { name: 'Dar de baja' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reactivar' })).not.toBeInTheDocument()
  })
})
