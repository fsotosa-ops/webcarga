import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { EquipmentCloseDayDialog } from './EquipmentCloseDayDialog'
import type { EquipmentClosureStatus, EquipmentDayStatusRow, UnassignedReasonMeta } from '@/lib/types'

vi.mock('@/lib/api/equipmentClosures', () => ({
  equipmentClosuresApi: { get: vi.fn(), setReasonBatch: vi.fn(), close: vi.fn() },
  isEquipmentClosePendingError: () => false,
}))

const REASONS: UnassignedReasonMeta[] = [{ id: 'panne', label: 'Panne' }]

function tractoreoRow(overrides: Partial<EquipmentDayStatusRow> = {}): EquipmentDayStatusRow {
  return {
    asset_id: 'a1', tractor_plate: 'ABCD12', carrier_id: 'c1', carrier_name: 'Transportes Sur',
    fleet_service_type_label: null, fleet_service_type_bg_color: null, fleet_service_type_text_color: null,
    status: 'ASSIGNED', requires_motivo: true, unassigned_reason_id: null, unassigned_reason_label: null,
    resolved_by: null, resolved_at: null, driver_id: null, driver_name: null, last_known_origin: null,
    ...overrides,
  }
}

const STATUS: EquipmentClosureStatus = {
  business_date: '2026-08-02',
  closed: false,
  closure: null,
  tractoreo: {
    summary: { total: 3, assigned: 1, unassigned: 2, utilization_pct: 33.3 },
    equipment: [
      tractoreoRow({ asset_id: 'a1', tractor_plate: 'ABCD12', status: 'ASSIGNED' }),
      tractoreoRow({ asset_id: 'a2', tractor_plate: 'WXYZ99', status: 'UNASSIGNED' }),
      tractoreoRow({ asset_id: 'a3', tractor_plate: 'ZZZZ99', status: 'UNASSIGNED', unassigned_reason_id: 'panne', unassigned_reason_label: 'Panne' }),
    ],
    pending_count: 1,
  },
  equipos_completos: {
    summary: { total: 2, assigned: 1, unassigned: 1, utilization_pct: 50.0 },
    by_carrier: [
      { carrier_id: 'c2', carrier_name: 'Equipos Sur', enrolled: 2, assigned: 1, unassigned: 1 },
    ],
  },
}

function renderDialog(props: Partial<Parameters<typeof EquipmentCloseDayDialog>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <EquipmentCloseDayDialog
        open fecha="2026-08-02" canAdmin={false} unassignedReasons={REASONS}
        onClose={vi.fn()} onOpenFleetCenter={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
  vi.mocked(equipmentClosuresApi.get).mockReset().mockResolvedValue(STATUS)
  vi.mocked(equipmentClosuresApi.setReasonBatch).mockReset()
  vi.mocked(equipmentClosuresApi.close).mockReset()
})

