import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StatusReportSection } from './StatusReportSection'
import { statusReportApi } from '@/lib/api/statusReport'
import type { StatusReport } from '@/lib/types'

vi.mock('@/lib/api/statusReport', () => ({
  statusReportApi: { get: vi.fn() },
}))
vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { fleetDriverGap: vi.fn().mockResolvedValue({ rows: [{ carrier_id: 'c1', business_name: 'Transportes Sur', n_tractos: 3, n_conductores: 2, gap: 1 }] }) },
}))

const REPORT: StatusReport = {
  business_date: '2026-08-02',
  client_filter: null,
  section1_resumen: {
    total_equipos_activos: 81,
    tractoreo: { total: 81, assigned: 29, unassigned: 52, utilization_pct: 35.8 },
    equipos_completos: { total: 0, assigned: 0, unassigned: 0, utilization_pct: 0 },
    multi_dia_activos: { total: 5, por_dias_atras: { "1": 3, "2": 2 } },
  },
  section2_tractoreo_asignado: {
    por_cd: [{ cd: 'CD Lo Aguirre', RM: 3, Z0: 1, "Región": 0, "Sin clasificar": 0, total: 4 }],
    por_empresa_y_cd: [{ cd: 'CD Lo Aguirre', carrier_name: 'Transportes Sur', RM: 3, Z0: 1, "Región": 0, "Sin clasificar": 0, total: 4 }],
  },
  section3_vueltas: [
    { carrier_name: 'Transportes Sur', cd_origen: 'CD Lo Aguirre', tipo_destino: 'RM', vueltas: 2 },
  ],
  section4_tractoreo_no_trabajando: {
    por_cd: [{ cd: 'CD El Peñón', Panne: 2, "A confirmar": 1, total: 3 }],
    por_empresa_y_cd: [{ cd: 'CD El Peñón', carrier_name: 'Otra Spa', Panne: 2, total: 2 }],
    driver_detail: [
      {
        driver_id: 'd1', full_name: 'Juan Pérez', carrier_name: 'Otra Spa', cd_origen: 'CD El Peñón',
        unassigned_reason_label: 'Panne', tractor_plate: 'ABCD12', operation_type: 'Equipo Completo',
      },
    ],
  },
  section5_equipos_completos: [
    { carrier_name: 'Equipos Sur', enrolled: 10, assigned: 3, unassigned: 7, utilization_pct: 30.0 },
  ],
  section6_resumen_general: {
    tractoreo: { total: 81, assigned: 29, unassigned: 52, utilization_pct: 35.8 },
    equipos_completos: { total: 10, assigned: 3, unassigned: 7, utilization_pct: 30.0 },
    por_cd: [{ cd: 'CD Lo Aguirre', enrolled: 4, assigned: 4 }],
    por_cliente: [{ client_name: 'Walmart', assigned: 4 }],
  },
}

function renderSection(props: Partial<Parameters<typeof StatusReportSection>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <StatusReportSection fecha="2026-08-02" {...props} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(statusReportApi.get).mockReset().mockResolvedValue(REPORT)
})

describe('StatusReportSection', () => {
  it('muestra la Sección 1 (resumen) por defecto', async () => {
    renderSection()
    expect(await screen.findByText('Total equipos activos')).toBeInTheDocument()
    expect(screen.getByText('81')).toBeInTheDocument()
    expect(screen.getByText(/29 asignados \/ 52 sin asignar/)).toBeInTheDocument()
    expect(screen.getByText('3 equipo(s) — 1 día(s)')).toBeInTheDocument()
  })

  it('cambia a la Sección 2 (tractoreo asignado) y muestra el cross-tab por CD', async () => {
    renderSection()
    await screen.findByText('Total equipos activos')
    fireEvent.click(screen.getByRole('button', { name: '2. Tractoreo asignado' }))
    expect((await screen.findAllByText('CD Lo Aguirre')).length).toBe(2)
    expect(screen.getByText('Transportes Sur')).toBeInTheDocument()
  })

  it('cambia a la Sección 3 (vueltas) y muestra los equipos con 2+ vueltas', async () => {
    renderSection()
    await screen.findByText('Total equipos activos')
    fireEvent.click(screen.getByRole('button', { name: '3. Vueltas' }))
    const row = (await screen.findByText('Transportes Sur')).closest('tr')!
    expect(within(row).getByText('2')).toBeInTheDocument()
  })

  it('cambia a la Sección 4 y muestra el cross-tab por motivo Y el detalle por conductor con tipo de operación', async () => {
    renderSection()
    await screen.findByText('Total equipos activos')
    fireEvent.click(screen.getByRole('button', { name: '4. Tractoreo sin trabajar' }))
    expect((await screen.findAllByText('CD El Peñón')).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByText('ABCD12')).toBeInTheDocument()
    expect(screen.getByText('Equipo Completo')).toBeInTheDocument()
  })

  it('cambia a la Sección 5 (equipos completos) y muestra el % de utilización', async () => {
    renderSection()
    await screen.findByText('Total equipos activos')
    fireEvent.click(screen.getByRole('button', { name: '5. Equipos Completos' }))
    expect(await screen.findByText('Equipos Sur')).toBeInTheDocument()
    expect(screen.getByText('30%')).toBeInTheDocument()
  })

  it('cambia a la Sección 6 (resumen general) y muestra por CD y por cliente', async () => {
    renderSection()
    await screen.findByText('Total equipos activos')
    fireEvent.click(screen.getByRole('button', { name: '6. Resumen general' }))
    expect(await screen.findByText('Walmart')).toBeInTheDocument()
  })

  it('cambia a la Sección 7 y muestra las inconsistencias de dotación (FleetDriverGapCard)', async () => {
    renderSection()
    await screen.findByText('Total equipos activos')
    fireEvent.click(screen.getByRole('button', { name: '7. Inconsistencias de dotación' }))
    expect(await screen.findByText('1 empresa con desbalance de dotación')).toBeInTheDocument()
  })

  it('filtrar por cliente vuelve a pedir el reporte con ese cliente', async () => {
    renderSection({ shippers: [{ id: 's1', name: 'Walmart', status: 'ACTIVE' }] })
    await screen.findByText('Total equipos activos')
    fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar por cliente' }), { target: { value: 'Walmart' } })
    expect(statusReportApi.get).toHaveBeenCalledWith('2026-08-02', 'Walmart')
  })

  it('el link "Ver histórico" apunta a /dashboard/operations/closures/history', async () => {
    renderSection()
    await screen.findByText('Total equipos activos')
    const link = screen.getByRole('link', { name: /Ver histórico/ })
    expect(link).toHaveAttribute('href', '/dashboard/operations/closures/history')
  })
})
