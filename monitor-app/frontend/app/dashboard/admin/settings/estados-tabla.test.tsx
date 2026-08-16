import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/hooks/useCanAdmin', () => ({ useCanAdmin: () => true }))
import type { TripStatusRow } from '@/lib/api/config'

vi.mock('@/lib/api/config', () => ({
  configApi: { getStatuses: vi.fn(), patchStatus: vi.fn() },
}))

// El estado abierto VIAJA EN LA URL, como un documento de Condiciones: cada
// test elige qué trae.
let urlActual = ''
const reemplazar = vi.fn()
const empujar = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: reemplazar, push: empujar }),
  usePathname: () => '/dashboard/admin/settings/operations',
  useSearchParams: () => new URLSearchParams(urlActual),
}))

import { configApi } from '@/lib/api/config'
import { EstadosTabla } from './estados-tabla'

// El orden de llegada NO coincide ni con el alfabetico del nombre visible ni
// con sort_order: si coincidiera, ordenar por cualquier columna daria el
// mismo resultado que no ordenar y el test pasaria sin probar nada.
const ESTADOS: TripStatusRow[] = [
  { id: 'EN_BODEGA', label: 'En bodega', bg_color: '#f0fdf4', text_color: '#166534', group: 'en_local', sort_order: 3 },
  { id: 'ASIGNADO', label: 'Asignado', bg_color: '#eff6ff', text_color: '#1d4ed8', group: 'en_ruta', sort_order: 1 },
  { id: 'EN_DESTINO', label: 'En destino', bg_color: '#fef9c3', text_color: '#854d0e', group: 'en_local', sort_order: 2 },
]

function montar() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EstadosTabla />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  urlActual = ''
  reemplazar.mockClear()
  empujar.mockClear()
  vi.mocked(configApi.getStatuses).mockReset()
  vi.mocked(configApi.getStatuses).mockResolvedValue(ESTADOS)
})

describe('EstadosTabla', () => {
  // 250 botones de color eran las 8 pastillas repetidas en 25 filas. La
  // pastilla renderizada YA es la vista previa; el color se elige en el
  // panel. El componente que dibujaba esas 8 pastillas por fila
  // (SwatchPicker, en shared.tsx) las expone como role="radio", no
  // role="button" — comprobar por "button" con nombre /color/i no habria
  // detectado la regresion original. El chequeo real es que no aparezca
  // ningun radio de color en la lista.
  it('no dibuja la paleta en la lista', async () => {
    montar()
    await waitFor(() => expect(screen.getByText('Asignado')).toBeInTheDocument())
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
  })

  // Si alguien renombra el nombre visible, el crudo es lo unico que permite
  // reconocer de que estado se trata.
  it('conserva visible el nombre crudo del TMS', async () => {
    montar()
    await waitFor(() => expect(screen.getByText('ASIGNADO')).toBeInTheDocument())
  })

  it('los chips filtran por columna del tablero', async () => {
    montar()
    await waitFor(() => expect(screen.getByText('Asignado')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /en local/i }))
    expect(screen.queryByText('Asignado')).not.toBeInTheDocument()
    expect(screen.getByText('En bodega')).toBeInTheDocument()
    expect(screen.getByText('En destino')).toBeInTheDocument()
  })

  // Las columnas del tablero salen del propio dato: cuentan cuantos estados
  // hay en cada columna, no una lista de columnas posibles escrita a mano.
  it('el chip dice cuantos estados hay en esa columna', async () => {
    montar()
    await waitFor(() => expect(screen.getByText('Asignado')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /en local/i })).toHaveTextContent('2')
    expect(screen.getByRole('button', { name: /en ruta/i })).toHaveTextContent('1')
  })

  it('ordena por "Cómo se ve" al hacer clic en su encabezado', async () => {
    montar()
    await waitFor(() => expect(screen.getByText('Asignado')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /cómo se ve/i }))
    const filas = screen.getAllByRole('row').slice(1)
    expect(filas[0]).toHaveTextContent('Asignado')
    expect(filas[1]).toHaveTextContent('En bodega')
    expect(filas[2]).toHaveTextContent('En destino')
  })

  it('el encabezado ordenado lo declara de forma accesible', async () => {
    montar()
    await waitFor(() => expect(screen.getByText('Asignado')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /cómo se ve/i }))
    expect(screen.getByRole('columnheader', { name: /cómo se ve/i }))
      .toHaveAttribute('aria-sort', 'ascending')
  })

  // De entrada manda el orden del tablero (sort_order), que es el orden por
  // defecto.
  it('de entrada ordena por el orden del tablero', async () => {
    montar()
    await waitFor(() => expect(screen.getByText('Asignado')).toBeInTheDocument())
    const filas = screen.getAllByRole('row').slice(1)
    expect(filas[0]).toHaveTextContent('Asignado')
    expect(filas[1]).toHaveTextContent('En destino')
    expect(filas[2]).toHaveTextContent('En bodega')
  })

  // El chevron es el unico camino a la edicion: sin nombre, un lector de
  // pantalla anuncia 25 botones identicos.
  it('cada fila ofrece abrirse, y el boton nombra la fila', async () => {
    montar()
    await waitFor(() => expect(screen.getByText('Asignado')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /editar asignado/i })).toBeInTheDocument()
  })

  // El panel abre con URL propia, como Condiciones: editar un estado es
  // enlazable, y recargar no devuelve a la lista.
  it('el chevron escribe el estado en la URL', async () => {
    montar()
    await waitFor(() => expect(screen.getByText('Asignado')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /editar asignado/i }))
    // `push` y no `replace`: abrir el panel deja una entrada en el historial,
    // asi el boton de atras del navegador lo CIERRA en vez de sacar de la
    // pantalla entera.
    expect(empujar).toHaveBeenCalledWith(
      '/dashboard/admin/settings/operations?estado=ASIGNADO')
  })

  it('con un estado en la URL el panel abre solo', async () => {
    urlActual = 'estado=ASIGNADO'
    montar()
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: /asignado/i })).toBeInTheDocument())
  })

  it('cerrar el panel quita el estado de la URL', async () => {
    urlActual = 'estado=ASIGNADO'
    montar()
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /cerrar/i }))
    expect(reemplazar).toHaveBeenCalledWith('/dashboard/admin/settings/operations')
  })

  // Cerrar es `replace` y no `push`: si cerrar tambien empujara, abrir y
  // cerrar dos veces dejaria cuatro entradas en el historial.
  it('cerrar el panel no ensucia el historial', async () => {
    urlActual = 'section=tms-statuses&estado=ASIGNADO'
    montar()
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /cerrar/i }))
    expect(reemplazar).toHaveBeenCalledWith(
      '/dashboard/admin/settings/operations?section=tms-statuses')
    expect(empujar).not.toHaveBeenCalled()
  })

  it('un estado que no existe en el catálogo no abre ningún panel', async () => {
    urlActual = 'estado=NO_EXISTE'
    montar()
    await waitFor(() => expect(screen.getByText('Asignado')).toBeInTheDocument())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('avisa cuando el catálogo no carga, y deja reintentar', async () => {
    vi.mocked(configApi.getStatuses).mockRejectedValue(new Error('sin red'))
    montar()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument())
  })
})
