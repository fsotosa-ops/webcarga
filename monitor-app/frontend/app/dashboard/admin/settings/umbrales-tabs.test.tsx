import { render as renderCrudo, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
// Permisos simulados: por defecto todos (los tests de edición no cambian);
// los de solo lectura los restringen (revisión final RBAC, hallazgo 3).
const permisos = vi.hoisted(() => ({ dados: null as Set<string> | null }))
vi.mock('@/lib/authz/PermisosProvider', () => ({
  usePermiso: (p: string) => permisos.dados === null || permisos.dados.has(p),
}))
import { AlertasMonitorTab, AlertasVencimientoTab } from './umbrales-tabs'
import { configApi } from '@/lib/api/config'

vi.mock('@/lib/api/config', () => ({
  revisionesApi: { list: vi.fn().mockResolvedValue([]), confirm: vi.fn() },
  configApi: { getMonitorAlertRules: vi.fn(), patchMonitorAlertRules: vi.fn(), getAlertThresholds: vi.fn(), patchAlertThreshold: vi.fn() },
}))

const REGLAS = {
  stale_report_hours: 2, dwell_hours: 2, late_arrival_grace_min: 60, unassigned_enabled: true,
  dwell_yellow_min: 60, dwell_orange_min: 90, dwell_red_min: 120, tms_dropped_hours: 3,
  stale_trip_days: 7,
}

function render(ui: React.ReactElement) {
  return renderCrudo(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  permisos.dados = null
  vi.mocked(configApi.getMonitorAlertRules).mockReset().mockResolvedValue(REGLAS)
  vi.mocked(configApi.patchMonitorAlertRules).mockReset().mockResolvedValue({ ...REGLAS, stale_trip_days: null })
})

describe('Alertas del Monitor', () => {
  // D5 (minuta 02/10): el umbral lo define WebCarga, y vacío significa "no
  // ocultar nada". Con Number('') se habría guardado 0, que el backend rechaza.
  it('dejar vacío el umbral de viajes entregados lo guarda como null, no como 0', async () => {
    const { configApi } = await import('@/lib/api/config')
    render(<AlertasMonitorTab />)
    const campo = await screen.findByLabelText('Viaje entregado sin cierre del TMS')
    expect(campo).toHaveValue(7)

    fireEvent.change(campo, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /Guardar cambios/ }))

    await waitFor(() => {
      expect(configApi.patchMonitorAlertRules).toHaveBeenCalledWith({ stale_trip_days: null })
    })
  })
})

describe('solo lectura (revisión final RBAC, hallazgo 3)', () => {
  it('Alertas de vencimiento es de Certificación: con operations.configure se ve pero no se edita', async () => {
    permisos.dados = new Set(['operations.configure'])
    vi.mocked(configApi.getAlertThresholds).mockResolvedValue([
      { doc_type: 'LICENCIA', label: 'Licencia', warning_days: 30, error_days: 7 },
    ] as never)
    render(<AlertasVencimientoTab />)
    expect(await screen.findByLabelText('Advertencia de Licencia')).toBeDisabled()
    expect(screen.queryByRole('button', { name: /guardar/i })).not.toBeInTheDocument()
  })

  it('Umbrales del monitor sin operations.configure: se ven deshabilitados y sin "Está bien así"', async () => {
    permisos.dados = new Set(['certification.configure'])
    render(<AlertasMonitorTab />)
    expect(await screen.findByLabelText('Viaje entregado sin cierre del TMS')).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Está bien así/ })).not.toBeInTheDocument()
  })
})

