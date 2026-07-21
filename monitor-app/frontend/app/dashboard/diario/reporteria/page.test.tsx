import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ReporteriaPage from './page'
import type { DailyClosureReport } from '@/lib/types'

vi.mock('@/lib/api/dailyClosures', () => ({
  dailyClosuresApi: { report: vi.fn() },
}))

const REPORT: DailyClosureReport = {
  fecha_desde: '2026-07-01',
  fecha_hasta: '2026-07-21',
  rows: [
    { driver_id: 'd1', full_name: 'Juan Pérez', tax_id: '1', carrier_name: 'Transportes Sur', status: 'ASSIGNED', unassigned_reason_id: null, unassigned_reason_label: null, client_names: ['Walmart'], business_date: '2026-07-20' },
    { driver_id: 'd2', full_name: 'Ana Soto', tax_id: '2', carrier_name: 'Transportes Sur', status: 'UNASSIGNED', unassigned_reason_id: 'pana', unassigned_reason_label: 'Pana', client_names: [], business_date: '2026-07-20' },
    { driver_id: 'd3', full_name: 'Luis Rojas', tax_id: '3', carrier_name: 'Rios Ltda', status: 'MISMATCH', unassigned_reason_id: null, unassigned_reason_label: null, client_names: ['Sodimac'], business_date: '2026-07-21' },
  ],
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ReporteriaPage />
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  const { dailyClosuresApi } = await import('@/lib/api/dailyClosures')
  vi.mocked(dailyClosuresApi.report).mockReset().mockResolvedValue(REPORT)
})

describe('ReporteriaPage', () => {
  it('arma el pivot por defecto: Empresa (filas) x Estado (columnas)', async () => {
    renderPage()
    expect(await screen.findByText('Transportes Sur')).toBeInTheDocument()
    expect(screen.getByText('Rios Ltda')).toBeInTheDocument()
    expect(screen.getByText('Asignado')).toBeInTheDocument()
    expect(screen.getByText('No asignado')).toBeInTheDocument()
  })

  it('quita un campo de Filas con el botón de la chip', async () => {
    renderPage()
    await screen.findByText('Transportes Sur')
    const filasSection = screen.getByText('Filas').closest('div')!
    fireEvent.click(within(filasSection).getByRole('button'))
    // sin ningún campo en Filas, todo cae en "Total"
    await waitFor(() => expect(within(screen.getByRole('table')).getAllByText('Total').length).toBeGreaterThan(0))
  })

  it('agrega Fecha a Filas y permite elegir granularidad', async () => {
    renderPage()
    await screen.findByText('Transportes Sur')
    const filasSection = screen.getByText('Filas').closest('div')!
    fireEvent.change(within(filasSection).getByText('+ Agregar campo').closest('select')!, { target: { value: 'date' } })
    expect(await within(filasSection).findByText('Día')).toBeInTheDocument()
  })

  it('filtra por un valor de un campo agregado a Filtros', async () => {
    renderPage()
    await screen.findByText('Transportes Sur')
    const filtrosSection = screen.getByText('Filtros').closest('div')!
    fireEvent.change(within(filtrosSection).getByText('+ Agregar filtro').closest('select')!, { target: { value: 'carrier' } })
    await screen.findByText('Rios Ltda', { selector: 'label span, label' }).catch(() => null)
    // Desmarcar "Rios Ltda" en el filtro de Empresa
    const checkbox = within(filtrosSection).getAllByRole('checkbox').find(cb => cb.closest('label')?.textContent?.includes('Rios Ltda'))!
    fireEvent.click(checkbox)
    await waitFor(() => expect(screen.queryByText('Rios Ltda', { selector: 'td' })).not.toBeInTheDocument())
  })

  it('exporta CSV', async () => {
    const clickSpy = vi.fn()
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreateElement(tag)
      if (tag === 'a') el.click = clickSpy
      return el
    })
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() })

    renderPage()
    await screen.findByText('Transportes Sur')
    fireEvent.click(screen.getByRole('button', { name: /CSV/ }))

    expect(clickSpy).toHaveBeenCalled()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
})
