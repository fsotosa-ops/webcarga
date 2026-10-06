import { render as renderCrudo, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AlertasMonitorTab } from './umbrales-tabs'

vi.mock('@/lib/api/config', () => ({
  revisionesApi: { list: vi.fn().mockResolvedValue([]), confirm: vi.fn() },
  configApi: { getMonitorAlertRules: vi.fn(), patchMonitorAlertRules: vi.fn() },
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
  const { configApi } = await import('@/lib/api/config')
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
