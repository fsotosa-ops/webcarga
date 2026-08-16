import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/hooks/useCanAdmin', () => ({ useCanAdmin: () => true }))
import type { TripStatusRow } from '@/lib/api/config'

vi.mock('@/lib/api/config', () => ({
  configApi: { getStatuses: vi.fn(), patchStatus: vi.fn() },
}))

import { configApi } from '@/lib/api/config'
import { EstadoPanel } from './EstadoPanel'

function estado(patch: Partial<TripStatusRow> = {}): TripStatusRow {
  return {
    id: 'ASIGNADO',
    label: 'Asignado',
    bg_color: '#eff6ff',
    text_color: '#1d4ed8',
    group: 'en_ruta',
    sort_order: 1,
    ...patch,
  }
}

// El catálogo completo, en el orden del tablero. Reordenar es una operación
// RELATIVA: sin los hermanos el panel no sabe con quién intercambiarse.
const CATALOGO: TripStatusRow[] = [
  estado({ id: 'ASIGNADO',   label: 'Asignado',   sort_order: 1 }),
  estado({ id: 'EN_DESTINO', label: 'En destino', sort_order: 2 }),
  estado({ id: 'EN_BODEGA',  label: 'En bodega',  sort_order: 3 }),
]

function montarPanel(
  s: TripStatusRow = estado(), onCerrar = vi.fn(), hermanos: TripStatusRow[] = CATALOGO,
) {
  const vista = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EstadoPanel estado={s} hermanos={hermanos} onCerrar={onCerrar} />
    </QueryClientProvider>,
  )
  return { onCerrar, vista }
}

beforeEach(() => {
  vi.mocked(configApi.patchStatus).mockReset()
  vi.mocked(configApi.patchStatus).mockResolvedValue(estado())
})

