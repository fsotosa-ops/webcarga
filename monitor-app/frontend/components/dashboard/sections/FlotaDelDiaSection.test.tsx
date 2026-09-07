import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FlotaDelDiaSection } from './FlotaDelDiaSection'
import type { DailyClosureStatus, EquipmentClosureStatus, EquipmentDayStatusRow, UnassignedReasonMeta } from '@/lib/types'

vi.mock('@/lib/api/dailyClosures', () => ({
  dailyClosuresApi: { get: vi.fn(), setReason: vi.fn(), setReasonBatch: vi.fn() },
}))

vi.mock('@/lib/api/equipmentClosures', () => ({
  equipmentClosuresApi: { get: vi.fn(), setReason: vi.fn(), setReasonBatch: vi.fn() },
}))

const REASONS: UnassignedReasonMeta[] = [{ id: 'pana', label: 'Pana' }]

function driverRow(overrides: Partial<DailyClosureStatus['drivers'][number]> = {}) {
  return {
    driver_id: 'd1', full_name: 'Juan Pérez', tax_id: '11111111-1', carrier_id: 'c1', carrier_name: 'Transportes Sur',
    status: 'UNASSIGNED' as const, unassigned_reason_id: null, unassigned_reason_label: null,
    resolved_by: null, resolved_at: null, client_names: [], driver_pending_docs_critical: null,
    suggested_reason_id: null, trip_id: null, today_trip_id: null, last_known_tractor_plate: null, last_known_operation_type: null,
    ...overrides,
  }
}

function equipmentRow(overrides: Partial<EquipmentDayStatusRow> = {}): EquipmentDayStatusRow {
  return {
    asset_id: 'a1', tractor_plate: 'XYZ111', carrier_id: 'c2', carrier_name: 'RPS Logística',
    fleet_service_type_label: null, fleet_service_type_bg_color: null, fleet_service_type_text_color: null,
    status: 'UNASSIGNED', requires_motivo: false, unassigned_reason_id: null, unassigned_reason_label: null,
    resolved_by: null, resolved_at: null, driver_id: null, driver_name: null, last_known_origin: null,
    trip_id: null, trip_driver_id: null, trip_driver_name: null,
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
    driverRow({ driver_id: 'd3', full_name: 'Juan Pérez', carrier_name: 'Transportes Sur', status: 'ASSIGNED', today_trip_id: 't3' }),
    driverRow({ driver_id: 'd4', full_name: 'Carla Díaz', carrier_name: 'Transportes Sur', status: 'UNASSIGNED', unassigned_reason_id: 'pana', unassigned_reason_label: 'Pana' }),
  ],
}

const EQUIPMENT_STATUS: EquipmentClosureStatus = {
  business_date: '2026-08-04', closed: false, closure: null,
  // Reproduce en chico lo que el 03-09 traia en grande: tractos ASSIGNED con
  // conductor y tractos UNASSIGNED sin motivo. Los 43 de ese dia llegaban aca
  // y no los mostraba ninguna pestana.
  tractoreo: {
    summary: { total: 3, assigned: 2, unassigned: 1, utilization_pct: 66.7 },
    pending_count: 1,
    equipment: [
      equipmentRow({
        asset_id: 'tr1', tractor_plate: 'FCCP42', carrier_name: 'Dankar Logistic Spa',
        status: 'ASSIGNED', requires_motivo: true, trip_id: 'tt1',
        driver_id: 'h1', driver_name: 'Brian Celis (habitual)',
        trip_driver_id: 'v1', trip_driver_name: 'Celis Huerta Brian',
      }),
      equipmentRow({
        asset_id: 'tr2', tractor_plate: 'HKXW55', carrier_name: 'Comercializadora De Los Rios Ltda',
        status: 'ASSIGNED', requires_motivo: true, trip_id: 'tt2',
      }),
      equipmentRow({
        asset_id: 'tr3', tractor_plate: 'DTBY52', carrier_id: 'cf', carrier_name: 'Transportes La Fortaleza Spa',
        status: 'UNASSIGNED', requires_motivo: true,
      }),
    ],
  },
  equipos_completos: {
    summary: { total: 2, assigned: 1, unassigned: 1, utilization_pct: 50.0 },
    by_carrier: [],
    equipment: [
      equipmentRow({
        asset_id: 'a1', tractor_plate: 'XYZ111', carrier_name: 'RPS Logística', status: 'ASSIGNED',
        driver_id: 'e1', driver_name: 'Pedro Pérez', trip_id: 't2',
      }),
      equipmentRow({
        asset_id: 'a2', tractor_plate: 'XYZ222', carrier_name: 'Equipos Sur', status: 'UNASSIGNED',
        driver_id: null, driver_name: null,
      }),
    ],
  },
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
  const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
  vi.mocked(dailyClosuresApi.get).mockReset().mockResolvedValue(DRIVERS_STATUS)
  vi.mocked(dailyClosuresApi.setReason).mockReset()
  vi.mocked(dailyClosuresApi.setReasonBatch).mockReset().mockResolvedValue([])
  vi.mocked(equipmentClosuresApi.get).mockReset().mockResolvedValue(EQUIPMENT_STATUS)
  vi.mocked(equipmentClosuresApi.setReason).mockReset()
  vi.mocked(equipmentClosuresApi.setReasonBatch).mockReset().mockResolvedValue([])
})

