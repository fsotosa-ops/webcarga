import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ClosuresCenterPage from './page'
import type { DailyClosureStatus, EquipmentClosureStatus } from '@/lib/types'

const EMPTY_PRE_CIERRE = {
  auto_resolved: [],
  escalations: {
    PATENTE_NO_REGISTRADA: [], EMPRESA_NO_RECONOCIDA: [], CONDUCTOR_NO_REGISTRADO: [],
    EMPRESA_ONBOARDING: [], SIN_TIPO_OPERACION: [],
  },
}

const push = vi.fn()
const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams('fecha=2026-08-04'),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  }),
}))

vi.mock('@/lib/api/tripsMeta', () => ({
  fetchTripsMeta: vi.fn().mockResolvedValue({ unassigned_reasons: [{ id: 'pana', label: 'Pana' }] }),
}))

vi.mock('@/lib/api/dailyClosures', () => ({
  dailyClosuresApi: { get: vi.fn(), setReason: vi.fn(), setReasonBatch: vi.fn(), close: vi.fn() },
  isClosePendingError: vi.fn(() => false),
}))

vi.mock('@/lib/api/equipmentClosures', () => ({
  equipmentClosuresApi: { get: vi.fn(), setReason: vi.fn(), setReasonBatch: vi.fn(), close: vi.fn() },
  isEquipmentClosePendingError: vi.fn(() => false),
}))

vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { fleetDriverGap: vi.fn().mockResolvedValue({ rows: [] }) },
}))

vi.mock('@/lib/api/locations', () => ({
  shippersApi: { list: vi.fn().mockResolvedValue([]) },
}))

vi.mock('@/lib/api/statusReport', () => ({
  statusReportApi: { get: vi.fn() },
}))

const EMPTY_STATUS: DailyClosureStatus = {
  business_date: '2026-08-04', closed: false, closure: null,
  cierre: { total_trips_al_firmar: null, posteriores_al_cierre: 0 },
  total_drivers: 0, assigned_count: 0, unassigned_count: 0, mismatch_count: 0, pending_count: 0,
  drivers: [], pre_cierre: EMPTY_PRE_CIERRE,
}

const EMPTY_EQUIPMENT: EquipmentClosureStatus = {
  business_date: '2026-08-04', closed: false, closure: null,
  tractoreo: { summary: { total: 0, assigned: 0, unassigned: 0, utilization_pct: 0 }, equipment: [], pending_count: 0 },
  equipos_completos: { summary: { total: 0, assigned: 0, unassigned: 0, utilization_pct: 0 }, by_carrier: [], equipment: [] },
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ClosuresCenterPage />
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
  const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
  vi.mocked(dailyClosuresApi.get).mockReset().mockResolvedValue(EMPTY_STATUS)
  vi.mocked(dailyClosuresApi.close).mockReset()
  vi.mocked(equipmentClosuresApi.get).mockReset().mockResolvedValue(EMPTY_EQUIPMENT)
  vi.mocked(equipmentClosuresApi.close).mockReset()
  const { isEquipmentClosePendingError } = await import('@/lib/api/equipmentClosures')
  vi.mocked(isEquipmentClosePendingError).mockReset().mockReturnValue(false)
  push.mockReset(); replace.mockReset()
})