describe('EstadoPanel', () => {
  // El nombre del TMS lo define el TMS, no Configuracion: se muestra pero no
  // hay ningun campo que lo edite.
  it('muestra el nombre crudo del TMS, sin campo que lo edite', () => {
    montarPanel()
    expect(screen.getByText('ASIGNADO')).toBeInTheDocument()
    expect(screen.queryByLabelText(/nombre en el tms/i)).not.toBeInTheDocument()
  })

  it('el panel se cierra con Escape', () => {
    const { onCerrar } = montarPanel()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCerrar).toHaveBeenCalled()
  })

  it('sin cambios no ofrece guardar', () => {
    montarPanel()
    expect(screen.queryByRole('button', { name: /^guardar$/i })).not.toBeInTheDocument()
  })

  it('cambiar el nombre visible ofrece guardar', () => {
    montarPanel()
    fireEvent.change(screen.getByLabelText(/nombre visible/i), { target: { value: 'En camino' } })
    expect(screen.getByRole('button', { name: /^guardar$/i })).toBeInTheDocument()
  })

  it('guarda el nombre visible', async () => {
    montarPanel()
    fireEvent.change(screen.getByLabelText(/nombre visible/i), { target: { value: 'En camino' } })
    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }))
    await waitFor(() => expect(configApi.patchStatus).toHaveBeenCalledWith(
      'ASIGNADO', { label: 'En camino', bg_color: '#eff6ff', text_color: '#1d4ed8', group: 'en_ruta' }))
  })

  it('guarda la columna del tablero elegida', async () => {
    montarPanel()
    fireEvent.change(screen.getByLabelText(/columna del tablero/i), { target: { value: 'en_local' } })
    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }))
    await waitFor(() => expect(configApi.patchStatus).toHaveBeenCalledWith(
      'ASIGNADO', { label: 'Asignado', bg_color: '#eff6ff', text_color: '#1d4ed8', group: 'en_local' }))
  })

  // La paleta no se dibuja de entrada: aparece solo al abrir el selector, que
  // es el reemplazo de las 8 pastillas por fila de la lista vieja.
  it('la paleta de color esta cerrada de entrada, y se abre al elegir', () => {
    montarPanel()
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /cambiar color/i }))
    expect(screen.getAllByRole('radio').length).toBeGreaterThan(0)
  })

  it('elegir un color de la paleta ofrece guardar', async () => {
    montarPanel()
    fireEvent.click(screen.getByRole('button', { name: /cambiar color/i }))
    fireEvent.click(screen.getByRole('radio', { name: /verde/i }))
    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }))
    await waitFor(() => expect(configApi.patchStatus).toHaveBeenCalledWith(
      'ASIGNADO', { label: 'Asignado', bg_color: '#f0fdf4', text_color: '#166534', group: 'en_ruta' }))
  })

  // Clase de bug recurrente en este proyecto: el borrador que no se
  // resincroniza cuando el prop cambia deja la pantalla mostrando lo viejo.
  it('si se abre otro estado, el borrador se resincroniza', () => {
    const { vista } = montarPanel(estado({ id: 'ASIGNADO', label: 'Asignado' }))
    fireEvent.change(screen.getByLabelText(/nombre visible/i), { target: { value: 'sucio' } })
    vista.rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <EstadoPanel estado={estado({ id: 'EN_RUTA', label: 'En ruta' })} hermanos={CATALOGO} onCerrar={vi.fn()} />
      </QueryClientProvider>,
    )
    expect(screen.getByLabelText(/nombre visible/i)).toHaveValue('En ruta')
  })

  it('si falla el guardado, lo dice', async () => {
    vi.mocked(configApi.patchStatus).mockRejectedValue(new Error('sin red'))
    montarPanel()
    fireEvent.change(screen.getByLabelText(/nombre visible/i), { target: { value: 'En camino' } })
    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }))
    await waitFor(() => expect(screen.getByText('sin red')).toBeInTheDocument())
  })

  // El orden del tablero es un dato curado a mano —los 25 estados tienen su
  // propio número— y es el ORDER BY con el que el backend sirve la lista. Sin
  // esto, cambiarlo exige SQL a mano.
  describe('orden en el tablero', () => {
    it('dice qué posición ocupa el estado', () => {
      montarPanel(estado({ id: 'EN_DESTINO', label: 'En destino', sort_order: 2 }))
      expect(screen.getByText('2 de 3')).toBeInTheDocument()
    })

    // Intercambio con el vecino, no renumeración: mover uno no puede
    // reescribir el número de los otros 24.
    it('bajar intercambia el orden con el estado siguiente', async () => {
      montarPanel()
      fireEvent.click(screen.getByRole('button', { name: /bajar/i }))
      await waitFor(() => expect(configApi.patchStatus).toHaveBeenCalledWith('ASIGNADO', { sort_order: 2 }))
      expect(configApi.patchStatus).toHaveBeenCalledWith('EN_DESTINO', { sort_order: 1 })
    })

    it('subir intercambia el orden con el estado anterior', async () => {
      montarPanel(estado({ id: 'EN_BODEGA', label: 'En bodega', sort_order: 3 }))
      fireEvent.click(screen.getByRole('button', { name: /subir/i }))
      await waitFor(() => expect(configApi.patchStatus).toHaveBeenCalledWith('EN_BODEGA', { sort_order: 2 }))
      expect(configApi.patchStatus).toHaveBeenCalledWith('EN_DESTINO', { sort_order: 3 })
    })

    it('el primero no puede subir', () => {
      montarPanel()
      expect(screen.getByRole('button', { name: /subir/i })).toBeDisabled()
      expect(screen.getByRole('button', { name: /bajar/i })).not.toBeDisabled()
    })

    it('el último no puede bajar', () => {
      montarPanel(estado({ id: 'EN_BODEGA', label: 'En bodega', sort_order: 3 }))
      expect(screen.getByRole('button', { name: /bajar/i })).toBeDisabled()
    })

    it('si falla el reordenamiento, lo dice', async () => {
      vi.mocked(configApi.patchStatus).mockRejectedValue(new Error('sin red'))
      montarPanel()
      fireEvent.click(screen.getByRole('button', { name: /bajar/i }))
      await waitFor(() => expect(screen.getByText('sin red')).toBeInTheDocument())
    })
  })
})
