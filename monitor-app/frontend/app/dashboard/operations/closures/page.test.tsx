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
  dailyClosuresApi: { get: vi.fn(), setReason: vi.fn(), setReasonBatch: vi.fn() },
}))

vi.mock('@/lib/api/equipmentClosures', () => ({
  equipmentClosuresApi: { get: vi.fn(), setReason: vi.fn(), setReasonBatch: vi.fn() },
}))

vi.mock('@/lib/api/closures', () => ({
  closuresApi: { cerrar: vi.fn(), reabrir: vi.fn() },
  isCierrePendienteError: vi.fn(() => false),
}))

vi.mock('@/hooks/useCanAdmin', () => ({ useCanAdmin: vi.fn(() => false) }))

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

const CERRADO: DailyClosureStatus = {
  ...EMPTY_STATUS,
  closed: true,
  periodo: {
    status: 'CLOSED', closed_by: 'u1', closed_by_name: 'Pablo Soto', closed_at: '2026-08-04T23:40:00Z',
    override_count: 0,
    frozen_totals: { conductores: 38, conductores_resueltos: 38, tractos: 79, tractos_resueltos: 79, viajes: 42 },
    reopened_by: null, reopened_at: null, reopen_note: null,
  },
}

beforeEach(async () => {
  const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
  const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
  const { closuresApi, isCierrePendienteError } = await import('@/lib/api/closures')
  const { useCanAdmin } = await import('@/hooks/useCanAdmin')
  vi.mocked(dailyClosuresApi.get).mockReset().mockResolvedValue(EMPTY_STATUS)
  vi.mocked(equipmentClosuresApi.get).mockReset().mockResolvedValue(EMPTY_EQUIPMENT)
  vi.mocked(closuresApi.cerrar).mockReset()
  vi.mocked(closuresApi.reabrir).mockReset()
  vi.mocked(isCierrePendienteError).mockReset().mockReturnValue(false)
  vi.mocked(useCanAdmin).mockReset().mockReturnValue(false)
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

  it('Confirmar cierre firma los dos ejes en una sola llamada', async () => {
    // Antes eran dos POST encadenados desde la pantalla: si el segundo fallaba,
    // el día quedaba medio firmado y nada lo decía.
    const { closuresApi } = await import('@/lib/api/closures')
    vi.mocked(closuresApi.cerrar).mockResolvedValue({
      business_date: '2026-08-04', closed_at: '2026-08-04T23:40:00Z', overridden: 0,
      totales: { conductores: 0, conductores_resueltos: 0, tractos: 0, tractos_resueltos: 0, viajes: 0 },
    })
    renderPage()

    // El boton espera a que las consultas del dia resuelvan: firmar sobre
    // datos a medio cargar produce un cierre falso.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Confirmar cierre' })).toBeEnabled(),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cierre' }))

    await waitFor(() => expect(closuresApi.cerrar).toHaveBeenCalledWith('2026-08-04', false, ''))
    expect(closuresApi.cerrar).toHaveBeenCalledTimes(1)
  })

  it('un día cerrado dice quién lo firmó, a qué hora y con qué cifras, y no ofrece volver a firmarlo', async () => {
    // Operaciones (16/09): "al momento de realizar el cierre no entrega ningún
    // aviso, de cierre finalizado o de todo OK".
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue(CERRADO)
    renderPage()

    // Hay otro role="status" en la pantalla (el cargando de la flota): el
    // aviso se busca por lo que dice.
    const aviso = (await screen.findByText(/Día cerrado por Pablo Soto/)).closest('[role="status"]')!
    expect(aviso).toHaveTextContent('Día cerrado por Pablo Soto')
    expect(aviso).toHaveTextContent('38 de 38 conductores · 79 de 79 tractos resueltos')
    expect(screen.queryByRole('button', { name: 'Confirmar cierre' })).not.toBeInTheDocument()
  })

  it('reabrir es sólo de admin y exige una nota', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    const { closuresApi } = await import('@/lib/api/closures')
    const { useCanAdmin } = await import('@/hooks/useCanAdmin')
    vi.mocked(dailyClosuresApi.get).mockResolvedValue(CERRADO)
    vi.mocked(closuresApi.reabrir).mockResolvedValue({ business_date: '2026-08-04', status: 'OPEN' })

    const sinAdmin = renderPage()
    await screen.findByText(/Día cerrado por/)
    expect(screen.queryByRole('button', { name: /Reabrir día/ })).not.toBeInTheDocument()
    sinAdmin.unmount()

    vi.mocked(useCanAdmin).mockReturnValue(true)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Reabrir día/ }))
    const confirmar = screen.getByRole('button', { name: 'Confirmar y reabrir' })
    expect(confirmar).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Motivo para reabrir el día'), { target: { value: 'faltaba un viaje' } })
    fireEvent.click(confirmar)

    await waitFor(() => expect(closuresApi.reabrir).toHaveBeenCalledWith('2026-08-04', 'faltaba un viaje'))
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

  it('el 409 nombra cada tracto con su empresa y cada conductor con su causa', async () => {
    // Pablo: *"cuál es el listado de estos 15 equipos sin resolver, ni hay un
    // detalle"*. Un número sin sus filas no dice qué hacer.
    const { closuresApi, isCierrePendienteError } = await import('@/lib/api/closures')
    vi.mocked(closuresApi.cerrar).mockRejectedValue(Object.assign(new Error('pending'), {
      status: 409,
      detail: {
        message: '2 conductor(es) sin resolver y 2 tracto(s) sin motivo — no se puede cerrar el día',
        pending: [
          { driver_id: 'd1', full_name: 'Ana Soto', status: 'UNASSIGNED' },
          { driver_id: 'd2', full_name: 'Luis Rojas', status: 'MISMATCH' },
        ],
        pending_equipment: [
          { asset_id: 'a1', tractor_plate: 'DTBY52', carrier_id: 'cf', carrier_name: 'Transportes La Fortaleza Spa' },
          { asset_id: 'a2', tractor_plate: 'LCSR30', carrier_id: null, carrier_name: null },
        ],
        sin_flota: [],
      },
    }))
    vi.mocked(isCierrePendienteError).mockReturnValue(true)
    renderPage()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar cierre' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cierre' }))

    expect(await screen.findByText('Conductores sin resolver (2)')).toBeInTheDocument()
    expect(screen.getByText('Ana Soto — sin motivo')).toBeInTheDocument()
    expect(screen.getByText('Luis Rojas — empresa por regularizar')).toBeInTheDocument()
    expect(screen.getByText('Tractos sin motivo (2)')).toBeInTheDocument()
    const conEmpresa = screen.getByText('DTBY52 — Transportes La Fortaleza Spa')
    expect(conEmpresa.closest('a')).toHaveAttribute('href', '/dashboard/carriers/cf?tab=equipos')
    // Sin empresa no se inventa un destino: se nombra igual, sin link.
    expect(screen.getByText('LCSR30').closest('a')).toBeNull()
  })

  // La causa raiz de que la barra de seleccion de "Viajes" no se pegara nunca:
  // esta card tenia `overflow-hidden` para redondear las esquinas, y eso la
  // convertia en el scrollport de cualquier `position: sticky` de adentro. Como
  // la card no scrollea, el sticky no se movia. Medido en el navegador el
  // 14/09: con la pagina arriba la barra quedaba 2.751 px fuera de lo visible.
  //
  // Esto SI se puede fijar en jsdom, y es lo que de verdad importa: si alguien
  // devuelve ese recorte, la barra se rompe otra vez y en silencio.
  it('el lienzo del cierre no recorta a sus hijos, para que un sticky pueda pegarse', async () => {
    const { container } = renderPage()
    await waitFor(() => expect(screen.getByText('Centro de Cierre del Día')).toBeInTheDocument())

    // El lienzo se identifica por ser el PADRE de la barra de pestanas, no por
    // sus clases: `.rounded-2xl.shadow-sm` agarraba otra card anterior del DOM
    // y el test pasaba con el bug puesto. Verificado por mutacion.
    const tablist = container.querySelector('[role="tablist"]')!
    const lienzo = tablist.parentElement!
    expect(lienzo.className).toContain('rounded-2xl')
    expect(lienzo.className).not.toContain('overflow-hidden')
    // Las esquinas las redondean ahora sus dos hijos con fondo propio.
    expect(tablist.className).toContain('rounded-t-2xl')
  })
})
