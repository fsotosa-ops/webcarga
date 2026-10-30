import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { EMPTY_VIEW, type TableView } from '@/lib/table/viewInUrl'
import type { DataColumn } from './columns'
import { useDataTable } from './useDataTable'
import { ShortcutTiles, type ShortcutTileGroup } from './ShortcutTiles'
import { TableToolbar } from './TableToolbar'

// El modelo estándar del Cierre: un estado (Asignado / No asignado) y, solo para los
// no asignados, el tipo de su motivo. Los recuadros son atajos de esas dos columnas.
type Fila = { id: string; empresa: string; estado: string; tipo: string | null }
const FILAS: Fila[] = [
  { id: '1', empresa: 'Hasa', estado: 'Asignado', tipo: null },
  { id: '2', empresa: 'Hasa', estado: 'No asignado', tipo: 'No trabajó' },
  { id: '3', empresa: 'Huemul', estado: 'No asignado', tipo: 'No trabajó' },
  { id: '4', empresa: 'Huemul', estado: 'No asignado', tipo: 'Sin motivo' },
  { id: '5', empresa: 'Huemul', estado: 'No asignado', tipo: 'Trabajó sin asignación' },
]
const COLUMNAS: DataColumn<Fila>[] = [
  { id: 'empresa', header: 'Empresa', value: r => r.empresa },
  { id: 'estado', header: 'Estado', value: r => r.estado },
  { id: 'tipo', header: 'Tipo de motivo', value: r => r.tipo },
]
const GRUPOS: ShortcutTileGroup[] = [
  { tiles: [
    { value: null, label: 'Todos' },
    { column: 'estado', value: 'Asignado', label: 'Asignados', tone: 'resolved' },
    { column: 'estado', value: 'No asignado', label: 'No asignados' },
  ] },
  { label: 'Por tipo de motivo', tiles: [
    { column: 'tipo', value: 'Sin motivo', label: 'Sin motivo', tone: 'warning' },
    { column: 'tipo', value: 'Trabajó sin asignación', label: 'Trabajó sin asignación' },
    { column: 'tipo', value: 'No trabajó', label: 'No trabajó' },
  ] },
]

function Pantalla({ inicial = EMPTY_VIEW }: { inicial?: TableView }) {
  const [view, setView] = useState(inicial)
  const model = useDataTable({ rows: FILAS, columns: COLUMNAS, getRowId: r => r.id, view, onViewChange: setView })
  return (<>
    <ShortcutTiles model={model} groups={GRUPOS} />
    <TableToolbar model={model} searchPlaceholder="Buscar" preferences={{ columns: null, save: () => {}, reset: () => {} }} />
  </>)
}

describe('ShortcutTiles (C1, C3)', () => {
  it('tocar un recuadro escribe el filtro de su columna y se ve como chip', () => {
    render(<Pantalla />)
    fireEvent.click(screen.getByRole('button', { name: 'No asignados, 4' }))
    expect(screen.getByText('Estado: No asignado')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'No asignados, 4' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Todos, 5' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('un recuadro de otra columna reemplaza al anterior: son atajos, no filtros que se suman', () => {
    render(<Pantalla />)
    fireEvent.click(screen.getByRole('button', { name: 'Asignados, 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sin motivo, 1' }))
    expect(screen.queryByText('Estado: Asignado')).toBeNull()
    expect(screen.getByText('Tipo de motivo: Sin motivo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sin motivo, 1' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^Asignados/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('la cifra de cada recuadro es lo que se vería al tocarlo, con los demás filtros puestos', () => {
    render(<Pantalla inicial={{ ...EMPTY_VIEW, filters: { empresa: ['Huemul'], tipo: ['No trabajó'] } }} />)
    // Con Empresa = Huemul: tocar "No asignados" (que deja de lado el tipo) mostraría 3.
    expect(screen.getByRole('button', { name: 'No asignados, 3' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Asignados, 0' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'No trabajó, 1' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Todos, 3' })).toBeInTheDocument()
  })

  it('el filtro puesto desde el embudo marca su recuadro; quitar el chip lo desmarca', () => {
    render(<Pantalla inicial={{ ...EMPTY_VIEW, filters: { estado: ['Asignado'] } }} />)
    expect(screen.getByRole('button', { name: 'Asignados, 1' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Quitar filtro Estado' }))
    expect(screen.getByRole('button', { name: 'Todos, 5' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('"Todos" quita los filtros de las columnas de los recuadros, no los demás', () => {
    render(<Pantalla inicial={{ ...EMPTY_VIEW, filters: { empresa: ['Hasa'], tipo: ['No trabajó'] } }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Todos, 2' }))
    expect(screen.queryByText('Tipo de motivo: No trabajó')).toBeNull()
    expect(screen.getByText('Empresa: Hasa')).toBeInTheDocument()
  })

  it('con dos valores elegidos en una columna ningún recuadro de valor queda marcado', () => {
    render(<Pantalla inicial={{ ...EMPTY_VIEW, filters: { tipo: ['Sin motivo', 'No trabajó'] } }} />)
    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0)
  })

  it('cada grupo se nombra', () => {
    render(<Pantalla />)
    expect(screen.getByRole('group', { name: 'Por tipo de motivo' })).toBeInTheDocument()
  })
})

describe('ShortcutTiles, recuadro de acción', () => {
  function ConAccion({ cuenta }: { cuenta: number | undefined }) {
    const [view, setView] = useState(EMPTY_VIEW)
    const [activo, setActivo] = useState(false)
    const model = useDataTable({ rows: FILAS, columns: COLUMNAS, getRowId: r => r.id, view, onViewChange: setView })
    const grupos: ShortcutTileGroup[] = [{ tiles: [
      ...GRUPOS[0].tiles,
      { kind: 'action', label: 'Por regularizar', tone: 'urgent', count: cuenta, active: activo, onSelect: () => setActivo(true) },
    ] }]
    return (<>
      <ShortcutTiles model={model} groups={grupos} onFilterTile={() => setActivo(false)} />
      {activo ? <p>Otra lista</p> : <p>La tabla</p>}
    </>)
  }

  it('no filtra la tabla: cambia de lista, y mientras está activo los de filtro no se marcan', () => {
    render(<ConAccion cuenta={3} />)
    fireEvent.click(screen.getByRole('button', { name: 'Por regularizar, 3' }))
    expect(screen.getByText('Otra lista')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Por regularizar, 3' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Todos, 5' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('tocar uno de filtro lo apaga y vuelve a la tabla', () => {
    render(<ConAccion cuenta={3} />)
    fireEvent.click(screen.getByRole('button', { name: 'Por regularizar, 3' }))
    fireEvent.click(screen.getByRole('button', { name: 'Asignados, 1' }))
    expect(screen.getByText('La tabla')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Asignados, 1' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('sin dato todavía no afirma un cero', () => {
    render(<ConAccion cuenta={undefined} />)
    expect(screen.getByRole('button', { name: 'Por regularizar' })).toHaveTextContent('—')
  })
})

