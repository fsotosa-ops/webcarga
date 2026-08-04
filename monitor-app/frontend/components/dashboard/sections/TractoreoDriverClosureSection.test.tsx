import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TractoreoDriverClosureSection } from './TractoreoDriverClosureSection'
import type { DailyClosureStatus, UnassignedReasonMeta } from '@/lib/types'

vi.mock('@/lib/api/dailyClosures', () => ({
  dailyClosuresApi: { get: vi.fn(), setReason: vi.fn(), setReasonBatch: vi.fn() },
}))

const REASONS: UnassignedReasonMeta[] = [{ id: 'pana', label: 'Pana' }]

function driverRow(overrides: Partial<DailyClosureStatus['drivers'][number]> = {}) {
  return {
    driver_id: 'd1', full_name: 'Juan Pérez', tax_id: '11111111-1', carrier_id: 'c1', carrier_name: 'Transportes Sur',
    status: 'UNASSIGNED' as const, unassigned_reason_id: null, unassigned_reason_label: null,
    resolved_by: null, resolved_at: null, client_names: [], driver_pending_docs_critical: null,
    suggested_reason_id: null, trip_id: null, last_known_tractor_plate: null, last_known_operation_type: null,
    ...overrides,
  }
}

const STATUS: DailyClosureStatus = {
  business_date: '2026-08-04',
  closed: false,
  closure: null,
  total_drivers: 3,
  assigned_count: 1,
  unassigned_count: 1,
  mismatch_count: 1,
  pending_count: 2,
  pre_cierre: {
    auto_resolved: [],
    escalations: {
      PATENTE_NO_REGISTRADA: [], EMPRESA_NO_RECONOCIDA: [], CONDUCTOR_NO_REGISTRADO: [],
      EMPRESA_ONBOARDING: [], SIN_TIPO_OPERACION: [],
    },
  },
  drivers: [
    driverRow({ driver_id: 'd1', full_name: 'Ana Soto', status: 'UNASSIGNED', last_known_tractor_plate: 'ABCD12', last_known_operation_type: 'Tractoreo' }),
    driverRow({ driver_id: 'd2', full_name: 'Luis Rojas', status: 'MISMATCH', trip_id: 't1' }),
    driverRow({ driver_id: 'd3', full_name: 'Juan Pérez', status: 'ASSIGNED' }),
    driverRow({ driver_id: 'd4', full_name: 'Carla Díaz', status: 'UNASSIGNED', unassigned_reason_id: 'pana', unassigned_reason_label: 'Pana' }),
  ],
}

function renderSection(props: Partial<Parameters<typeof TractoreoDriverClosureSection>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TractoreoDriverClosureSection
        fecha="2026-08-04" unassignedReasons={REASONS}
        onSelectTrip={vi.fn()} onCreateManualTrip={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
  vi.mocked(dailyClosuresApi.get).mockReset().mockResolvedValue(STATUS)
  vi.mocked(dailyClosuresApi.setReason).mockReset()
  vi.mocked(dailyClosuresApi.setReasonBatch).mockReset().mockResolvedValue([])
})

describe('TractoreoDriverClosureSection', () => {
  it('muestra los pendientes (no asignados sin motivo + mismatch) y no los que no requieren acción', async () => {
    renderSection()
    expect(await screen.findByText('Ana Soto')).toBeInTheDocument()
    expect(screen.getByText('Luis Rojas')).toBeInTheDocument()
    expect(screen.queryByText('Juan Pérez')).not.toBeInTheDocument()
    expect(screen.queryByText('Carla Díaz')).not.toBeInTheDocument()
  })

  it('muestra el tracto habitual y el chip de tipo de operación, con fallback cuando no hay datos', async () => {
    renderSection()
    expect(await screen.findByText('ABCD12')).toBeInTheDocument()
    expect(screen.getByText('Tractoreo')).toBeInTheDocument()
    // Luis Rojas (MISMATCH) no tiene tracto habitual en el fixture
    expect(screen.getAllByText('Sin tracto reciente').length).toBeGreaterThan(0)
  })

  it('el checkbox de selección masiva solo aparece en filas UNASSIGNED', async () => {
    renderSection()
    await screen.findByText('Ana Soto')
    expect(screen.getByRole('checkbox', { name: /Ana Soto/ })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /Luis Rojas/ })).not.toBeInTheDocument()
  })

  it('selección masiva: aplica el mismo motivo a varios conductores seleccionados', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    renderSection()
    await screen.findByText('Ana Soto')

    fireEvent.click(screen.getByRole('checkbox', { name: /Ana Soto/ }))
    expect(screen.getByText('1 seleccionados')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Motivo para la selección'), { target: { value: 'pana' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar a todos' }))

    await waitFor(() => {
      expect(dailyClosuresApi.setReasonBatch).toHaveBeenCalledWith('2026-08-04', ['d1'], 'pana')
    })
  })

  it('botón "Crear viaje manual" en fila UNASSIGNED llama onCreateManualTrip con driver_id/full_name', async () => {
    const onCreateManualTrip = vi.fn()
    renderSection({ onCreateManualTrip })
    await screen.findByText('Ana Soto')

    fireEvent.click(screen.getByRole('button', { name: /Crear viaje manual/ }))

    expect(onCreateManualTrip).toHaveBeenCalledWith('d1', 'Ana Soto')
  })

  it('MISMATCH con trip_id muestra "Ver viaje" y llama onSelectTrip', async () => {
    const onSelectTrip = vi.fn()
    renderSection({ onSelectTrip })
    await screen.findByText('Luis Rojas')

    fireEvent.click(screen.getByRole('button', { name: /Ver viaje/ }))

    expect(onSelectTrip).toHaveBeenCalledWith('t1')
  })

  it('clickear la tile "Total" muestra el roster completo, incluidos los que no requieren acción', async () => {
    renderSection()
    await screen.findByText('Ana Soto')

    fireEvent.click(screen.getByText('Total'))

    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByText('Carla Díaz')).toBeInTheDocument()
  })
})
