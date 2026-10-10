import { describe, it, expect, vi, beforeEach } from 'vitest'
// Permisos simulados: por defecto todos (los tests de edición no cambian);
// los de solo lectura los restringen (revisión final RBAC, hallazgo 3).
const permisos = vi.hoisted(() => ({ dados: null as Set<string> | null }))
vi.mock('@/lib/authz/PermisosProvider', () => ({
  usePermiso: (p: string) => permisos.dados === null || permisos.dados.has(p),
}))
import { render as renderCrudo, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TaxonomyTab } from './estados-tabs'
import { taxonomiesApi, revisionesApi } from '@/lib/api/config'

// La pestaña muestra el registro de revisión, que es react-query: sin el
// proveedor el componente entero no monta.
function render(ui: React.ReactElement) {
  return renderCrudo(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </QueryClientProvider>,
  )
}

vi.mock('@/lib/api/config', () => ({
  taxonomiesApi: { list: vi.fn(), create: vi.fn(), patch: vi.fn(), deactivate: vi.fn(), move: vi.fn() },
  revisionesApi: { list: vi.fn(), confirm: vi.fn() },
}))

beforeEach(() => {
  permisos.dados = null
  vi.mocked(taxonomiesApi.list).mockReset()
  vi.mocked(taxonomiesApi.create).mockReset()
  vi.mocked(taxonomiesApi.deactivate).mockReset()
  vi.mocked(taxonomiesApi.move).mockReset()
  vi.mocked(revisionesApi.list).mockReset()
  vi.mocked(revisionesApi.list).mockResolvedValue([])
  vi.mocked(revisionesApi.confirm).mockReset()
  vi.mocked(revisionesApi.confirm).mockResolvedValue({ revisado: true })
  // jsdom no implementa window.confirm: sin este doble devuelve undefined y el
  // handler corta antes de llamar a la API, con lo que el test verde no
  // probaria nada.
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

const UNO = { id: 't1', label: 'Uno', bg_color: '#fff', text_color: '#000', sort_order: 1, active: true, code: null }
const DOS = { id: 't2', label: 'Dos', bg_color: '#fff', text_color: '#000', sort_order: 2, active: true, code: null }

describe('TaxonomyTab', () => {
  // Antes esto eran DOS patch seguidos con un sort_order calculado acá: si el
  // segundo no llegaba, las dos filas quedaban con el mismo número. Ahora se
  // manda la dirección y el orden lo decide —y lo devuelve— el servidor.
  it('mover manda la dirección, no un número calculado acá', async () => {
    vi.mocked(taxonomiesApi.list).mockResolvedValue([UNO, DOS])
    vi.mocked(taxonomiesApi.move).mockResolvedValue([DOS, UNO])
    render(<TaxonomyTab domain="EQUIPMENT_STATE" title="t" hint="hint" newLabel="estado" />)
    await screen.findByDisplayValue('Uno')

    fireEvent.click(screen.getByRole('button', { name: /subir dos/i }))

    await waitFor(() => expect(taxonomiesApi.move).toHaveBeenCalledWith('t2', 'up'))
    expect(taxonomiesApi.patch).not.toHaveBeenCalled()
  })

  // El servidor devuelve el dominio completo ya ordenado: la pantalla lo toma
  // tal cual en vez de recalcularlo, que es de donde salían las dos verdades.
  it('la lista queda en el orden que devolvió el servidor', async () => {
    vi.mocked(taxonomiesApi.list).mockResolvedValue([UNO, DOS])
    vi.mocked(taxonomiesApi.move).mockResolvedValue([DOS, UNO])
    render(<TaxonomyTab domain="EQUIPMENT_STATE" title="t" hint="hint" newLabel="estado" />)
    await screen.findByDisplayValue('Uno')

    fireEvent.click(screen.getByRole('button', { name: /subir dos/i }))

    await waitFor(() => {
      const campos = screen.getAllByRole('textbox').map(i => (i as HTMLInputElement).value)
      expect(campos).toEqual(['Dos', 'Uno'])
    })
  })

  it('lists rows for the given domain and hides the board-column select for non-OPERATIONAL_STATE domains', async () => {
    vi.mocked(taxonomiesApi.list).mockResolvedValue([
      { id: 't1', label: 'Disponible', bg_color: '#f0fdf4', text_color: '#166534', sort_order: 1, active: true, code: null },
    ])
    render(<TaxonomyTab domain="EQUIPMENT_STATE" title="Estados de Equipo" hint="hint" newLabel="estado de equipo" />)
    expect(await screen.findByDisplayValue('Disponible')).toBeInTheDocument()
    expect(taxonomiesApi.list).toHaveBeenCalledWith('EQUIPMENT_STATE')
    expect(screen.queryByText('Columna del tablero')).not.toBeInTheDocument()
  })

  it('creates a new row scoped to the domain', async () => {
    vi.mocked(taxonomiesApi.list).mockResolvedValue([])
    vi.mocked(taxonomiesApi.create).mockResolvedValue({
      id: 't2', label: 'En Pana', bg_color: '#fef2f2', text_color: '#b91c1c', sort_order: 3, active: true, code: null,
    })
    render(<TaxonomyTab domain="EQUIPMENT_STATE" title="Estados de Equipo" hint="hint" newLabel="estado de equipo" />)
    fireEvent.click(await screen.findByText('Nuevo estado de equipo'))
    fireEvent.change(screen.getByLabelText('Nombre de estado de equipo nuevo'), { target: { value: 'En Pana' } })
    fireEvent.click(screen.getByText('Crear'))
    await waitFor(() => expect(taxonomiesApi.create).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'EQUIPMENT_STATE', label: 'En Pana' }),
    ))
  })

  it('shows the board-column select for OPERATIONAL_STATE domain', async () => {
    vi.mocked(taxonomiesApi.list).mockResolvedValue([
      { id: 't1', label: 'En bodega', bg_color: '#f3f4f6', text_color: '#374151', sort_order: 1, active: true, group: 'otro', code: null },
    ])
    render(<TaxonomyTab domain="OPERATIONAL_STATE" title="Estados Operacionales" hint="hint" newLabel="estado operacional" />)
    expect(await screen.findByDisplayValue('En bodega')).toBeInTheDocument()
    expect(screen.getByText('Columna del tablero')).toBeInTheDocument()
  })
})

