import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CloseDayDialog } from './CloseDayDialog'
import type { DailyClosureStatus, UnassignedReasonMeta } from '@/lib/types'

vi.mock('@/lib/api/dailyClosures', () => ({
  dailyClosuresApi: { get: vi.fn(), setReason: vi.fn(), close: vi.fn() },
  isClosePendingError: () => false,
}))

const REASONS: UnassignedReasonMeta[] = [{ id: 'pana', label: 'Pana' }]

const STATUS: DailyClosureStatus = {
  business_date: '2026-07-21',
  closed: false,
  closure: null,
  total_drivers: 3,
  assigned_count: 1,
  unassigned_count: 1,
  mismatch_count: 1,
  pending_count: 2,
  drivers: [
    { driver_id: 'd1', full_name: 'Juan Pérez', tax_id: '11111111-1', carrier_id: 'c1', carrier_name: 'Transportes Sur', status: 'ASSIGNED', unassigned_reason_id: null, unassigned_reason_label: null, resolved_by: null, resolved_at: null, client_names: [], driver_pending_docs_critical: null, suggested_reason_id: null },
    { driver_id: 'd2', full_name: 'Ana Soto', tax_id: '22222222-2', carrier_id: 'c1', carrier_name: 'Transportes Sur', status: 'UNASSIGNED', unassigned_reason_id: null, unassigned_reason_label: null, resolved_by: null, resolved_at: null, client_names: [], driver_pending_docs_critical: null, suggested_reason_id: null },
    { driver_id: 'd3', full_name: 'Luis Rojas', tax_id: '33333333-3', carrier_id: 'c3', carrier_name: 'Rios Ltda', status: 'MISMATCH', unassigned_reason_id: null, unassigned_reason_label: null, resolved_by: null, resolved_at: null, client_names: [], driver_pending_docs_critical: null, suggested_reason_id: null },
    { driver_id: 'd4', full_name: 'Carla Díaz', tax_id: '44444444-4', carrier_id: 'c1', carrier_name: 'Transportes Sur', status: 'UNASSIGNED', unassigned_reason_id: 'pana', unassigned_reason_label: 'Pana', resolved_by: 'admin', resolved_at: '2026-07-21T10:00:00Z', client_names: [], driver_pending_docs_critical: null, suggested_reason_id: null },
  ],
}

function renderDialog(props: Partial<Parameters<typeof CloseDayDialog>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CloseDayDialog open fecha="2026-07-21" canAdmin={false} unassignedReasons={REASONS} onClose={vi.fn()} {...props} />
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
  vi.mocked(dailyClosuresApi.get).mockReset().mockResolvedValue(STATUS)
  vi.mocked(dailyClosuresApi.setReason).mockReset()
  vi.mocked(dailyClosuresApi.close).mockReset()
})

