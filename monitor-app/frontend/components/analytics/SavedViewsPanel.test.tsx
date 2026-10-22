import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AnalyticsWorkspace } from './AnalyticsWorkspace'
import { SavedViewsPanel } from './SavedViewsPanel'
import { analyticsApi, type AnalyticsColumnMeta, type SavedView } from '@/lib/api/analytics'
import { ApiError } from '@/lib/api/client'

const permisos = vi.hoisted(() => ({ lista: ['analytics.read'] as string[] }))
vi.mock('@/lib/authz/PermisosProvider', () => ({ usePermiso: (p: string) => permisos.lista.includes(p) }))
vi.mock('next/navigation', async () => (await import('@/lib/testing/inMemoryNavigation')).nextNavigation)
vi.mock('@/lib/api/tablePreferences', () => ({
  tablePreferencesApi: { get: vi.fn().mockResolvedValue(null), save: vi.fn(), reset: vi.fn() },
}))
vi.mock('@/lib/api/analytics', async (orig) => {
  const real = await orig<typeof import('@/lib/api/analytics')>()
  return { ...real, analyticsApi: { columns: vi.fn(), rows: vi.fn(), export: vi.fn(), views: vi.fn(),
    createView: vi.fn(), updateView: vi.fn(), deleteView: vi.fn() } }
})
import { memoryUrl } from '@/lib/testing/inMemoryNavigation'

const COLUMNAS: AnalyticsColumnMeta[] = [
  { id: 'trip_code', label: 'Nº de viaje', group: 'Viaje', type: 'text', filter: 'none', default_visible: true },
  { id: 'client_name', label: 'Cliente', group: 'Cliente', type: 'text', filter: 'values', default_visible: true },
  { id: 'destination_zone', label: 'Zona', group: 'Lugares', type: 'text', filter: 'values', default_visible: false },
]
const COMPARTIDA: SavedView = {
  id: 'v1', dataset: 'trips', name: 'Walmart RM', scope: 'shared', can_edit: false, is_mine: false, updated_at: '',
  view: { filters: { client_name: ['Walmart'] }, q: '', sort: null, period: { preset: 'last_month' }, date_field: 'planning' },
  columns: [{ id: 'trip_code', hidden: false }, { id: 'destination_zone', hidden: false }],
}
const MIA: SavedView = { ...COMPARTIDA, id: 'v2', name: 'Mía', scope: 'personal', can_edit: true, is_mine: true }

function pintar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><AnalyticsWorkspace /></QueryClientProvider>)
}

beforeEach(() => {
  permisos.lista = ['analytics.read']
  memoryUrl.reset('/dashboard/analytics')
  vi.mocked(analyticsApi.columns).mockReset().mockResolvedValue(COLUMNAS)
  vi.mocked(analyticsApi.rows).mockReset().mockResolvedValue({
    rows: [{ _id: 'a', trip_code: '1', client_name: 'Walmart', destination_zone: 'RM' }], total: 1, counts: {},
    loaded_at: null })
  vi.mocked(analyticsApi.views).mockReset().mockResolvedValue([COMPARTIDA, MIA])
  vi.mocked(analyticsApi.createView).mockReset()
  vi.mocked(analyticsApi.updateView).mockReset()
})

