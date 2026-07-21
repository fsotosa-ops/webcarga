import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CuadraturaPage from './page'
import { createClient } from '@/lib/supabase/client'
import type { DailyClosureStatus, TripsMeta } from '@/lib/types'

vi.mock('@/lib/api/dailyClosures', () => ({
  dailyClosuresApi: { get: vi.fn(), setReason: vi.fn(), close: vi.fn() },
  isClosePendingError: () => false,
}))
vi.mock('@/lib/api/tripsMeta', () => ({ fetchTripsMeta: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }))

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CuadraturaPage />
    </QueryClientProvider>,
  )
}

const META: Pick<TripsMeta, 'unassigned_reasons'> = {
  unassigned_reasons: [{ id: 'pana', label: 'Pana' }],
}

const STATUS: DailyClosureStatus = {
  business_date: '2026-07-21',
  closed: false,
  closure: null,
  total_drivers: 3,
  assigned_count: 1,
  unassigned_count: 1,
  mismatch_count: 1,
  pending_count: 2,
  drivers: [
    { driver_id: 'd1', full_name: 'Juan Pérez', tax_id: '11111111-1', carrier_name: 'Transportes Sur', status: 'ASSIGNED', unassigned_reason_id: null, unassigned_reason_label: null, resolved_by: null, resolved_at: null, client_names: ['Walmart'] },
    { driver_id: 'd2', full_name: 'Ana Soto', tax_id: '22222222-2', carrier_name: 'Transportes Sur', status: 'UNASSIGNED', unassigned_reason_id: null, unassigned_reason_label: null, resolved_by: null, resolved_at: null, client_names: [] },
    { driver_id: 'd3', full_name: 'Luis Rojas', tax_id: '33333333-3', carrier_name: 'Rios Ltda', status: 'MISMATCH', unassigned_reason_id: null, unassigned_reason_label: null, resolved_by: null, resolved_at: null, client_names: ['Sodimac'] },
  ],
}

beforeEach(async () => {
  vi.mocked(createClient).mockReturnValue({
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { role: 'editor' } }) }),
      }),
    }),
  } as unknown as ReturnType<typeof createClient>)

  const { dailyClosuresApi: mockedApi } = await import('@/lib/api/dailyClosures')
  vi.mocked(mockedApi.get).mockReset().mockResolvedValue(STATUS)
  vi.mocked(mockedApi.setReason).mockReset()
  vi.mocked(mockedApi.close).mockReset()
  const { fetchTripsMeta } = await import('@/lib/api/tripsMeta')
  vi.mocked(fetchTripsMeta).mockReset().mockResolvedValue(META as TripsMeta)
})

describe('CuadraturaPage', () => {
  it('shows summary tiles and the driver list', async () => {
    renderPage()
    expect(await screen.findByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByText('Ana Soto')).toBeInTheDocument()
    expect(screen.getByText('Luis Rojas')).toBeInTheDocument()
    expect(screen.getByText('Asignados')).toBeInTheDocument()
  })

  it('filters the driver list when a tile is clicked', async () => {
    renderPage()
    await screen.findByText('Juan Pérez')
    fireEvent.click(screen.getByText('No asignados'))
    await waitFor(() => expect(screen.queryByText('Juan Pérez')).not.toBeInTheDocument())
    expect(screen.getByText('Ana Soto')).toBeInTheDocument()
  })

  it('sets the unassigned reason for a driver', async () => {
    const { dailyClosuresApi: mockedApi } = await import('@/lib/api/dailyClosures')
    renderPage()
    await screen.findByText('Ana Soto')
    // 2 combobox ahora: el selector "Vista" (Conductor/Empresa/Cliente) y el
    // motivo de Ana Soto — el motivo es el que NO tiene la opción "Por conductor".
    const selects = screen.getAllByRole('combobox')
    const reasonSelect = selects.find(s => !within(s).queryByText('Por conductor'))!
    fireEvent.change(reasonSelect, { target: { value: 'pana' } })
    await waitFor(() => expect(mockedApi.setReason).toHaveBeenCalledWith('d2', '2026-07-21', 'pana'))
  })

  it('shows a pivot table grouped by empresa', async () => {
    renderPage()
    await screen.findByText('Juan Pérez')
    fireEvent.change(screen.getByDisplayValue('Por conductor'), { target: { value: 'empresa' } })
    expect(await screen.findByText('Transportes Sur')).toBeInTheDocument()
    expect(screen.getByText('Rios Ltda')).toBeInTheDocument()
    expect(screen.queryByText('Juan Pérez')).not.toBeInTheDocument()
  })

  it('shows a pivot table grouped by cliente', async () => {
    renderPage()
    await screen.findByText('Juan Pérez')
    fireEvent.change(screen.getByDisplayValue('Por conductor'), { target: { value: 'cliente' } })
    expect(await screen.findByText('Walmart')).toBeInTheDocument()
    expect(screen.getByText('Sodimac')).toBeInTheDocument()
  })

  it('exports the current view as CSV', async () => {
    const clickSpy = vi.fn()
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreateElement(tag)
      if (tag === 'a') el.click = clickSpy
      return el
    })
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() })

    renderPage()
    await screen.findByText('Juan Pérez')
    fireEvent.click(screen.getByRole('button', { name: /CSV/ }))

    expect(clickSpy).toHaveBeenCalled()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows mismatch rows with a link to review in Empresas', async () => {
    renderPage()
    expect(await screen.findByText(/Revisar en Empresas/)).toBeInTheDocument()
  })

  it('disables the close button while there are pending cases', async () => {
    renderPage()
    const closeBtn = await screen.findByRole('button', { name: /Cerrar día/ })
    expect(closeBtn).toBeDisabled()
  })

  it('closes the day when there is nothing pending', async () => {
    const { dailyClosuresApi: mockedApi } = await import('@/lib/api/dailyClosures')
    vi.mocked(mockedApi.get).mockResolvedValue({
      ...STATUS, pending_count: 0, unassigned_count: 0, mismatch_count: 0, assigned_count: 3,
      drivers: STATUS.drivers.map(d => ({ ...d, status: 'ASSIGNED' as const })),
    })
    vi.mocked(mockedApi.close).mockResolvedValue({ ok: true, business_date: '2026-07-21', overridden: 0 })
    renderPage()
    const closeBtn = await screen.findByRole('button', { name: /Cerrar día/ })
    expect(closeBtn).not.toBeDisabled()
    fireEvent.click(closeBtn)
    await waitFor(() => expect(mockedApi.close).toHaveBeenCalledWith('2026-07-21', false, ''))
  })
})
