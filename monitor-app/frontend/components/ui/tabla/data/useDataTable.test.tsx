import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { EMPTY_VIEW, type TableView } from '@/lib/table/viewInUrl'
import { compareCells, type DataColumn } from './columns'
import { useDataTable } from './useDataTable'

type Fila = { id: string; conductor: string; empresa: string | null; estado: string; viaje: string | null; nota: string | null }

const FILAS: Fila[] = [
  { id: '1', conductor: 'Ana', empresa: 'Hasa Spa', estado: 'Asignado', viaje: '30', nota: null },
  { id: '2', conductor: 'Beto', empresa: 'Hasa Spa', estado: 'Sin motivo', viaje: null, nota: 'Llamar' },
  { id: '3', conductor: 'Carla', empresa: 'Huemul', estado: 'No trabajando', viaje: null, nota: null },
  { id: '4', conductor: 'Dino', empresa: null, estado: 'No trabajando', viaje: '9', nota: null },
]
const COLUMNAS: DataColumn<Fila>[] = [
  { id: 'conductor', header: 'Conductor', value: r => r.conductor, hideable: false },
  { id: 'empresa', header: 'Empresa', value: r => r.empresa },
  { id: 'estado', header: 'Estado', value: r => r.estado, options: ['Asignado', 'Sin motivo', 'No trabajando', 'Por regularizar'] },
  { id: 'viaje', header: 'Nº viaje', value: r => r.viaje },
  { id: 'nota', header: 'Comentario', value: r => r.nota, filter: 'presence' },
]

function usar(inicial: TableView = EMPTY_VIEW) {
  return renderHook(() => {
    const [view, setView] = useState<TableView>(inicial)
    return useDataTable({
      rows: FILAS, columns: COLUMNAS, getRowId: r => r.id, view, onViewChange: setView,
      search: (r, q) => r.conductor.toLowerCase().includes(q),
    })
  })
}

const ids = (t: ReturnType<typeof usar>['result']['current']) => t.rows.map(r => r.id)

describe('useDataTable', () => {
  it('filtra por varias columnas a la vez', () => {
    const { result } = usar({ ...EMPTY_VIEW, filters: { empresa: ['Hasa Spa'], estado: ['Sin motivo'] } })
    expect(ids(result.current)).toEqual(['2'])
  })

  it('la cifra de un valor cuenta con los demás filtros, no con el suyo', () => {
    const { result } = usar({ ...EMPTY_VIEW, filters: { empresa: ['Hasa Spa'], estado: ['Asignado'] } })
    // Con Empresa = Hasa: 1 Asignado y 1 Sin motivo, aunque Estado tenga elegido Asignado.
    expect(result.current.facetCount('estado', 'Sin motivo')).toBe(1)
    expect(result.current.facetCount('estado', 'Asignado')).toBe(1)
    expect(result.current.facetCount('estado', 'No trabajando')).toBe(0)
  })

  it('los valores de un filtro incluyen sus opciones fijas y lo elegido aunque no haya filas', () => {
    const { result } = usar({ ...EMPTY_VIEW, filters: { empresa: ['Dada de baja'] } })
    expect(result.current.rows).toEqual([])
    expect(result.current.valuesOf('empresa')).toContain('Dada de baja')
    expect(result.current.valuesOf('estado')).toEqual(['Asignado', 'Sin motivo', 'No trabajando', 'Por regularizar'])
  })

  it('"tiene / no tiene" filtra por presencia', () => {
    const { result } = usar({ ...EMPTY_VIEW, filters: { nota: ['present'] } })
    expect(ids(result.current)).toEqual(['2'])
    expect(result.current.facetCount('nota', 'absent')).toBe(3)
  })

  it('la búsqueda usa la función de la tabla y también recorta las cifras', () => {
    const { result } = usar({ ...EMPTY_VIEW, q: 'ar' })
    expect(ids(result.current)).toEqual(['3'])
    expect(result.current.facetCount('estado', 'No trabajando')).toBe(1)
  })

  it('ordena como una planilla: números como números, vacíos al final', () => {
    const { result } = usar({ ...EMPTY_VIEW, sort: { column: 'viaje', dir: 'asc' } })
    expect(ids(result.current)).toEqual(['4', '1', '2', '3'])
    expect(compareCells('9', '30', 'asc')).toBeLessThan(0)
    expect(compareCells(null, 'a', 'desc')).toBeGreaterThan(0)
  })

  it('setFilter escribe la vista; un filtro vacío se quita', () => {
    const { result } = usar()
    act(() => result.current.setFilter('estado', ['No trabajando']))
    expect(ids(result.current)).toEqual(['3', '4'])
    act(() => result.current.setFilter('estado', []))
    expect(result.current.view.filters).toEqual({})
  })

  it('aplica la preferencia guardada; ignora columnas que ya no existen y no oculta la fija', () => {
    const { result } = renderHook(() => useDataTable({
      rows: FILAS, columns: COLUMNAS, getRowId: r => r.id, view: EMPTY_VIEW, onViewChange: () => {},
      columnPrefs: [
        { id: 'fantasma', hidden: false }, { id: 'estado', hidden: false },
        { id: 'conductor', hidden: true }, { id: 'empresa', hidden: true },
      ],
    }))
    expect(result.current.visibleColumns.map(c => c.id)).toEqual(['estado', 'conductor', 'viaje', 'nota'])
  })

  it('una columna de varios valores (una fila con dos viajes) filtra y cuenta cada valor por separado', () => {
    type ConViajes = { id: string; viajes: string[] }
    const filas: ConViajes[] = [{ id: 'a', viajes: ['30', '31'] }, { id: 'b', viajes: ['31'] }, { id: 'c', viajes: [] }]
    const columnas: DataColumn<ConViajes>[] = [
      { id: 'viajes', header: 'Nº viaje', value: r => r.viajes.join(', ') || null, values: r => r.viajes },
    ]
    const { result } = renderHook(() => {
      const [view, setView] = useState<TableView>({ ...EMPTY_VIEW, filters: { viajes: ['30'] } })
      return useDataTable({ rows: filas, columns: columnas, getRowId: r => r.id, view, onViewChange: setView })
    })
    expect(result.current.rows.map(r => r.id)).toEqual(['a'])
    expect(result.current.valuesOf('viajes')).toEqual(['30', '31'])
    expect(result.current.facetCount('viajes', '31')).toBe(2)
  })
})