describe('FlotaDelDiaSection', () => {
  it('la columna 2 siempre se llama "Conductor" y la 4 pasa de "Tracto habitual" a "Patente" al cambiar de eje', async () => {
    renderSection()
    await screen.findByText('Ana Soto')
    expect(screen.getByRole('columnheader', { name: 'Conductor' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Tracto habitual' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Equipo Completo/ }))

    expect(await screen.findByRole('columnheader', { name: 'Conductor' })).toBeInTheDocument()
    // En el eje tractos la unidad de la fila ES la patente, no un "equipo
    // habitual" del conductor: el encabezado dice lo que la columna contiene.
    expect(screen.getByRole('columnheader', { name: 'Patente' })).toBeInTheDocument()
  })

  it('por defecto muestra Conductores, con los pendientes (no asignados sin motivo + mismatch)', async () => {
    renderSection()
    expect(await screen.findByText('Ana Soto')).toBeInTheDocument()
    expect(screen.getByText('Luis Rojas')).toBeInTheDocument()
    expect(screen.queryByText('Juan Pérez')).not.toBeInTheDocument()
    expect(screen.queryByText('Carla Díaz')).not.toBeInTheDocument()
  })

  it('muestra el tracto habitual y el chip de tipo de operación en la fila de Conductores', async () => {
    renderSection()
    await screen.findByText('ABCD12')
    const row = screen.getByText('ABCD12').closest('tr')!
    expect(within(row).getByText('Tractoreo')).toBeInTheDocument()
  })

  it('el toggle Equipo Completo muestra el nombre del conductor habitual (o "Sin conductor habitual")', async () => {
    renderSection()
    await screen.findByText('Ana Soto')

    fireEvent.click(screen.getByRole('button', { name: /Equipo Completo/ }))
    await screen.findByText('Sin conductor habitual')
    fireEvent.click(screen.getByText('Total'))

    expect(await screen.findByText('Pedro Pérez')).toBeInTheDocument()
    expect(screen.getByText('Sin conductor habitual')).toBeInTheDocument()
    expect(screen.getByText('XYZ111')).toBeInTheDocument()
    expect(screen.getByText('XYZ222')).toBeInTheDocument()
    expect(screen.queryByText('Ana Soto')).not.toBeInTheDocument()
  })

  it('en Equipo Completo, "Asignado" con trip_id muestra "Ver viaje" y llama onSelectTrip', async () => {
    const onSelectTrip = vi.fn()
    renderSection({ onSelectTrip })
    fireEvent.click(await screen.findByRole('button', { name: /Equipo Completo/ }))
    await screen.findByText('Sin conductor habitual')
    fireEvent.click(screen.getByText('Total'))
    await screen.findByText('Pedro Pérez')

    fireEvent.click(screen.getByRole('button', { name: 'Ver viaje' }))

    expect(onSelectTrip).toHaveBeenCalledWith('t2')
  })

  it('en Equipo Completo, una fila "No asignado" tiene la misma funcionalidad editable que Conductores: motivo select', async () => {
    const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /Equipo Completo/ }))
    await screen.findByText('Sin conductor habitual')

    const row = screen.getByText('Sin conductor habitual').closest('tr')!
    fireEvent.change(within(row).getByRole('combobox'), { target: { value: 'pana' } })

    await waitFor(() => {
      expect(equipmentClosuresApi.setReason).toHaveBeenCalledWith('a2', '2026-08-04', 'pana')
    })
  })

  it('en Equipo Completo, "Crear viaje manual" solo aparece si se conoce el conductor habitual', async () => {
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /Equipo Completo/ }))
    await screen.findByText('Sin conductor habitual')

    // a2 no tiene driver_id — no debe ofrecer "Crear viaje manual"
    const row = screen.getByText('Sin conductor habitual').closest('tr')!
    expect(within(row).queryByRole('button', { name: /Crear viaje manual/ })).not.toBeInTheDocument()
  })

  it('tile "Total" en Conductores muestra el roster completo, incluidos los que no requieren acción', async () => {
    renderSection()
    await screen.findByText('Ana Soto')

    fireEvent.click(screen.getByText('Total'))

    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByText('Carla Díaz')).toBeInTheDocument()
  })

  it('el buscador filtra por conductor, empresa o tracto en Conductores', async () => {
    renderSection()
    await screen.findByText('Ana Soto')
    fireEvent.click(screen.getByText('Total'))
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'Norte' } })

    expect(screen.getByText('Luis Rojas')).toBeInTheDocument()
    expect(screen.queryByText('Juan Pérez')).not.toBeInTheDocument()
    expect(screen.queryByText('Ana Soto')).not.toBeInTheDocument()
  })

  it('el checkbox de selección masiva aparece en filas UNASSIGNED, en todos los ejes', async () => {
    renderSection()
    await screen.findByText('Ana Soto')
    expect(screen.getByRole('checkbox', { name: /Ana Soto/ })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /Luis Rojas/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Equipo Completo/ }))
    await screen.findByText('Sin conductor habitual')

    expect(screen.getByRole('checkbox', { name: /Sin conductor habitual/ })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /Pedro Pérez/ })).not.toBeInTheDocument()
  })

  it('selección masiva en Conductores: aplica el mismo motivo a varios conductores seleccionados', async () => {
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

  it('selección masiva en Equipo Completo: usa equipmentClosuresApi, no dailyClosuresApi', async () => {
    const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /Equipo Completo/ }))
    await screen.findByText('Sin conductor habitual')

    fireEvent.click(screen.getByRole('checkbox', { name: /Sin conductor habitual/ }))
    fireEvent.change(screen.getByLabelText('Motivo para la selección'), { target: { value: 'pana' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar a todos' }))

    await waitFor(() => {
      expect(equipmentClosuresApi.setReasonBatch).toHaveBeenCalledWith('2026-08-04', ['a2'], 'pana')
    })
  })

  it('botón "Crear viaje manual" en fila UNASSIGNED de Conductores llama onCreateManualTrip con driver_id/full_name', async () => {
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

  it('pagina Conductores cuando hay más de 10 pendientes', async () => {
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

  it('pagina Equipo Completo cuando hay más de 10 equipos sin asignar', async () => {
    const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
    const many = Array.from({ length: 12 }, (_, i) =>
      equipmentRow({ asset_id: `e${i}`, tractor_plate: `PLT${i}`, status: 'UNASSIGNED' }),
    )
    vi.mocked(equipmentClosuresApi.get).mockResolvedValue({
      ...EQUIPMENT_STATUS,
      equipos_completos: { ...EQUIPMENT_STATUS.equipos_completos, equipment: many },
    })
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: /Equipo Completo/ }))
    await screen.findByText('PLT0')

    expect(screen.getByText('Página 1 de 2')).toBeInTheDocument()
    expect(screen.queryByText('PLT11')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }))

    expect(await screen.findByText('PLT11')).toBeInTheDocument()
  })
  // ── Regresión del 2026-09-07 ──────────────────────────────────────────────
  // Pablo cerró el 03-09 y reportó cinco viajes que "no aparecen en el cierre,
  // ni como asignados ni como no asignados", más un error de "15 equipo(s) sin
  // resolver" sin listado. Los seis casos eran la misma causa: la pestaña que
  // decía "Tractoreo" mostraba conductores y `tractoreo.equipment` no lo leía
  // nadie. Estos tests fallan si esa lista vuelve a quedarse sin superficie.

  it('la vista "Tractos · Tractoreo" lista TRACTOS, no conductores', async () => {
    renderSection()
    await screen.findByText('Ana Soto')

    fireEvent.click(screen.getByRole('button', { name: /Tractos · Tractoreo/ }))
    fireEvent.click(await screen.findByText('Total'))

    expect(await screen.findByText('FCCP42')).toBeInTheDocument()
    expect(screen.getByText('HKXW55')).toBeInTheDocument()
    expect(screen.getByText('DTBY52')).toBeInTheDocument()
    // Ningún conductor del otro eje se cuela en esta tabla.
    expect(screen.queryByText('Ana Soto')).not.toBeInTheDocument()
    expect(screen.queryByText('Luis Rojas')).not.toBeInTheDocument()
  })

  it('un tracto asignado muestra el conductor DEL VIAJE, no el habitual del maestro', async () => {
    renderSection()
    await screen.findByText('Ana Soto')

    fireEvent.click(screen.getByRole('button', { name: /Tractos · Tractoreo/ }))
    fireEvent.click(await screen.findByText('Total'))

    const fila = (await screen.findByText('FCCP42')).closest('tr')!
    expect(within(fila).getByText('Celis Huerta Brian')).toBeInTheDocument()
    expect(within(fila).queryByText('Brian Celis (habitual)')).not.toBeInTheDocument()
  })

  it('un tracto asignado sin conductor por ninguna vía lo dice, en vez de fingir que el viaje va vacío', async () => {
    renderSection()
    await screen.findByText('Ana Soto')

    fireEvent.click(screen.getByRole('button', { name: /Tractos · Tractoreo/ }))
    fireEvent.click(await screen.findByText('Total'))

    const fila = (await screen.findByText('HKXW55')).closest('tr')!
    expect(within(fila).getByText('El TMS no reportó conductor')).toBeInTheDocument()
    // Y sigue siendo un tracto ASIGNADO: el estado no depende del conductor.
    expect(within(fila).getByText('Asignado')).toBeInTheDocument()
  })

  it('la tarjeta de Tractoreo dice cuántos tractos bloquean el cierre', async () => {
    renderSection()
    await screen.findByText('Ana Soto')

    expect(
      screen.getByRole('button', { name: /1 sin motivo — bloquean el cierre/ }),
    ).toBeInTheDocument()
  })

  it('el motivo de un tracto Tractoreo se escribe por equipmentClosuresApi, no por el de conductores', async () => {
    const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    renderSection()
    await screen.findByText('Ana Soto')

    fireEvent.click(screen.getByRole('button', { name: /Tractos · Tractoreo/ }))
    const fila = (await screen.findByText('DTBY52')).closest('tr')!
    fireEvent.change(within(fila).getByRole('combobox'), { target: { value: 'pana' } })

    await waitFor(() => {
      expect(equipmentClosuresApi.setReason).toHaveBeenCalledWith('tr3', '2026-08-04', 'pana')
    })
    expect(dailyClosuresApi.setReason).not.toHaveBeenCalled()
  })
  it('un conductor ASIGNADO sano tiene "Ver viaje": el link sale del viaje de hoy, no del de mismatch', async () => {
    const onSelectTrip = vi.fn()
    renderSection({ onSelectTrip })
    await screen.findByText('Ana Soto')
    fireEvent.click(screen.getByText('Total'))

    const fila = (await screen.findByText('Juan Pérez')).closest('tr')!
    // trip_id es null en esta fila (no hay mismatch) y aun asi hay link.
    fireEvent.click(within(fila).getByRole('button', { name: 'Ver viaje' }))

    expect(onSelectTrip).toHaveBeenCalledWith('t3')
  })

  it('no dibuja "Crear viaje manual" cuando nadie puede atenderlo', async () => {
    renderSection({ onCreateManualTrip: undefined })
    await screen.findByText('Ana Soto')

    expect(screen.queryByRole('button', { name: /Crear viaje manual/ })).not.toBeInTheDocument()
  })
})
