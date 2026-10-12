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
  GLOBAL_ALERT_THRESHOLD: 'documento_por_vencer',
  revisionesApi: { list: vi.fn().mockResolvedValue([]), confirm: vi.fn() },
  configApi: { getMonitorAlertRules: vi.fn(), patchMonitorAlertRules: vi.fn(), getAlertThresholds: vi.fn(), patchAlertThreshold: vi.fn() },
}))

const REGLAS = {
  stale_report_hours: 2, dwell_hours: 2, late_arrival_grace_min: 60, unassigned_enabled: true,
  dwell_yellow_min: 60, dwell_orange_min: 90, dwell_red_min: 120, tms_dropped_hours: 3,
  stale_trip_days: 7, in_progress_idle_days: 3,
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

describe('Días sin movimiento de En curso (11/10)', () => {
  it('se edita como los demás umbrales y se guarda como número', async () => {
    const { configApi } = await import('@/lib/api/config')
    render(<AlertasMonitorTab />)
    const campo = await screen.findByLabelText('Días sin movimiento para salir de En curso')
    expect(campo).toHaveValue(3)

    fireEvent.change(campo, { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: /Guardar cambios/ }))

    await waitFor(() => {
      expect(configApi.patchMonitorAlertRules).toHaveBeenCalledWith({ in_progress_idle_days: 5 })
    })
  })
})

describe('solo lectura (revisión final RBAC, hallazgo 3)', () => {
  it('Alertas de vencimiento es de Certificación: con operations.configure se ve pero no se edita', async () => {
    permisos.dados = new Set(['operations.configure'])
    vi.mocked(configApi.getAlertThresholds).mockResolvedValue([
      { doc_type: 'documento_por_vencer', label: 'Aviso general', warning_days: 30, error_days: 0 },
    ] as never)
    render(<AlertasVencimientoTab />)
    expect(await screen.findByLabelText(/Aviso \(días/)).toBeDisabled()
    expect(screen.queryByRole('button', { name: /guardar/i })).not.toBeInTheDocument()
  })

  it('Umbrales del monitor sin operations.configure: se ven deshabilitados y sin "Está bien así"', async () => {
    permisos.dados = new Set(['certification.configure'])
    render(<AlertasMonitorTab />)
    expect(await screen.findByLabelText('Viaje entregado sin cierre del TMS')).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Está bien así/ })).not.toBeInTheDocument()
  })
})

const GLOBAL = { doc_type: 'documento_por_vencer', label: 'Aviso general de vencimiento de documentos (días)', warning_days: 30, error_days: 0 }

describe('Alertas de vencimiento: solo el aviso general (D1-R4)', () => {
  // Mientras la API vieja siga en el aire manda las diez filas, ordenadas, y
  // la primera es "circulacion": la pantalla busca la global por su clave.
  it('muestra un solo par de umbrales, el general, aunque lleguen filas por documento', async () => {
    vi.mocked(configApi.getAlertThresholds).mockResolvedValue([
      { doc_type: 'circulacion', label: 'P. Circulación', warning_days: 45, error_days: 0 },
      GLOBAL,
      { doc_type: 'license_expiry', label: 'Licencia de conducir', warning_days: 20, error_days: 0 },
    ])
    render(<AlertasVencimientoTab />)
    expect(await screen.findByLabelText(/Aviso \(días/)).toHaveValue(30)
    expect(screen.getByLabelText(/Crítico \(días/)).toHaveValue(0)
    expect(screen.getAllByRole('spinbutton')).toHaveLength(2)
    expect(screen.queryByText('Licencia de conducir')).not.toBeInTheDocument()
    expect(screen.queryByText('P. Circulación')).not.toBeInTheDocument()
  })

  // Conflicto 11: la pantalla prometía una "alerta roja" que nadie calculaba.
  it('describe lo que de verdad pasa con cada umbral', async () => {
    vi.mocked(configApi.getAlertThresholds).mockResolvedValue([GLOBAL])
    render(<AlertasVencimientoTab />)
    expect(await screen.findByText(/se muestra como Por vencer/)).toBeInTheDocument()
    expect(screen.getByText(/no quita la habilitación/)).toBeInTheDocument()
    expect(screen.getByText(/semáforo del Monitor/)).toBeInTheDocument()
    expect(screen.getByText(/licencia o la cédula del conductor/)).toBeInTheDocument()
    expect(screen.queryByText(/alerta roja|alerta amarilla/)).not.toBeInTheDocument()
  })

  it('guarda el crítico del aviso general con su clave', async () => {
    vi.mocked(configApi.getAlertThresholds).mockResolvedValue([GLOBAL])
    vi.mocked(configApi.patchAlertThreshold).mockResolvedValue({ ...GLOBAL, error_days: 7 })
    render(<AlertasVencimientoTab />)
    fireEvent.change(await screen.findByLabelText(/Crítico \(días/), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }))
    await waitFor(() => expect(configApi.patchAlertThreshold).toHaveBeenCalledWith('documento_por_vencer', { error_days: 7 }))
  })

  // El backend rechaza un crítico que no sea menor que el aviso (422): se muestra su mensaje.
  it('si la API rechaza el crítico (422), muestra su mensaje', async () => {
    vi.mocked(configApi.getAlertThresholds).mockResolvedValue([GLOBAL])
    vi.mocked(configApi.patchAlertThreshold).mockRejectedValue(new Error('El crítico debe ser menor que el aviso'))
    render(<AlertasVencimientoTab />)
    fireEvent.change(await screen.findByLabelText(/Crítico \(días/), { target: { value: '31' } })
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/El crítico debe ser menor que el aviso/)
  })

  it('si la fila global no viene, lo dice como error y no dibuja un formulario vacío', async () => {
    vi.mocked(configApi.getAlertThresholds).mockResolvedValue([])
    render(<AlertasVencimientoTab />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/No se encontró el aviso general/)
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0)
  })
})
