import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { EMPTY_VIEW, type TableView } from '@/lib/tabla/vistaEnUrl'
import type { DataColumn } from './columnas'
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

function Tabla({ inicial = EMPTY_VIEW, filas = FILAS }: { inicial?: TableView; filas?: Fila[] }) {
  const [view, setView] = useState(inicial)
  const model = useDataTable({ rows: filas, columns: COLUMNAS, getRowId: r => r.id, view, onViewChange: setView, pageSize: 20 })
  return <DataTable model={model} label="Conductores" empty="Nadie coincide" />
}

describe('DataTable', () => {
  it('encabezados del kit, embudo solo donde se filtra y celdas propias', () => {
    render(<Tabla />)
    const tabla = screen.getByRole('table', { name: 'Conductores' })
    expect(within(tabla).getAllByRole('columnheader').map(h => h.textContent?.trim())).toEqual(['Conductor', 'Empresa', 'Acción'])
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
})
