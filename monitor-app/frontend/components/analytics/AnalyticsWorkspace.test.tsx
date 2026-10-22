import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AnalyticsWorkspace } from './AnalyticsWorkspace'
import { analyticsApi, ExportTooLargeError, type AnalyticsColumnMeta, type AnalyticsPage } from '@/lib/api/analytics'

const permisos = vi.hoisted(() => ({ lista: ['analytics.read', 'analytics.export'] as string[] }))
vi.mock('@/lib/authz/PermisosProvider', () => ({
  usePermiso: (p: string) => permisos.lista.includes(p),
}))
vi.mock('next/navigation', async () => (await import('@/lib/testing/inMemoryNavigation')).nextNavigation)
vi.mock('@/lib/api/tablePreferences', () => ({
  tablePreferencesApi: { get: vi.fn().mockResolvedValue(null), save: vi.fn(), reset: vi.fn() },
}))
vi.mock('@/lib/api/analytics', async (orig) => {
  const real = await orig<typeof import('@/lib/api/analytics')>()
  return {
    ...real,
    analyticsApi: { columns: vi.fn(), rows: vi.fn(), export: vi.fn(), views: vi.fn().mockResolvedValue([]),
      createView: vi.fn(), updateView: vi.fn(), deleteView: vi.fn() },
  }
})
import { memoryUrl } from '@/lib/testing/inMemoryNavigation'
import { tablePreferencesApi } from '@/lib/api/tablePreferences'

const COLUMNAS: AnalyticsColumnMeta[] = [
  { id: 'trip_code', label: 'Nº de viaje', group: 'Viaje', type: 'text', filter: 'none', default_visible: true },
  { id: 'client_name', label: 'Cliente', group: 'Cliente', type: 'text', filter: 'values', default_visible: true },
]
const PAGINA: AnalyticsPage = {
  rows: [{ _id: 'a', trip_code: '2079231', client_name: 'Walmart' }],
  total: 1, counts: { client_name: { Walmart: 1 } }, loaded_at: new Date().toISOString(),
}
const VACIA: AnalyticsPage = { rows: [], total: 0, counts: {}, loaded_at: new Date().toISOString() }

function pintar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><AnalyticsWorkspace /></QueryClientProvider>)
}

beforeEach(() => {
  permisos.lista = ['analytics.read', 'analytics.export']
  memoryUrl.reset('/dashboard/analytics')
  vi.mocked(analyticsApi.columns).mockReset().mockResolvedValue(COLUMNAS)
  vi.mocked(analyticsApi.rows).mockReset().mockResolvedValue(PAGINA)
  vi.mocked(analyticsApi.export).mockReset()
})

describe('AnalyticsWorkspace', () => {
  it('muestra la página que manda el servidor, con su total y la hora de los datos', async () => {
    pintar()
    expect(await screen.findByText('2079231')).toBeInTheDocument()
    expect(screen.getByText('1 resultado')).toBeInTheDocument()
    expect(screen.getByText(/^Datos al \d{2}:\d{2}/)).toBeInTheDocument()
  })

  it('vacío: dice el período y ofrece los últimos 30 días', async () => {
    memoryUrl.reset('/dashboard/analytics?period=custom&from=2026-10-01&to=2026-10-07')
    vi.mocked(analyticsApi.rows).mockResolvedValue(VACIA)
    pintar()
    expect(await screen.findByText('No hay viajes planificados entre el 01/10/2026 y el 07/10/2026')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ver los últimos 30 días' }))
    await waitFor(() => expect(memoryUrl.current()).toContain('period=last_30d'))
  })

  it('con filtros y cero filas: ofrece quitar los filtros', async () => {
    memoryUrl.reset('/dashboard/analytics?f.client_name=Otro')
    vi.mocked(analyticsApi.rows).mockResolvedValue(VACIA)
    pintar()
    expect(await screen.findByText('Ningún viaje cumple los filtros')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Quitar filtros' }))
    await waitFor(() => expect(memoryUrl.current()).not.toContain('f.client_name'))
  })

  it('cargando: sin total ni cifras', async () => {
    vi.mocked(analyticsApi.rows).mockReturnValue(new Promise(() => {}))
    pintar()
    await screen.findByRole('table')
    expect(screen.queryByText(/resultado/)).not.toBeInTheDocument()
  })

  it('error: dice que no se pudo y conserva la vista', async () => {
    memoryUrl.reset('/dashboard/analytics?f.client_name=Walmart')
    vi.mocked(analyticsApi.rows).mockRejectedValue(new Error('500'))
    pintar()
    expect(await screen.findByText('No se pudieron cargar los viajes')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
    expect(memoryUrl.current()).toContain('f.client_name=Walmart')
  })

  it('sin analytics.read: no tienes acceso', () => {
    permisos.lista = []
    pintar()
    expect(screen.getByText('No tienes acceso a Analítica')).toBeInTheDocument()
    expect(analyticsApi.rows).not.toHaveBeenCalled()
  })

  it('sin analytics.export el botón Excel está deshabilitado y explica por qué', async () => {
    permisos.lista = ['analytics.read']
    pintar()
    const boton = await screen.findByRole('button', { name: /Excel/ })
    expect(boton).toBeDisabled()
    expect(boton).toHaveAttribute('title', 'Pide a un supervisor que la descargue')
  })

  it('una descarga demasiado grande lo dice con el total', async () => {
    vi.mocked(analyticsApi.export).mockRejectedValue(new ExportTooLargeError(61234))
    pintar()
    await screen.findByText('2079231')
    const boton = screen.getByRole('button', { name: /Excel/ })
    await waitFor(() => expect(boton).toBeEnabled())
    fireEvent.click(boton)
    expect(await screen.findByText(
      'El período tiene 61.234 filas; el máximo por descarga es 50.000. Acota el período o los filtros.')).toBeInTheDocument()
  })

  it('cambiar el período pide la página 0 con el rango nuevo', async () => {
    pintar()
    await screen.findByText('2079231')
    fireEvent.change(screen.getByRole('combobox', { name: 'Período' }), { target: { value: 'last_month' } })
    await waitFor(() => {
      const ultima = vi.mocked(analyticsApi.rows).mock.calls.at(-1)![0]
      expect(ultima.period).toEqual({ preset: 'last_month' })
      expect(ultima.page).toBe(0)
    })
  })

  it('sin personal_data no existe el grupo Datos personales: las columnas son las que manda la API', async () => {
    pintar()
    await screen.findByText('2079231')
    expect(analyticsApi.columns).toHaveBeenCalledWith('trips')
    expect(screen.queryByText('Datos personales')).not.toBeInTheDocument()
  })

  it('Flota por día cambia el conjunto de datos y la palabra del vacío', async () => {
    vi.mocked(analyticsApi.rows).mockResolvedValue(VACIA)
    pintar()
    fireEvent.click(await screen.findByRole('button', { name: 'Flota por día' }))
    await waitFor(() => expect(analyticsApi.columns).toHaveBeenCalledWith('fleet'))
    expect(await screen.findByText(/^No hay registros entre el/)).toBeInTheDocument()
  })

  it('una preferencia con una columna retirada del catálogo no rompe la tabla', async () => {
    vi.mocked(tablePreferencesApi.get).mockResolvedValueOnce([
      { id: 'columna_retirada', hidden: false }, { id: 'client_name', hidden: true },
    ])
    pintar()
    expect(await screen.findByText('2079231')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('columnheader', { name: /Cliente/ })).not.toBeInTheDocument())
  })
})