describe('vistas guardadas', () => {
  it('lista compartidas y mías', () => {
    render(<SavedViewsPanel views={[COMPARTIDA, MIA]} activeId={null} onApply={vi.fn()} onNew={vi.fn()} />)
    const panel = screen.getByRole('navigation', { name: 'Vistas guardadas' })
    expect(within(panel).getByText('Compartidas')).toBeInTheDocument()
    expect(within(panel).getByText('Mías')).toBeInTheDocument()
  })

  it('aplicar una vista escribe sus filtros, su período y sus columnas', async () => {
    pintar()
    fireEvent.click(await screen.findByRole('button', { name: 'Walmart RM' }))
    await waitFor(() => {
      const url = memoryUrl.current()
      expect(url).toContain('vista=v1')
      expect(url).toContain('f.client_name=Walmart')
      expect(url).toContain('period=last_month')
    })
    expect(await screen.findByRole('columnheader', { name: /Zona/ })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: /Cliente/ })).not.toBeInTheDocument()
  })

  it('un cambio sin guardar ofrece guardar (si puede editar) y descartar', async () => {
    memoryUrl.reset('/dashboard/analytics?vista=v2&f.client_name=Walmart&period=last_month')
    pintar()
    await screen.findByText('1')
    fireEvent.change(screen.getByRole('combobox', { name: 'Período' }), { target: { value: 'today' } })
    expect(await screen.findByRole('button', { name: 'Guardar cambios' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    await waitFor(() => expect(memoryUrl.current()).toContain('period=last_month'))
  })

  it('una vista compartida ajena no ofrece guardar cambios', async () => {
    memoryUrl.reset('/dashboard/analytics?vista=v1&f.client_name=Walmart&period=last_month')
    pintar()
    await screen.findByText('1')
    fireEvent.change(screen.getByRole('combobox', { name: 'Período' }), { target: { value: 'today' } })
    expect(await screen.findByRole('button', { name: 'Descartar' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument()
  })

  it('guardar una vista nueva; sin manage_views no se ofrece compartir', async () => {
    vi.mocked(analyticsApi.createView).mockResolvedValue({ ...MIA, id: 'v9', name: 'Nueva' })
    pintar()
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva vista' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Guardar vista' })
    expect(within(dialogo).queryByRole('checkbox', { name: 'Compartir con el equipo' })).not.toBeInTheDocument()
    fireEvent.change(within(dialogo).getByRole('textbox', { name: 'Nombre' }), { target: { value: 'Nueva' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(analyticsApi.createView).toHaveBeenCalledWith(expect.objectContaining({
      dataset: 'trips', name: 'Nueva', scope: 'personal' })))
    await waitFor(() => expect(memoryUrl.current()).toContain('vista=v9'))
  })

  it('con manage_views se puede compartir', async () => {
    permisos.lista = ['analytics.read', 'analytics.manage_views']
    vi.mocked(analyticsApi.createView).mockResolvedValue({ ...COMPARTIDA, id: 'v8' })
    pintar()
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva vista' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Guardar vista' })
    fireEvent.change(within(dialogo).getByRole('textbox', { name: 'Nombre' }), { target: { value: 'Equipo' } })
    fireEvent.click(within(dialogo).getByRole('checkbox', { name: 'Compartir con el equipo' }))
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(analyticsApi.createView).toHaveBeenCalledWith(expect.objectContaining({ scope: 'shared' })))
  })

  it('un nombre repetido lo dice y no cierra', async () => {
    vi.mocked(analyticsApi.createView).mockRejectedValue(new ApiError('dup', 409, 'dup'))
    pintar()
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva vista' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Guardar vista' })
    fireEvent.change(within(dialogo).getByRole('textbox', { name: 'Nombre' }), { target: { value: 'Mía' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    expect(await within(dialogo).findByText('Ya hay una vista con ese nombre')).toBeInTheDocument()
    expect(within(dialogo).getByRole('textbox', { name: 'Nombre' })).toHaveValue('Mía')
  })

  it('un error de red no cierra el diálogo ni pierde el nombre', async () => {
    vi.mocked(analyticsApi.createView).mockRejectedValue(new Error('red'))
    pintar()
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva vista' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Guardar vista' })
    fireEvent.change(within(dialogo).getByRole('textbox', { name: 'Nombre' }), { target: { value: 'X' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    expect(await within(dialogo).findByText('No se pudo guardar la vista. Vuelve a intentarlo.')).toBeInTheDocument()
    expect(within(dialogo).getByRole('textbox', { name: 'Nombre' })).toHaveValue('X')
  })

  // ── Fix pass de la revisión final ──────────────────────────────────────────

  it('una vista con orden no aparece cambiada aunque la API devuelva las claves en otro orden (I1)', async () => {
    const conOrden: SavedView = { ...MIA, view: { ...MIA.view,
      sort: JSON.parse('{"dir": "asc", "column": "client_name"}'),
      period: JSON.parse('{"to": "2026-10-07", "from": "2026-10-01", "preset": "custom"}') } }
    vi.mocked(analyticsApi.views).mockResolvedValue([conOrden])
    memoryUrl.reset('/dashboard/analytics?vista=v2&f.client_name=Walmart&sort=client_name:asc&period=custom&from=2026-10-01&to=2026-10-07')
    pintar()
    await screen.findByText('1')
    await screen.findByRole('button', { name: 'Mía' })
    expect(screen.queryByRole('button', { name: 'Descartar' })).not.toBeInTheDocument()
  })

  it('una vista que ordena o filtra por una columna que no está en el catálogo abre sin ella (I2, Review Focus 4)', async () => {
    const vieja: SavedView = { ...MIA, view: { ...MIA.view, sort: { column: 'columna_retirada', dir: 'asc' },
      filters: { columna_retirada: ['x'], client_name: ['Walmart'] } } }
    vi.mocked(analyticsApi.views).mockResolvedValue([vieja])
    pintar()
    fireEvent.click(await screen.findByRole('button', { name: 'Mía' }))
    await waitFor(() => {
      const ultima = vi.mocked(analyticsApi.rows).mock.calls.at(-1)![0]
      expect(ultima.view.sort).toBeNull()
      expect(ultima.view.filters).toEqual({ client_name: ['Walmart'] })
    })
  })

  it('una URL con un orden por una columna que no existe no rompe la consulta', async () => {
    memoryUrl.reset('/dashboard/analytics?sort=driver_name:asc&f.driver_name=X')
    pintar()
    await screen.findByText('1')
    const ultima = vi.mocked(analyticsApi.rows).mock.calls.at(-1)![0]
    expect(ultima.view.sort).toBeNull()
    expect(ultima.view.filters).toEqual({})
  })

  it('el dueño renombra y borra su vista (I4)', async () => {
    vi.mocked(analyticsApi.updateView).mockResolvedValue({ ...MIA, name: 'Renombrada' })
    vi.mocked(analyticsApi.deleteView).mockResolvedValue(undefined)
    pintar()
    await screen.findByRole('button', { name: 'Mía' })
    expect(screen.queryByRole('button', { name: 'Borrar Walmart RM' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Renombrar Mía' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Renombrar vista' })
    fireEvent.change(within(dialogo).getByRole('textbox', { name: 'Nombre' }), { target: { value: 'Renombrada' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(analyticsApi.updateView).toHaveBeenCalledWith('v2', { name: 'Renombrada' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Borrar Renombrada' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Borrar vista' }))
    await waitFor(() => expect(analyticsApi.deleteView).toHaveBeenCalledWith('v2'))
  })

  it('si falla guardar los cambios, lo dice (M4)', async () => {
    vi.mocked(analyticsApi.updateView).mockRejectedValue(new Error('red'))
    memoryUrl.reset('/dashboard/analytics?vista=v2&f.client_name=Walmart&period=last_month')
    pintar()
    await screen.findByText('1')
    fireEvent.change(screen.getByRole('combobox', { name: 'Período' }), { target: { value: 'today' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText('No se pudieron guardar los cambios de la vista. Vuelve a intentarlo.')).toBeInTheDocument()
  })

  it('"BDOT completo" (all_columns) muestra todas menos las personales, y al guardar las conserva así (M3)', async () => {
    permisos.lista = ['analytics.read', 'analytics.manage_views']
    vi.mocked(analyticsApi.columns).mockResolvedValue([...COLUMNAS,
      { id: 'driver_name', label: 'Conductor', group: 'Datos personales', type: 'text', filter: 'none', default_visible: true, personal: true }])
    const bdot: SavedView = { ...MIA, id: 'v3', name: 'BDOT completo', columns: [],
      view: { ...MIA.view, filters: {}, all_columns: true } }
    vi.mocked(analyticsApi.views).mockResolvedValue([bdot])
    vi.mocked(analyticsApi.updateView).mockResolvedValue(bdot)
    pintar()
    fireEvent.click(await screen.findByRole('button', { name: 'BDOT completo' }))
    expect(await screen.findByRole('columnheader', { name: /Zona/ })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: /Conductor/ })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'Período' }), { target: { value: 'today' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => expect(analyticsApi.updateView).toHaveBeenCalledWith('v3', expect.objectContaining({
      view: expect.objectContaining({ all_columns: true }), columns: [] })))
  })
})