describe('EquipmentCloseDayDialog', () => {
  it('no renderiza nada cuando open=false', () => {
    renderDialog({ open: false })
    expect(screen.queryByText(/Cerrar el día/)).not.toBeInTheDocument()
  })

  it('muestra el resumen de Tractoreo y solo los tractos pendientes', async () => {
    renderDialog()
    expect(await screen.findByText('Total')).toBeInTheDocument()
    expect(screen.getByText('WXYZ99')).toBeInTheDocument()
    // ABCD12 (ASSIGNED) no requiere acción
    expect(screen.queryByText('ABCD12')).not.toBeInTheDocument()
    // ZZZZ99 (UNASSIGNED, ya con motivo) tampoco
    expect(screen.queryByText('ZZZZ99')).not.toBeInTheDocument()
  })

  it('muestra el Tipo Vehículo de cada tracto, o "Sin clasificar" si no tiene', async () => {
    const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
    vi.mocked(equipmentClosuresApi.get).mockResolvedValue({
      ...STATUS,
      tractoreo: {
        ...STATUS.tractoreo,
        equipment: [
          tractoreoRow({
            asset_id: 'a2', tractor_plate: 'WXYZ99', status: 'UNASSIGNED',
            fleet_service_type_label: 'Tractoreo', fleet_service_type_bg_color: '#eff6ff', fleet_service_type_text_color: '#1d4ed8',
          }),
        ],
      },
    })
    renderDialog()
    await screen.findByText('WXYZ99')
    expect(screen.getByText('Tractoreo')).toBeInTheDocument()
  })

  it('clickear "Sin asignar" muestra los tractos que ya tienen motivo, con su select', async () => {
    renderDialog()
    await screen.findByText('WXYZ99')
    fireEvent.click(screen.getByRole('button', { name: /Sin asignar/ }))
    expect(await screen.findByText('ZZZZ99')).toBeInTheDocument()
    const row = screen.getByText('ZZZZ99').closest('tr')!
    expect(within(row).getByRole('combobox')).toHaveValue('panne')
  })

  it('muestra el resumen de Equipos Completos por empresa, sin acción posible', async () => {
    renderDialog()
    expect(await screen.findByText('Equipos Sur')).toBeInTheDocument()
    const row = screen.getByText('Equipos Sur').closest('tr')!
    expect(within(row).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(row).queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('setea el motivo de un tracto individual', async () => {
    const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
    renderDialog()
    await screen.findByText('WXYZ99')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'panne' } })
    await waitFor(() => expect(equipmentClosuresApi.setReasonBatch).toHaveBeenCalledWith('2026-08-02', ['a2'], 'panne'))
  })

  it('selección masiva: aplica el mismo motivo a varios tractos seleccionados', async () => {
    const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
    vi.mocked(equipmentClosuresApi.get).mockResolvedValue({
      ...STATUS,
      tractoreo: {
        ...STATUS.tractoreo,
        equipment: [
          ...STATUS.tractoreo.equipment,
          tractoreoRow({ asset_id: 'a4', tractor_plate: 'BBBB11', status: 'UNASSIGNED' }),
        ],
        pending_count: 2,
      },
    })
    renderDialog()
    await screen.findByText('WXYZ99')
    fireEvent.click(screen.getByRole('checkbox', { name: /WXYZ99/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /BBBB11/ }))

    expect(screen.getByText('2 seleccionados')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'Motivo para la selección' }), { target: { value: 'panne' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar a todos' }))

    await waitFor(() =>
      expect(equipmentClosuresApi.setReasonBatch).toHaveBeenCalledWith('2026-08-02', ['a2', 'a4'], 'panne'),
    )
  })

  it('el link "Ver equipos disponibles" llama a onOpenFleetCenter', async () => {
    const onOpenFleetCenter = vi.fn()
    renderDialog({ onOpenFleetCenter })
    await screen.findByText(/Cerrar el día/)
    fireEvent.click(screen.getByText('Ver equipos disponibles'))
    expect(onOpenFleetCenter).toHaveBeenCalled()
  })

  it('bloquea el cierre mientras haya tractos de Tractoreo pendientes', async () => {
    renderDialog()
    const closeBtn = await screen.findByRole('button', { name: /Cerrar día/ })
    expect(closeBtn).toBeDisabled()
  })

  it('cierra el día cuando no hay pendientes de Tractoreo (Equipos Completos nunca bloquea)', async () => {
    const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
    vi.mocked(equipmentClosuresApi.get).mockResolvedValue({
      ...STATUS,
      tractoreo: { ...STATUS.tractoreo, pending_count: 0 },
    })
    vi.mocked(equipmentClosuresApi.close).mockResolvedValue({ ok: true, business_date: '2026-08-02', overridden: 0 })
    renderDialog()
    const closeBtn = await screen.findByRole('button', { name: /Cerrar día/ })
    expect(closeBtn).not.toBeDisabled()
    fireEvent.click(closeBtn)
    await waitFor(() => expect(equipmentClosuresApi.close).toHaveBeenCalledWith('2026-08-02', false, ''))
  })

  it('llama a onClose al hacer click en la X', async () => {
    const onClose = vi.fn()
    renderDialog({ onClose })
    await screen.findByText(/Cerrar el día/)
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(onClose).toHaveBeenCalled()
  })
})
