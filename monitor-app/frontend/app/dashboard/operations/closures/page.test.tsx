import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ClosuresCenterPage from './page'
import type { DailyClosureStatus } from '@/lib/types'

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
  equipmentClosuresApi: { close: vi.fn() },
  isEquipmentClosePendingError: () => false,
}))

vi.mock('@/lib/api/carriers', () => ({
  carriersApi: { fleetDriverGap: vi.fn().mockResolvedValue({ rows: [] }) },
}))

const EMPTY_STATUS: DailyClosureStatus = {
  business_date: '2026-08-04', closed: false, closure: null,
  total_drivers: 0, assigned_count: 0, unassigned_count: 0, mismatch_count: 0, pending_count: 0,
  drivers: [], pre_cierre: EMPTY_PRE_CIERRE,
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
  vi.mocked(equipmentClosuresApi.close).mockReset()
  push.mockReset(); replace.mockReset()
})

describe('ClosuresCenterPage', () => {
  it('monta las 5 secciones', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 2, name: 'Resumen del día' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Pendientes' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Cerrar Tractoreo' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Cerrar Equipos Completos' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Reporte del día' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Confirmar cierre' })).toBeInTheDocument()
  })

  it('la navegación lateral apunta a las anclas correctas', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Resumen del día' })
    const link = screen.getByRole('link', { name: 'Cerrar Tractoreo' })
    expect(link).toHaveAttribute('href', '#tractoreo')
  })

  it('lee la fecha del query param y se la pasa a TractoreoDriverClosureSection', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    renderPage()
    await waitFor(() => expect(dailyClosuresApi.get).toHaveBeenCalledWith('2026-08-04'))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Centro de Cierre del Día')
    expect(screen.getByLabelText('Fecha del cierre')).toHaveValue('2026-08-04')
  })

  it('Confirmar cierre: si el cierre de Tractoreo tiene éxito, encadena el de Equipos Completos', async () => {
    const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
    const { equipmentClosuresApi } = await import('@/lib/api/equipmentClosures')
    vi.mocked(dailyClosuresApi.close).mockResolvedValue({ ok: true, business_date: '2026-08-04', overridden: 0 })
    vi.mocked(equipmentClosuresApi.close).mockResolvedValue({ ok: true, business_date: '2026-08-04', overridden: 0 })
    renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Resumen del día' })

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cierre' }))

    await waitFor(() => expect(dailyClosuresApi.close).toHaveBeenCalledWith('2026-08-04', false, ''))
    await waitFor(() => expect(equipmentClosuresApi.close).toHaveBeenCalledWith('2026-08-04'))
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
    await screen.findByRole('heading', { level: 2, name: 'Resumen del día' })

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cierre' }))

    await waitFor(() => expect(screen.getByText('2 conductores sin resolver')).toBeInTheDocument())
    expect(equipmentClosuresApi.close).not.toHaveBeenCalled()
  })

  it('cambiar el selector de fecha actualiza la URL', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Resumen del día' })

    fireEvent.change(screen.getByLabelText('Fecha del cierre'), { target: { value: '2026-08-05' } })

    expect(replace).toHaveBeenCalledWith(expect.stringContaining('fecha=2026-08-05'))
  })
})
