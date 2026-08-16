import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TaxonomyTab } from './estados-tabs'
import { taxonomiesApi } from '@/lib/api/config'

vi.mock('@/lib/api/config', () => ({
  taxonomiesApi: { list: vi.fn(), create: vi.fn(), patch: vi.fn(), deactivate: vi.fn() },
}))

beforeEach(() => {
  vi.mocked(taxonomiesApi.list).mockReset()
  vi.mocked(taxonomiesApi.create).mockReset()
  vi.mocked(taxonomiesApi.deactivate).mockReset()
  // jsdom no implementa window.confirm: sin este doble devuelve undefined y el
  // handler corta antes de llamar a la API, con lo que el test verde no
  // probaria nada.
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('TaxonomyTab', () => {
  it('lists rows for the given domain and hides the board-column select for non-OPERATIONAL_STATE domains', async () => {
    vi.mocked(taxonomiesApi.list).mockResolvedValue([
      { id: 't1', label: 'Disponible', bg_color: '#f0fdf4', text_color: '#166534', sort_order: 1, active: true },
    ])
    render(<TaxonomyTab domain="EQUIPMENT_STATE" title="Estados de Equipo" hint="hint" newLabel="estado de equipo" />)
    expect(await screen.findByDisplayValue('Disponible')).toBeInTheDocument()
    expect(taxonomiesApi.list).toHaveBeenCalledWith('EQUIPMENT_STATE')
    expect(screen.queryByText('Columna del tablero')).not.toBeInTheDocument()
  })

  it('creates a new row scoped to the domain', async () => {
    vi.mocked(taxonomiesApi.list).mockResolvedValue([])
    vi.mocked(taxonomiesApi.create).mockResolvedValue({
      id: 't2', label: 'En Pana', bg_color: '#fef2f2', text_color: '#b91c1c', sort_order: 3, active: true,
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
      { id: 't1', label: 'En bodega', bg_color: '#f3f4f6', text_color: '#374151', sort_order: 1, active: true, group: 'otro' },
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
    bg_color: '#f3f4f6', text_color: '#374151', sort_order: 1, active: true,
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
