import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/hooks/useCanAdmin', () => ({ useCanAdmin: () => true }))
import type { TripStatusRow } from '@/lib/api/config'

vi.mock('@/lib/api/config', () => ({
  configApi: { getStatuses: vi.fn(), patchStatus: vi.fn(), moveStatus: vi.fn() },
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
      <EstadoPanel estado={s} hermanos={hermanos} revision={null}
        onConfirmar={vi.fn()} confirmando={false} onGuardado={vi.fn()} onCerrar={onCerrar} />
    </QueryClientProvider>,
  )
  return { onCerrar, vista }
}

beforeEach(() => {
  vi.mocked(configApi.patchStatus).mockReset()
  vi.mocked(configApi.patchStatus).mockResolvedValue(estado())
  vi.mocked(configApi.moveStatus).mockReset()
  vi.mocked(configApi.moveStatus).mockResolvedValue(CATALOGO)
})

describe('EstadoPanel', () => {
  // El nombre del TMS lo define el TMS, no Configuracion: se muestra pero no
  // hay ningun campo que lo edite.
  it('muestra el nombre crudo del TMS, sin campo que lo edite', () => {
    montarPanel()
    expect(screen.getByText('ASIGNADO')).toBeInTheDocument()
    expect(screen.queryByLabelText(/nombre en el tms/i)).not.toBeInTheDocument()
  })

  // La lista vieja explicaba arriba de todo que los estados los define el TMS
  // y no se crean ni se borran. Se perdió al rediseñarla, y es justo la
  // respuesta a lo que uno se pregunta parado frente a un estado.
  it('explica por qué no hay dónde crear ni borrar un estado', () => {
    montarPanel()
    expect(screen.getByText(/lo define el TMS/i)).toBeInTheDocument()
    expect(screen.getByText(/no se crean ni se borran/i)).toBeInTheDocument()
  })

  // Era un `title` sobre el encabezado de una columna que ya no existe:
  // invisible para quien no pasa el mouse por encima.
  it('dice para qué sirve la columna del tablero, sin tener que pasar el mouse', () => {
    montarPanel()
    expect(screen.getByText(/en qué columna del tablero aparecen los viajes/i)).toBeInTheDocument()
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
        <EstadoPanel estado={estado({ id: 'EN_RUTA', label: 'En ruta' })} hermanos={CATALOGO}
          revision={null} onConfirmar={vi.fn()} confirmando={false} onGuardado={vi.fn()} onCerrar={vi.fn()} />
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

    // El panel manda la DIRECCIÓN, no un número. Calcular el sort_order acá
    // era lo que obligaba a dos llamadas, y con ellas al empate cuando la
    // segunda no llegaba.
    it('bajar pide un lugar hacia abajo, sin calcular ningún número', async () => {
      montarPanel()
      fireEvent.click(screen.getByRole('button', { name: /bajar/i }))
      await waitFor(() => expect(configApi.moveStatus).toHaveBeenCalledWith('ASIGNADO', 'down'))
      expect(configApi.moveStatus).toHaveBeenCalledTimes(1)
      expect(configApi.patchStatus).not.toHaveBeenCalled()
    })

    it('subir pide un lugar hacia arriba', async () => {
      montarPanel(estado({ id: 'EN_BODEGA', label: 'En bodega', sort_order: 3 }))
      fireEvent.click(screen.getByRole('button', { name: /subir/i }))
      await waitFor(() => expect(configApi.moveStatus).toHaveBeenCalledWith('EN_BODEGA', 'up'))
      expect(configApi.moveStatus).toHaveBeenCalledTimes(1)
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
      vi.mocked(configApi.moveStatus).mockRejectedValue(new Error('sin red'))
      montarPanel()
      fireEvent.click(screen.getByRole('button', { name: /bajar/i }))
      await waitFor(() => expect(screen.getByText('sin red')).toBeInTheDocument())
    })
  })
})
