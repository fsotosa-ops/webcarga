import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { EMPTY_VIEW, type TableView } from '@/lib/table/viewInUrl'
import type { DataColumn } from './columns'
import { useDataTable } from './useDataTable'
import { ShortcutTiles } from './ShortcutTiles'
import { TableToolbar } from './TableToolbar'

type Fila = { id: string; empresa: string; estado: string }
const FILAS: Fila[] = [
  { id: '1', empresa: 'Hasa', estado: 'Asignado' },
  { id: '2', empresa: 'Hasa', estado: 'No trabajando' },
  { id: '3', empresa: 'Huemul', estado: 'No trabajando' },
  { id: '4', empresa: 'Huemul', estado: 'Sin motivo' },
  { id: '5', empresa: 'Huemul', estado: 'Trabajando sin asignación' },
]
const COLUMNAS: DataColumn<Fila>[] = [
  { id: 'empresa', header: 'Empresa', value: r => r.empresa },
  { id: 'estado', header: 'Estado', value: r => r.estado },
]
const TILES = [
  { value: null, label: 'Todos' },
  { value: 'Asignado', label: 'Asignados', tone: 'resolved' as const },
  { value: ['Sin motivo', 'Trabajando sin asignación'], label: 'No asignados' },
  { value: 'No trabajando', label: 'No trabajando' },
]

function Pantalla({ inicial = EMPTY_VIEW, cargando = false }: { inicial?: TableView; cargando?: boolean }) {
  const [view, setView] = useState(inicial)
  const model = useDataTable({ rows: FILAS, columns: COLUMNAS, getRowId: r => r.id, view, onViewChange: setView })
  return (<>
    <ShortcutTiles model={model} columnId="estado" tiles={TILES} loading={cargando} />
    <TableToolbar model={model} searchPlaceholder="Buscar" preferences={{ columns: null, save: () => {}, reset: () => {} }} />
  </>)
}

describe('ShortcutTiles (C1, C3)', () => {
  it('tocar un recuadro escribe el filtro de su columna y se ve como chip', () => {
    render(<Pantalla />)
    fireEvent.click(screen.getByRole('button', { name: 'No trabajando, 2' }))
    expect(screen.getByText('Estado: No trabajando')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'No trabajando, 2' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Todos, 5' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('el filtro puesto desde el embudo marca su recuadro; quitar el chip lo desmarca', () => {
    render(<Pantalla inicial={{ ...EMPTY_VIEW, filters: { estado: ['Asignado'] } }} />)
    expect(screen.getByRole('button', { name: 'Asignados, 1' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Quitar filtro Estado' }))
    expect(screen.getByRole('button', { name: 'Todos, 5' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('"Todos" quita el filtro de la columna', () => {
    render(<Pantalla inicial={{ ...EMPTY_VIEW, filters: { estado: ['Asignado'] } }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Todos, 5' }))
    expect(screen.queryByText('Estado: Asignado')).toBeNull()
  })

  it('la cifra es facetada: cuenta con los demás filtros', () => {
    render(<Pantalla inicial={{ ...EMPTY_VIEW, filters: { empresa: ['Hasa'], estado: ['Asignado'] } }} />)
    expect(screen.getByRole('button', { name: 'No trabajando, 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Todos, 2' })).toBeInTheDocument()
  })

  it('con dos valores elegidos ningún recuadro de valor queda marcado', () => {
    render(<Pantalla inicial={{ ...EMPTY_VIEW, filters: { estado: ['Asignado', 'No trabajando'] } }} />)
    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0)
  })

  it('mientras carga no hay cifras', () => {
    render(<Pantalla cargando />)
    expect(screen.getByRole('button', { name: 'Todos' })).not.toHaveTextContent(/\d/)
  })

  it('un recuadro de varios valores escribe todos, y el chip los nombra', () => {
    render(<Pantalla />)
    fireEvent.click(screen.getByRole('button', { name: 'No asignados, 2' }))
    expect(screen.getByText('Estado: Sin motivo, Trabajando sin asignación')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'No asignados, 2' })).toHaveAttribute('aria-pressed', 'true')
  })
})
