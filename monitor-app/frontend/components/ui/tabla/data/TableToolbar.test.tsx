import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { EMPTY_VIEW, type TableView } from '@/lib/table/viewInUrl'
import type { DataColumn } from './columns'
import { useDataTable } from './useDataTable'
import { TableToolbar } from './TableToolbar'

type Fila = { id: string; nombre: string; empresa: string; nota: string | null }
const FILAS: Fila[] = [
  { id: '1', nombre: 'Ana', empresa: 'Hasa', nota: null },
  { id: '2', nombre: 'Beto', empresa: 'Huemul', nota: 'Llamar' },
]
const COLUMNAS: DataColumn<Fila>[] = [
  { id: 'nombre', header: 'Conductor', value: r => r.nombre, hideable: false },
  { id: 'empresa', header: 'Empresa', value: r => r.empresa },
  { id: 'nota', header: 'Comentario', value: r => r.nota, filter: 'presence' },
]
const PREFS = { columns: null, save: vi.fn(), reset: vi.fn() }

function Barra({ inicial = EMPTY_VIEW }: { inicial?: TableView }) {
  const [view, setView] = useState(inicial)
  const model = useDataTable({ rows: FILAS, columns: COLUMNAS, getRowId: r => r.id, view, onViewChange: setView,
    search: (r, q) => r.nombre.toLowerCase().includes(q) })
  return (<>
    <TableToolbar model={model} searchPlaceholder="Buscar conductor…" preferences={PREFS} />
    <output data-testid="filas">{model.rows.map(r => r.nombre).join(',')}</output>
  </>)
}

describe('TableToolbar', () => {
  it('cada filtro activo es un chip con su columna y sus valores; ✕ lo quita', () => {
    render(<Barra inicial={{ ...EMPTY_VIEW, filters: { empresa: ['Hasa', 'Huemul'], nota: ['present'] } }} />)
    expect(screen.getByText('Empresa: Hasa, Huemul')).toBeInTheDocument()
    expect(screen.getByText('Comentario: Tiene')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Quitar filtro Empresa' }))
    expect(screen.queryByText('Empresa: Hasa, Huemul')).toBeNull()
  })

  it('un chip se quita con Retroceso', () => {
    render(<Barra inicial={{ ...EMPTY_VIEW, filters: { empresa: ['Hasa'] } }} />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Quitar filtro Empresa' }), { key: 'Backspace' })
    expect(screen.queryByText('Empresa: Hasa')).toBeNull()
  })

  it('"+ Filtro" elige una columna y abre su filtro', () => {
    render(<Barra />)
    fireEvent.click(screen.getByRole('button', { name: 'Agregar filtro' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Empresa' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Filtrar por Empresa' })).getByRole('checkbox', { name: 'Huemul, 1' }))
    expect(screen.getByText('Empresa: Huemul')).toBeInTheDocument()
    expect(screen.getByTestId('filas')).toHaveTextContent('Beto')
  })

  it('"Limpiar" saca filtros y búsqueda; sin nada activo no aparece', async () => {
    render(<Barra inicial={{ ...EMPTY_VIEW, filters: { empresa: ['Hasa'] }, q: 'an' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar' }))
    await waitFor(() => expect(screen.getByTestId('filas')).toHaveTextContent('Ana,Beto'))
    expect(screen.queryByRole('button', { name: 'Limpiar' })).toBeNull()
    expect(screen.getByRole('searchbox', { name: 'Buscar' })).toHaveValue('')
  })

  it('la búsqueda filtra al tipear', async () => {
    render(<Barra />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar' }), { target: { value: 'be' } })
    await waitFor(() => expect(screen.getByTestId('filas')).toHaveTextContent(/^Beto$/))
  })

  it('un filtro del servidor se dice con su etiqueta, entra por "+ Filtro", y la barra puede ir sin buscador ni Columnas', () => {
    const cliente: DataColumn<Fila> = {
      id: 'client', header: 'Cliente', value: () => null, server: true,
      options: ['s1', 's2'], count: () => 1, label: v => (v === 's1' ? 'Walmart' : 'Sodimac'),
    }
    function SoloCliente() {
      const [view, setView] = useState<TableView>({ ...EMPTY_VIEW, filters: { client: ['s1'] } })
      const model = useDataTable({ rows: [] as Fila[], columns: [cliente], getRowId: r => r.id, view, onViewChange: setView })
      return <TableToolbar model={model} />
    }
    render(<SoloCliente />)
    expect(screen.getByText('Cliente: Walmart')).toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Columnas' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Agregar filtro' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cliente' }))
    expect(screen.getByRole('checkbox', { name: 'Sodimac, 1' })).toBeInTheDocument()
  })
})