describe('CloseDayDialog', () => {
  it('no renderiza nada cuando open=false', () => {
    renderDialog({ open: false })
    expect(screen.queryByText(/Cerrar el día/)).not.toBeInTheDocument()
  })

  it('muestra el resumen y solo los conductores pendientes', async () => {
    renderDialog()
    expect(await screen.findByText('Total')).toBeInTheDocument()
    expect(screen.getByText('Ana Soto')).toBeInTheDocument()
    expect(screen.getByText('Luis Rojas')).toBeInTheDocument()
    // Juan Pérez (ASSIGNED) no aparece en la lista de pendientes
    expect(screen.queryByText('Juan Pérez')).not.toBeInTheDocument()
    // Carla Díaz (UNASSIGNED, ya con motivo) tampoco — no requiere acción
    expect(screen.queryByText('Carla Díaz')).not.toBeInTheDocument()
  })

  // Ronda 45: las tiles de resumen pasan a ser clickeables y filtran la
  // tabla por categoría completa, no solo lo pendiente.
  it('clickear la tile "Asignados" muestra el roster completo de asignados, incluidos los que no requieren acción', async () => {
    renderDialog()
    await screen.findByText('Ana Soto')
    expect(screen.queryByText('Juan Pérez')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Asignados/ }))

    expect(await screen.findByText('Juan Pérez')).toBeInTheDocument()
  })

  it('clickear la tile activa de nuevo vuelve a la vista de pendientes', async () => {
    renderDialog()
    const tile = await screen.findByRole('button', { name: /Asignados/ })
    fireEvent.click(tile)
    await screen.findByText('Juan Pérez')

    fireEvent.click(tile)

    await waitFor(() => expect(screen.queryByText('Juan Pérez')).not.toBeInTheDocument())
  })

  it('clickear "No asignados" muestra conductores que ya tienen motivo asignado, con su select para cambiarlo', async () => {
    renderDialog()
    await screen.findByText('Ana Soto')
    expect(screen.queryByText('Carla Díaz')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /No asignados/ }))

    expect(await screen.findByText('Carla Díaz')).toBeInTheDocument()
    const row = screen.getByText('Carla Díaz').closest('tr')!
    expect(within(row).getByRole('combobox')).toHaveValue('pana')
  })

  it('"Revisar en Empresas" en un conductor MISMATCH es un link real a su empresa, no texto estático', async () => {
    renderDialog()
    await screen.findByText('Luis Rojas')
    const link = screen.getByRole('link', { name: /Revisar en Empresas/ })
    expect(link).toHaveAttribute('href', '/dashboard/transportistas/empresa/c3')
  })

  it('sets el motivo de un conductor no asignado', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    renderDialog()
    await screen.findByText('Ana Soto')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pana' } })
    await waitFor(() => expect(dailyClosuresApi.setReason).toHaveBeenCalledWith('d2', '2026-07-21', 'pana'))
  })

  it('bloquea el cierre mientras haya pendientes', async () => {
    renderDialog()
    const closeBtn = await screen.findByRole('button', { name: /Cerrar día/ })
    expect(closeBtn).toBeDisabled()
  })

  it('cierra el día cuando no hay pendientes', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue({
      ...STATUS, pending_count: 0, unassigned_count: 0, mismatch_count: 0, assigned_count: 3,
      drivers: STATUS.drivers.map(d => ({ ...d, status: 'ASSIGNED' as const })),
    })
    vi.mocked(dailyClosuresApi.close).mockResolvedValue({ ok: true, business_date: '2026-07-21', overridden: 0 })
    renderDialog()
    const closeBtn = await screen.findByRole('button', { name: /Cerrar día/ })
    expect(closeBtn).not.toBeDisabled()
    fireEvent.click(closeBtn)
    await waitFor(() => expect(dailyClosuresApi.close).toHaveBeenCalledWith('2026-07-21', false, ''))
  })

  it('llama a onClose al hacer click en la X', async () => {
    const onClose = vi.fn()
    renderDialog({ onClose })
    await screen.findByText(/Cerrar el día/)
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('muestra una sugerencia de motivo clickeable cuando hay alerta crítica de compliance sin motivo asignado', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue({
      business_date: '2026-07-22', closed: false, closure: null,
      total_drivers: 1, assigned_count: 0, unassigned_count: 1, mismatch_count: 0, pending_count: 1,
      drivers: [{
        driver_id: 'd1', full_name: 'Juan Pérez', tax_id: null, carrier_id: null, carrier_name: null,
        status: 'UNASSIGNED', unassigned_reason_id: null, unassigned_reason_label: null,
        resolved_by: null, resolved_at: null, client_names: [],
        driver_pending_docs_critical: true, suggested_reason_id: 'r-doc-vencida',
      }],
    })
    renderDialog({
      fecha: '2026-07-22',
      unassignedReasons: [{ id: 'r-doc-vencida', label: 'Documentación vencida' }],
    })
    const hint = await screen.findByText('Sugerido: Documentación vencida')
    fireEvent.click(hint)
    await waitFor(() => expect(dailyClosuresApi.setReason).toHaveBeenCalledWith('d1', '2026-07-22', 'r-doc-vencida'))
  })

  it('no muestra sugerencia cuando no hay alerta crítica de compliance', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue({
      business_date: '2026-07-22', closed: false, closure: null,
      total_drivers: 1, assigned_count: 0, unassigned_count: 1, mismatch_count: 0, pending_count: 1,
      drivers: [{
        driver_id: 'd1', full_name: 'Juan Pérez', tax_id: null, carrier_id: null, carrier_name: null,
        status: 'UNASSIGNED', unassigned_reason_id: null, unassigned_reason_label: null,
        resolved_by: null, resolved_at: null, client_names: [],
        driver_pending_docs_critical: false, suggested_reason_id: null,
      }],
    })
    renderDialog({ fecha: '2026-07-22', unassignedReasons: [] })
    await screen.findByText('Juan Pérez')
    expect(screen.queryByText(/Sugerido:/)).not.toBeInTheDocument()
  })
})