describe('ClosuresCenterPage', () => {
  it('muestra las 4 tabs, con "Flota del día" activa por defecto', () => {
    renderPage()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map(t => t.textContent)).toEqual(['Flota del día', 'Viajes', 'Pendientes', 'Reporte'])
    expect(screen.getByRole('tab', { name: 'Flota del día' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Viajes' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Pendientes' })).toHaveAttribute('aria-selected', 'false')
  })

  it('clickear una tab la activa — solo un lienzo, sin scroll por anclas', () => {
    renderPage()
    expect(screen.getByRole('tab', { name: 'Pendientes' })).toHaveAttribute('aria-selected', 'false')

    fireEvent.click(screen.getByRole('tab', { name: 'Pendientes' }))

    expect(screen.getByRole('tab', { name: 'Pendientes' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Flota del día' })).toHaveAttribute('aria-selected', 'false')
  })

  it('lee la fecha del query param y se la pasa a FlotaDelDiaSection', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    renderPage()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Centro de Cierre del Día')
    expect(screen.getByLabelText('Fecha del cierre')).toHaveValue('2026-08-04')

    await waitFor(() => expect(dailyClosuresApi.get).toHaveBeenCalledWith('2026-08-04'))
  })

  it('"Confirmar cierre" está siempre visible, sin importar qué tab esté activa', () => {
    renderPage()
    expect(screen.getByRole('button', { name: 'Confirmar cierre' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Reporte' }))

    expect(screen.getByRole('button', { name: 'Confirmar cierre' })).toBeInTheDocument()
  })

  it('Confirmar cierre: si el cierre de Tractoreo tiene éxito, encadena el de Equipos Completos', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
    vi.mocked(dailyClosuresApi.close).mockResolvedValue({ ok: true, business_date: '2026-08-04', overridden: 0 })
    vi.mocked(equipmentClosuresApi.close).mockResolvedValue({ ok: true, business_date: '2026-08-04', overridden: 0 })
    renderPage()

    // El boton espera a que las consultas del dia resuelvan: firmar sobre
    // datos a medio cargar produce un cierre falso.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Confirmar cierre' })).toBeEnabled(),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cierre' }))

    await waitFor(() => expect(dailyClosuresApi.close).toHaveBeenCalledWith('2026-08-04', false, ''))
    // Los mismos tres argumentos que el primer paso: el override tiene que
    // llegar a los dos. Antes se llamaba con la fecha sola, así que con
    // tractos pendientes el segundo paso devolvía 409 aunque el admin lo
    // hubiera forzado — `app.equipment_closures` nunca llegó a tener una fila.
    await waitFor(() => expect(equipmentClosuresApi.close).toHaveBeenCalledWith('2026-08-04', false, ''))
  })

  it('Confirmar cierre: si Tractoreo falla con pendientes (409), NO llama a Equipos Completos', async () => {
    const { dailyClosuresApi, isClosePendingError } = await import('@/lib/api/dailyClosures')
    const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
    const pendingError = Object.assign(new Error('pending'), {
      status: 409, detail: { message: '2 conductores sin resolver', pending: [] },
    })
    vi.mocked(dailyClosuresApi.close).mockRejectedValue(pendingError)
    vi.mocked(isClosePendingError).mockImplementation(
      (e: unknown): e is never => e === pendingError,
    )
    renderPage()

    // El boton espera a que las consultas del dia resuelvan: firmar sobre
    // datos a medio cargar produce un cierre falso.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Confirmar cierre' })).toBeEnabled(),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cierre' }))

    await waitFor(() => expect(screen.getByText('2 conductores sin resolver')).toBeInTheDocument())
    expect(equipmentClosuresApi.close).not.toHaveBeenCalled()
  })

  it('cambiar el selector de fecha actualiza la URL', () => {
    renderPage()

    fireEvent.change(screen.getByLabelText('Fecha del cierre'), { target: { value: '2026-08-05' } })

    expect(replace).toHaveBeenCalledWith(expect.stringContaining('fecha=2026-08-05'))
  })

  // Firmar el dia es un acto con nombre y hora. El boton solo miraba `closing`,
  // asi que quedaba habilitado mientras el area de datos mostraba el spinner:
  // se podia firmar un dia sobre informacion que no habia llegado.
  it('no deja confirmar el cierre mientras los datos del día están cargando', async () => {
    // Las dos consultas del cierre nunca resuelven: congela el instante de carga.
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
    vi.mocked(dailyClosuresApi.get).mockReturnValue(new Promise(() => {}))
    vi.mocked(equipmentClosuresApi.get).mockReturnValue(new Promise(() => {}))

    renderPage()

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Confirmar cierre' })).toBeDisabled(),
    )
  })
  // ── Regresión del 2026-09-07 ──────────────────────────────────────────────
  // Pablo: *"cuál es el listado de estos 15 equipos sin resolver, ni hay un
  // detalle"*. El 409 traía patente y empresa de cada uno desde siempre; la
  // pantalla guardaba `detail.message` y tiraba `detail.pending`.

  it('el 409 de equipos se despliega con la patente y la empresa de cada tracto que bloquea', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    const { equipmentClosuresApi, isEquipmentClosePendingError } = await import('@/lib/api/equipmentClosures')
    vi.mocked(dailyClosuresApi.close).mockResolvedValue({ ok: true, business_date: '2026-08-04', overridden: 0 })
    vi.mocked(equipmentClosuresApi.close).mockRejectedValue(Object.assign(new Error('pending'), {
      status: 409,
      detail: {
        message: '2 equipo(s) sin resolver — no se puede cerrar el día',
        pending: [
          { asset_id: 'a1', tractor_plate: 'DTBY52', carrier_id: 'cf', carrier_name: 'Transportes La Fortaleza Spa' },
          { asset_id: 'a2', tractor_plate: 'LCSR30', carrier_id: null, carrier_name: null },
        ],
      },
    }))
    vi.mocked(isEquipmentClosePendingError).mockReturnValue(true)
    renderPage()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar cierre' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cierre' }))

    expect(await screen.findByText('Tractos sin motivo (2)')).toBeInTheDocument()
    const conEmpresa = screen.getByText('DTBY52 — Transportes La Fortaleza Spa')
    expect(conEmpresa).toBeInTheDocument()
    expect(conEmpresa.closest('a')).toHaveAttribute('href', '/dashboard/carriers/cf?tab=equipos')
    // Sin empresa no se inventa un destino: se nombra igual, sin link.
    expect(screen.getByText('LCSR30')).toBeInTheDocument()
    expect(screen.getByText('LCSR30').closest('a')).toBeNull()
  })

  it('el 409 de conductores nombra a cada uno, no sólo cuántos son', async () => {
    const { dailyClosuresApi, isClosePendingError } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.close).mockRejectedValue(Object.assign(new Error('pending'), {
      status: 409,
      detail: {
        message: '2 conductor(es) sin resolver — no se puede cerrar el día',
        pending: [
          { driver_id: 'd1', full_name: 'Ana Soto', status: 'UNASSIGNED' },
          { driver_id: 'd2', full_name: 'Luis Rojas', status: 'MISMATCH' },
        ],
        sin_flota: [],
      },
    }))
    vi.mocked(isClosePendingError).mockReturnValue(true)
    renderPage()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar cierre' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cierre' }))

    expect(await screen.findByText('Conductores sin resolver (2)')).toBeInTheDocument()
    expect(screen.getByText('Ana Soto — sin motivo')).toBeInTheDocument()
    expect(screen.getByText('Luis Rojas — empresa por regularizar')).toBeInTheDocument()
  })
})