// El borrado es logico: el UUID sobrevive y las condiciones de documento que lo
// referencian NO se rompen. Lo que se rompe es la lectura de la pantalla de
// Condiciones, donde la regla pasa a verse como "0 marcas" sin serlo. Por eso el
// aviso es del momento de desactivar, no una alerta persistente.
describe('TaxonomyTab — aviso al desactivar un valor en uso', () => {
  const FURGON = {
    id: 'f4ee2299', label: 'Furgón Seco',
    bg_color: '#f3f4f6', text_color: '#374151', sort_order: 1, active: true, code: null,
  }

  function renderSubtipos() {
    vi.mocked(taxonomiesApi.list).mockResolvedValue([FURGON])
    render(<TaxonomyTab domain="FLEET_SERVICE_TYPE" title="Subtipos" hint="" newLabel="subtipo" />)
    return screen.findByRole('button', { name: /desactivar/i })
  }

  it('al desactivar un valor en uso avisa cuantas reglas lo usaban', async () => {
    vi.mocked(taxonomiesApi.deactivate).mockResolvedValue({ desactivado: true, en_uso_por: 2 })

    fireEvent.click(await renderSubtipos())

    expect(await screen.findByText(/2 reglas de documento/i)).toBeInTheDocument()
  })

  it('con una sola regla lo dice en singular', async () => {
    vi.mocked(taxonomiesApi.deactivate).mockResolvedValue({ desactivado: true, en_uso_por: 1 })

    fireEvent.click(await renderSubtipos())

    expect(await screen.findByText(/una regla de documento/i)).toBeInTheDocument()
  })

  it('sin reglas usandolo no muestra aviso', async () => {
    vi.mocked(taxonomiesApi.deactivate).mockResolvedValue({ desactivado: true, en_uso_por: 0 })

    fireEvent.click(await renderSubtipos())

    // Se espera a que la fila desaparezca — que ocurre DESPUES de guardar el
    // aviso en el mismo handler. Esperar solo a que la API fuera llamada
    // dejaria pasar un aviso que se dibuja un tick mas tarde.
    await waitFor(() => expect(screen.queryByDisplayValue('Furgón Seco')).not.toBeInTheDocument())
    expect(screen.queryByText(/regla de documento|reglas de documento/i)).not.toBeInTheDocument()
  })

  it('el aviso nombra donde revisar', async () => {
    vi.mocked(taxonomiesApi.deactivate).mockResolvedValue({ desactivado: true, en_uso_por: 2 })

    fireEvent.click(await renderSubtipos())

    expect(await screen.findByText(/Certificación · Condiciones/)).toBeInTheDocument()
  })
})

describe('solo lectura (revisión final RBAC, hallazgo 3)', () => {
  it('sin operations.configure el vocabulario se ve pero no se edita', async () => {
    permisos.dados = new Set(['certification.configure'])
    vi.mocked(taxonomiesApi.list).mockResolvedValue([
      { id: 't1', domain: 'OPERATIONAL_STATE', label: 'En ruta', group: null, bg_color: null, text_color: null, active: true, sort_order: 1 },
    ] as never)
    render(<TaxonomyTab domain="OPERATIONAL_STATE" title="Estados" hint="x" newLabel="estado" />)
    expect(await screen.findByDisplayValue('En ruta')).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Nuevo estado/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Desactivar En ruta/ })).not.toBeInTheDocument()
  })
})

