import { describe, it, expect, vi } from 'vitest'
import { act, render, renderHook, screen } from '@testing-library/react'
import { useState } from 'react'
import { EMPTY_VIEW, type TableView } from '@/lib/table/viewInUrl'
import type { DataColumn } from './columns'
import { useDataTable, type ServerMode } from './useDataTable'
import { DataTable } from './DataTable'

type Fila = { id: string; cliente: string }
const FILAS: Fila[] = [{ id: '1', cliente: 'Walmart' }, { id: '2', cliente: 'Sodimac' }]
const COLUMNAS: DataColumn<Fila>[] = [{ id: 'cliente', header: 'Cliente', value: r => r.cliente }]

function usar(server: ServerMode, inicial: TableView = EMPTY_VIEW) {
  return renderHook(() => {
    const [view, setView] = useState<TableView>(inicial)
    return useDataTable({ rows: FILAS, columns: COLUMNAS, getRowId: r => r.id, view, onViewChange: setView, server })
  })
}

const SERVER = (over: Partial<ServerMode> = {}): ServerMode => ({
  total: 120, counts: { cliente: { Walmart: 80, Sodimac: 40 } }, page: 0, pageSize: 50, onPage: vi.fn(), ...over,
})

describe('useDataTable en modo servidor', () => {
  it('no filtra ni ordena en el cliente: las filas son las que mandó el servidor', () => {
    const { result } = usar(SERVER(), { ...EMPTY_VIEW, filters: { cliente: ['Otro'] }, sort: { column: 'cliente', dir: 'asc' } })
    expect(result.current.pageRows.map(r => r.id)).toEqual(['1', '2'])
  })

  it('las cifras y los valores de un filtro salen de counts', () => {
    const { result } = usar(SERVER())
    expect(result.current.facetCount('cliente', 'Walmart')).toBe(80)
    expect(result.current.valuesOf('cliente')).toEqual(['Walmart', 'Sodimac'])
  })

  it('cambiar el filtro vuelve a la página 0', () => {
    const onPage = vi.fn()
    const { result } = usar(SERVER({ page: 2, onPage }))
    act(() => result.current.setFilter('cliente', ['Walmart']))
    expect(onPage).toHaveBeenCalledWith(0, 50)
  })

  it('el total y las páginas salen del servidor', () => {
    const { result } = usar(SERVER())
    expect(result.current.total).toBe(120)
    expect(result.current.table.getPageCount()).toBe(3)
  })

  it('sin total no hay cifra', () => {
    function Tabla() {
      const [view, setView] = useState<TableView>(EMPTY_VIEW)
      const model = useDataTable({ rows: FILAS, columns: COLUMNAS, getRowId: r => r.id, view, onViewChange: setView,
        server: SERVER({ total: null }) })
      return <DataTable model={model} label="Viajes" empty="Nada" />
    }
    render(<Tabla />)
    expect(screen.queryByText(/resultados/)).not.toBeInTheDocument()
    expect(screen.queryByText(/de \d/)).not.toBeInTheDocument()
  })

  it('la página siguiente se pide al servidor', () => {
    const onPage = vi.fn()
    function Tabla() {
      const [view, setView] = useState<TableView>(EMPTY_VIEW)
      const model = useDataTable({ rows: FILAS, columns: COLUMNAS, getRowId: r => r.id, view, onViewChange: setView,
        server: SERVER({ onPage }) })
      return <DataTable model={model} label="Viajes" empty="Nada" />
    }
    render(<Tabla />)
    expect(screen.getByText('120 resultados')).toBeInTheDocument()
    act(() => screen.getByRole('button', { name: 'Página siguiente' }).click())
    expect(onPage).toHaveBeenCalledWith(1, 50)
  })
})
