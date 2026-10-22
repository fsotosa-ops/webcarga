import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { EMPTY_VIEW, type TableView } from '@/lib/table/viewInUrl'
import type { DataColumn } from './columns'
import { useDataTable } from './useDataTable'
import { activeFilterTexts, visibleTable, viewForPasting } from './viewExport'

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

  it('para pegar: encabezado con el recorte, una línea por fila en texto y una tabla en html', () => {
    const m = modelo({ ...EMPTY_VIEW, filters: { empresa: ['Huemul'] } },
      [{ id: 'patente', hidden: false }, { id: 'empresa', hidden: false }, { id: 'vueltas', hidden: false }, { id: 'nota', hidden: false }])
    const p = viewForPasting(m, 'Flota del día 04/08 · Tractoreo')

    expect(p.heading).toBe('Flota del día 04/08 · Tractoreo · Empresa: Huemul · 1 fila')
    expect(p.text).toBe('Flota del día 04/08 · Tractoreo · Empresa: Huemul · 1 fila\n\nEFGH34 · Huemul · 3 · ojo')
    expect(p.html).toContain('<th>Patente</th><th>Empresa</th><th>Vueltas</th><th>Comentario</th>')
    expect(p.html).toContain('<td>EFGH34</td><td>Huemul</td><td>3</td><td>ojo</td>')
  })

  it('en el texto se omiten las celdas vacías; en el html se escapan los caracteres', () => {
    const filas = [{ id: '1', patente: 'AB<CD', empresa: 'Hasa & Cía', vueltas: 2, nota: null }]
    const m = renderHook(() => useDataTable({ rows: filas, columns: COLUMNAS.slice(0, 4), getRowId: r => r.id,
      view: EMPTY_VIEW, onViewChange: () => {} })).result.current
    const p = viewForPasting(m, 'Flota')

    expect(p.text.split('\n').at(-1)).toBe('AB<CD · Hasa & Cía · 2')
    expect(p.html).toContain('<td>AB&lt;CD</td><td>Hasa &amp; Cía</td><td>2</td><td></td>')
    expect(p.heading).toBe('Flota · 1 fila')
  })
})
