import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { EMPTY_VIEW, type TableView } from '@/lib/table/viewInUrl'
import type { DataColumn } from './columns'
import { useDataTable } from './useDataTable'
import { activeFilterTexts, visibleTable } from './viewExport'

type Fila = { id: string; patente: string; empresa: string; vueltas: number; nota: string | null }
const FILAS: Fila[] = [
  { id: '1', patente: 'ABCD12', empresa: 'Hasa', vueltas: 2, nota: null },
  { id: '2', patente: 'EFGH34', empresa: 'Huemul', vueltas: 3, nota: 'ojo' },
]
const COLUMNAS: DataColumn<Fila>[] = [
  { id: 'patente', header: 'Patente', value: r => r.patente, hideable: false },
  { id: 'empresa', header: 'Empresa', value: r => r.empresa },
  { id: 'vueltas', header: 'Vueltas', value: r => String(r.vueltas), align: 'right' },
  { id: 'nota', header: 'Comentario', value: r => r.nota, filter: 'presence' },
  { id: 'client', header: 'Cliente', value: () => null, server: true, label: () => 'Walmart' },
]

const modelo = (view: TableView, prefs = null as { id: string; hidden: boolean }[] | null) => renderHook(() =>
  useDataTable({ rows: FILAS, columns: COLUMNAS, getRowId: r => r.id, view, onViewChange: () => {}, columnPrefs: prefs })).result.current

describe('viewExport', () => {
  it('los filtros activos se dicen con las palabras de sus chips', () => {
    const m = modelo({ ...EMPTY_VIEW, filters: { client: ['s1'], nota: ['present'] }, q: 'ab' })
    expect(activeFilterTexts(m)).toEqual(['Cliente: Walmart', 'Comentario: Tiene', 'Búsqueda: "ab"'])
  })

  it('lo que se ve: columnas visibles en el orden de la persona y las filas que pasan la vista', () => {
    const m = modelo({ ...EMPTY_VIEW, filters: { empresa: ['Huemul'] } },
      [{ id: 'vueltas', hidden: false }, { id: 'patente', hidden: false }, { id: 'empresa', hidden: true }])
    expect(visibleTable(m)).toEqual({
      columns: [{ header: 'Vueltas', numeric: true }, { header: 'Patente', numeric: false }, { header: 'Comentario', numeric: false }],
      rows: [['3', 'EFGH34', 'ojo']],
    })
  })
})
