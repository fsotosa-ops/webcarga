import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FlotaDelDiaSection } from './FlotaDelDiaSection'
import type { DailyClosureStatus, FleetDailyOverviewResponse, UnassignedReasonMeta } from '@/lib/types'

vi.mock('@/lib/api/dailyClosures', () => ({
  dailyClosuresApi: { get: vi.fn(), setReason: vi.fn(), setReasonBatch: vi.fn() },
}))

vi.mock('@/lib/api/trips', () => ({
  tripsApi: { fleetDailyOverview: vi.fn() },
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

const DRIVERS_STATUS: DailyClosureStatus = {
  business_date: '2026-08-04', closed: false, closure: null,
  total_drivers: 4, assigned_count: 1, unassigned_count: 2, mismatch_count: 1, pending_count: 2,
  pre_cierre: {
    auto_resolved: [],
    escalations: {
      PATENTE_NO_REGISTRADA: [], EMPRESA_NO_RECONOCIDA: [], CONDUCTOR_NO_REGISTRADO: [],
      EMPRESA_ONBOARDING: [], SIN_TIPO_OPERACION: [],
    },
  },
  drivers: [
    driverRow({ driver_id: 'd1', full_name: 'Ana Soto', carrier_name: 'Transportes Sur', status: 'UNASSIGNED', last_known_tractor_plate: 'ABCD12', last_known_operation_type: 'Tractoreo' }),
    driverRow({ driver_id: 'd2', full_name: 'Luis Rojas', carrier_name: 'Transportes Norte', status: 'MISMATCH', trip_id: 't1' }),
    driverRow({ driver_id: 'd3', full_name: 'Juan Pérez', carrier_name: 'Transportes Sur', status: 'ASSIGNED' }),
    driverRow({ driver_id: 'd4', full_name: 'Carla Díaz', carrier_name: 'Transportes Sur', status: 'UNASSIGNED', unassigned_reason_id: 'pana', unassigned_reason_label: 'Pana' }),
  ],
}

const FLEET: FleetDailyOverviewResponse = {
  fecha: '2026-08-04',
  categories: [
    { category: 'TRACTOREO', assigned: 1, unassigned: 2, utilization_pct: 33.3 },
    { category: 'EQUIPO_COMPLETO', assigned: 1, unassigned: 1, utilization_pct: 50.0 },
    { category: 'SIN_CLASIFICAR', assigned: 0, unassigned: 0, utilization_pct: 0 },
  ],
  equipment: [
    {
      asset_id: 'a1', tractor_plate: 'XYZ111', carrier_id: 'c2', carrier_name: 'RPS Logística',
      categories: ['EQUIPO_COMPLETO'], con_carga: true, trip_id: 't2', client_name: 'Walmart', origin: null,
    },
    {
      asset_id: 'a2', tractor_plate: 'XYZ222', carrier_id: 'c3', carrier_name: 'Equipos Sur',
      categories: ['EQUIPO_COMPLETO'], con_carga: false, trip_id: null, client_name: null, origin: null,
    },
    {
      asset_id: 'a3', tractor_plate: 'WWWW11', carrier_id: 'c1', carrier_name: 'Transportes Sur',
      categories: ['TRACTOREO'], con_carga: true, trip_id: 't3', client_name: 'Iansa', origin: null,
    },
  ],
}

function renderSection(props: Partial<Parameters<typeof FlotaDelDiaSection>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <FlotaDelDiaSection
        fecha="2026-08-04" unassignedReasons={REASONS}
        onSelectTrip={vi.fn()} onCreateManualTrip={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
  const { tripsApi } = await import('@/lib/api/trips')
  vi.mocked(dailyClosuresApi.get).mockReset().mockResolvedValue(DRIVERS_STATUS)
  vi.mocked(dailyClosuresApi.setReason).mockReset()
  vi.mocked(dailyClosuresApi.setReasonBatch).mockReset().mockResolvedValue([])
  vi.mocked(tripsApi.fleetDailyOverview).mockReset().mockResolvedValue(FLEET)
})

describe('FlotaDelDiaSection', () => {
  it('la tabla de Tractoreo se muestra siempre, incluidos los nombres de conductores, aunque no haya pendientes', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue({
      ...DRIVERS_STATUS,
      pending_count: 0,
      mismatch_count: 0,
      drivers: [
        driverRow({ driver_id: 'd3', full_name: 'Juan Pérez', carrier_name: 'Transportes Sur', status: 'ASSIGNED' }),
      ],
    })
    renderSection()
    // Con category='' y sin pendientes, categoryFiltered queda vacío — la
    // tabla igual debe renderizarse (misma estructura que Equipo Completo).
    expect(await screen.findByText('Sin resultados en esta categoría')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Total'))

    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
  })

  it('los tiles de Tractoreo y Equipo Completo tienen la misma estructura de 3 líneas (label, conteos, % utilización)', async () => {
    renderSection()
    await screen.findByText('Ana Soto')

    const tractoreoTile = screen.getByRole('button', { name: /Tractoreo/ })
    const equipoTile = screen.getByRole('button', { name: /Equipo Completo/ })
    expect(within(tractoreoTile).getByText(/% utilización/)).toBeInTheDocument()
    expect(within(equipoTile).getByText(/% utilización/)).toBeInTheDocument()
  })

  it('por defecto muestra Tractoreo, con los pendientes (no asignados sin motivo + mismatch)', async () => {
    renderSection()
    expect(await screen.findByText('Ana Soto')).toBeInTheDocument()
    expect(screen.getByText('Luis Rojas')).toBeInTheDocument()
    expect(screen.queryByText('Juan Pérez')).not.toBeInTheDocument()
    expect(screen.queryByText('Carla Díaz')).not.toBeInTheDocument()
  })

  it('muestra el tracto habitual y el chip de tipo de operación en la fila de Tractoreo', async () => {
    renderSection()
    await screen.findByText('ABCD12')
    const row = screen.getByText('ABCD12').closest('tr')!
    expect(within(row).getByText('Tractoreo')).toBeInTheDocument()
  })

  it('el toggle Equipo Completo cambia la vista a patente↔empresa, misma estructura de tabla', async () => {
    renderSection()
    await screen.findByText('Ana Soto')

    fireEvent.click(screen.getByRole('button', { name: /Equipo Completo/ }))

    expect(await screen.findByText('XYZ111')).toBeInTheDocument()
    expect(screen.getByText('XYZ222')).toBeInTheDocument()
    // Un equipo TRACTOREO en el fixture de flota no debe filtrarse a la vista Equipo Completo
    expect(screen.queryByText('WWWW11')).not.toBeInTheDocument()
    expect(screen.queryByText('Ana Soto')).not.toBeInTheDocument()
  })

  it('en Equipo Completo, "Con carga" muestra "Ver viaje" y llama onSelectTrip', async () => {
    const onSelectTrip = vi.fn()
    renderSection({ onSelectTrip })
    fireEvent.click(await screen.findByRole('button', { name: /Equipo Completo/ }))
    await screen.findByText('XYZ111')

    fireEvent.click(screen.getByRole('button', { name: 'Ver viaje' }))

    expect(onSelectTrip).toHaveBeenCalledWith('t2')
  })

  it('tile "Total" en Tractoreo muestra el roster completo, incluidos los que no requieren acción', async () => {
    renderSection()
    await screen.findByText('Ana Soto')

    fireEvent.click(screen.getByText('Total'))

    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByText('Carla Díaz')).toBeInTheDocument()
  })

  it('el buscador filtra por conductor, empresa o tracto en Tractoreo', async () => {
    renderSection()
    await screen.findByText('Ana Soto')
    fireEvent.click(screen.getByText('Total'))
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'Norte' } })

    expect(screen.getByText('Luis Rojas')).toBeInTheDocument()
    expect(screen.queryByText('Juan Pérez')).not.toBeInTheDocument()
    expect(screen.queryByText('Ana Soto')).not.toBeInTheDocument()
  })

  it('el checkbox de selección masiva solo aparece en filas UNASSIGNED de Tractoreo', async () => {
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

  it('la selección masiva no aparece al pasar a Equipo Completo (no tiene acción de cierre)', async () => {
    renderSection()
    await screen.findByText('Ana Soto')
    fireEvent.click(screen.getByRole('checkbox', { name: /Ana Soto/ }))
    expect(screen.getByText('1 seleccionados')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Equipo Completo/ }))

    expect(screen.queryByText(/seleccionados/)).not.toBeInTheDocument()
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

    const row = screen.getByText('Luis Rojas').closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: /Ver viaje/ }))

    expect(onSelectTrip).toHaveBeenCalledWith('t1')
  })

  it('MISMATCH sin trip_id muestra "Revisar en Empresas" con link a la ficha del carrier', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue({
      ...DRIVERS_STATUS,
      drivers: [
        driverRow({ driver_id: 'd2', full_name: 'Luis Rojas', carrier_id: 'c9', status: 'MISMATCH', trip_id: null }),
      ],
    })
    renderSection()
    await screen.findByText('Luis Rojas')

    const link = screen.getByRole('link', { name: /Revisar en Empresas/ })
    expect(link).toHaveAttribute('href', '/dashboard/carriers/c9')
  })

  it('pagina Tractoreo cuando hay más de 10 pendientes', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    const many = Array.from({ length: 12 }, (_, i) =>
      driverRow({ driver_id: `p${i}`, full_name: `Conductor ${i}`, status: 'UNASSIGNED' }),
    )
    vi.mocked(dailyClosuresApi.get).mockResolvedValue({
      ...DRIVERS_STATUS, drivers: many, pending_count: 12,
    })
    renderSection()
    await screen.findByText('Conductor 0')

    expect(screen.getByText('Página 1 de 2')).toBeInTheDocument()
    expect(screen.queryByText('Conductor 11')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }))

    expect(await screen.findByText('Conductor 11')).toBeInTheDocument()
    expect(screen.queryByText('Conductor 0')).not.toBeInTheDocument()
  })

  it('pagina Equipo Completo cuando hay más de 10 equipos', async () => {
    const { tripsApi } = await import('@/lib/api/trips')
    const manyEquip = Array.from({ length: 12 }, (_, i) => ({
      asset_id: `e${i}`, tractor_plate: `PLT${i}`, carrier_id: 'c2', carrier_name: 'RPS Logística',
      categories: ['EQUIPO_COMPLETO'] as ('TRACTOREO' | 'EQUIPO_COMPLETO' | 'SIN_CLASIFICAR')[], con_carga: false, trip_id: null, client_name: null, origin: null,
    }))
    vi.mocked(tripsApi.fleetDailyOverview).mockResolvedValue({ ...FLEET, equipment: manyEquip })
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /Equipo Completo/ }))
    await screen.findByText('PLT0')

    expect(screen.getByText('Página 1 de 2')).toBeInTheDocument()
    expect(screen.queryByText('PLT11')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }))

    expect(await screen.findByText('PLT11')).toBeInTheDocument()
  })
})
