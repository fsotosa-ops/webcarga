import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { EMPTY_VIEW, type TableView } from '@/lib/table/viewInUrl'
import type { DataColumn } from './columns'
import { useDataTable } from './useDataTable'
import { DataTable } from './DataTable'

type Fila = { id: string; nombre: string; empresa: string; accion: string | null }
const FILAS: Fila[] = Array.from({ length: 25 }, (_, i) => ({
  id: String(i), nombre: `Conductor ${String(i).padStart(2, '0')}`, empresa: i % 2 ? 'Hasa' : 'Huemul', accion: null,
}))
const COLUMNAS: DataColumn<Fila>[] = [
  { id: 'nombre', header: 'Conductor', value: r => r.nombre, hideable: false },
  { id: 'empresa', header: 'Empresa', value: r => r.empresa },
  { id: 'accion', header: 'Acción', value: r => r.accion, filter: false, sortable: false, render: () => <button>Ver</button> },
]

function Tabla({ inicial = EMPTY_VIEW, filas = FILAS, activa }: { inicial?: TableView; filas?: Fila[]; activa?: string }) {
  const [view, setView] = useState(inicial)
  const [elegidas, setElegidas] = useState<Set<string>>(new Set())
  const model = useDataTable({ rows: filas, columns: COLUMNAS, getRowId: r => r.id, view, onViewChange: setView, pageSize: 20 })
  return (<>
    <DataTable model={model} label="Conductores" empty="Nadie coincide" pageSizes={[20, 50, 100]}
      isRowActive={r => r.id === activa}
      selection={{
        isSelectable: r => r.empresa === 'Hasa', isSelected: r => elegidas.has(r.id), label: r => `Seleccionar ${r.nombre}`,
        onToggle: r => setElegidas(s => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n }),
      }} />
    <output data-testid="elegidas">{[...elegidas].join(',')}</output>
  </>)
}

describe('DataTable', () => {
  it('encabezados del kit, embudo solo donde se filtra y celdas propias', () => {
    render(<Tabla />)
    const tabla = screen.getByRole('table', { name: 'Conductores' })
    expect(within(tabla).getAllByRole('columnheader').map(h => h.textContent?.trim())).toEqual(['Selección', 'Conductor', 'Empresa', 'Acción'])
    expect(within(tabla).getByRole('button', { name: 'Filtrar por Empresa' })).toBeInTheDocument()
    expect(within(tabla).queryByRole('button', { name: 'Filtrar por Acción' })).toBeNull()
    expect(within(tabla).getAllByRole('button', { name: 'Ver' })).toHaveLength(20)
  })

  it('el título ordena y lo declara: ascendente, descendente, sin orden', () => {
    render(<Tabla />)
    const titulo = () => screen.getByRole('columnheader', { name: /Conductor/ })
    fireEvent.click(within(titulo()).getByRole('button', { name: 'Conductor' }))
    expect(titulo()).toHaveAttribute('aria-sort', 'ascending')
    fireEvent.click(within(titulo()).getByRole('button', { name: 'Conductor' }))
    expect(titulo()).toHaveAttribute('aria-sort', 'descending')
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Conductor 24')
    fireEvent.click(within(titulo()).getByRole('button', { name: 'Conductor' }))
    expect(titulo()).toHaveAttribute('aria-sort', 'none')
  })

  it('pagina y dice cuántos hay', () => {
    render(<Tabla />)
    expect(screen.getByText('25 resultados')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Página siguiente' }))
    expect(screen.getAllByRole('row')).toHaveLength(1 + 5)
  })

  it('sin filas que pasen la vista, lo dice en vez de una tabla vacía', () => {
    render(<Tabla inicial={{ ...EMPTY_VIEW, filters: { empresa: ['Otra'] } }} />)
    expect(screen.getByText('Nadie coincide')).toBeInTheDocument()
    expect(screen.queryByRole('row', { name: /Conductor 0/ })).toBeNull()
  })

  it('la selección: casilla solo en las filas que se pueden elegir, con su nombre', () => {
    render(<Tabla />)
    expect(screen.queryByRole('checkbox', { name: 'Seleccionar Conductor 00' })).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Conductor 01' }))
    expect(screen.getByTestId('elegidas')).toHaveTextContent('1')
  })

  it('"Ver" cambia cuántas filas por página', () => {
    render(<Tabla />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Filas por página' }), { target: { value: '50' } })
    expect(screen.getAllByRole('row')).toHaveLength(1 + 25)
  })

  it('la fila activa (vista rápida abierta desde ella) queda marcada', () => {
    render(<Tabla activa="3" />)
    expect(screen.getByRole('row', { current: true })).toHaveTextContent('Conductor 03')
  })
})
