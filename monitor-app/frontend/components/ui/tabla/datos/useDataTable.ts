'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  getCoreRowModel, getFacetedRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel,
  useReactTable, type ColumnDef, type Row,
} from '@tanstack/react-table'
import type { SortDir, TableView } from '@/lib/tabla/vistaEnUrl'
import { ABSENT, PRESENT, cellMatches, compareCells, type DataColumn } from './columnas'

/** Lo que cada persona eligió ver: columnas en orden y si están ocultas. */
export type ColumnPrefs = { id: string; hidden: boolean }[]

export type UseDataTableOptions<T> = {
  rows: T[]
  columns: DataColumn<T>[]
  getRowId: (row: T) => string
  view: TableView
  onViewChange: (view: TableView) => void
  /** La búsqueda de la barra: qué campos de la fila mira. `q` llega en minúsculas. */
  search?: (row: T, q: string) => boolean
  columnPrefs?: ColumnPrefs | null
  pageSize?: number
}

/** El motor de las tablas de datos del kit (Cierre con un solo patrón, spec §4.1):
 *  TanStack Table sin dibujo. El estado de la vista es CONTROLADO (llega y sale por
 *  `view`), así la URL es la única verdad y un recuadro, un embudo o un chip son
 *  puertas a lo mismo. La cifra de un valor es facetada: cuenta con los demás
 *  filtros y la búsqueda, no con el filtro de su propia columna. */
export function useDataTable<T>({
  rows, columns, getRowId, view, onViewChange, search, columnPrefs = null, pageSize = 50,
}: UseDataTableOptions<T>) {
  const porId = useMemo(() => new Map(columns.map(c => [c.id, c])), [columns])

  const defs = useMemo<ColumnDef<T, string | null>[]>(() => columns.map(c => ({
    id: c.id,
    accessorFn: (row: T) => c.value(row),
    filterFn: (row: Row<T>, _id: string, selected: string[]) => cellMatches(c, row.original, selected),
    sortingFn: (a: Row<T>, b: Row<T>) => compareCells(c.value(a.original), c.value(b.original), 'asc'),
    enableSorting: c.sortable !== false,
    enableHiding: c.hideable !== false,
  })), [columns])

  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize })
  // Cualquier cambio de la vista vuelve a la primera página: la página 3 de otro filtro no existe.
  const firma = JSON.stringify(view)
  useEffect(() => { setPagination(p => (p.pageIndex === 0 ? p : { ...p, pageIndex: 0 })) }, [firma])

  const visibility = useMemo(() => {
    const v: Record<string, boolean> = {}
    for (const c of columns) v[c.id] = !c.defaultHidden
    for (const p of columnPrefs ?? []) {
      const c = porId.get(p.id)
      // Una preferencia vieja de una columna que ya no existe se ignora; la fija nunca se oculta.
      if (c) v[p.id] = c.hideable === false ? true : !p.hidden
    }
    return v
  }, [columns, columnPrefs, porId])

  const order = useMemo(() => {
    const guardado = (columnPrefs ?? []).map(p => p.id).filter(id => porId.has(id))
    return [...guardado, ...columns.map(c => c.id).filter(id => !guardado.includes(id))]
  }, [columns, columnPrefs, porId])

  const table = useReactTable<T>({
    data: rows,
    columns: defs,
    getRowId,
    state: {
      columnFilters: Object.entries(view.filters).map(([id, value]) => ({ id, value })),
      globalFilter: view.q,
      sorting: view.sort ? [{ id: view.sort.column, desc: view.sort.dir === 'desc' }] : [],
      columnVisibility: visibility,
      columnOrder: order,
      pagination,
    },
    globalFilterFn: (row, _id, q: string) => !q || !search || search(row.original, q.trim().toLowerCase()),
    getColumnCanGlobalFilter: () => true,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    manualFiltering: false,
  })

  function facetRows(columnId: string): T[] {
    const col = table.getColumn(columnId)
    return col ? col.getFacetedRowModel().rows.map(r => r.original) : []
  }

  function facetCount(columnId: string, value: string): number {
    const c = porId.get(columnId)
    if (!c) return 0
    return facetRows(columnId).filter(r => cellMatches(c, r, [value])).length
  }

  function valuesOf(columnId: string): string[] {
    const c = porId.get(columnId)
    if (!c) return []
    if (c.filter === 'presence') return [PRESENT, ABSENT]
    const fijos = c.options ?? []
    const presentes = new Set<string>()
    for (const r of facetRows(columnId)) { const v = c.value(r); if (v) presentes.add(v) }
    for (const v of view.filters[columnId] ?? []) presentes.add(v)
    const resto = [...presentes].filter(v => !fijos.includes(v))
      .sort((a, b) => compareCells(a, b, 'asc'))
    return [...fijos, ...resto]
  }

  const setView = (cambios: Partial<TableView>) => onViewChange({ ...view, ...cambios })

  function setFilter(columnId: string, values: string[]) {
    const filters = { ...view.filters }
    if (values.length) filters[columnId] = values; else delete filters[columnId]
    setView({ filters })
  }

  return {
    table,
    view,
    /** Todas las filas que pasan la vista, ordenadas (sin paginar): lo que se ve y se descarga. */
    rows: table.getSortedRowModel().rows.map(r => r.original),
    pageRows: table.getRowModel().rows.map(r => r.original),
    /** Las columnas visibles, en el orden de la persona. */
    visibleColumns: table.getVisibleLeafColumns().map(c => porId.get(c.id)!),
    /** Todas las columnas en el orden de la persona, con si se ven (para "Columnas"). */
    orderedColumns: order.map(id => ({ column: porId.get(id)!, visible: visibility[id] !== false })),
    facetCount,
    /** Cuántas filas pasan todos los filtros menos el de esta columna (el "Todos" de un recuadro). */
    facetTotal: (columnId: string) => facetRows(columnId).length,
    valuesOf,
    setFilter,
    setQ: (q: string) => setView({ q }),
    setSort: (column: string, dir: SortDir | null) => setView({ sort: dir ? { column, dir } : null }),
    clearAll: () => setView({ filters: {}, q: '' }),
    columnById: (id: string) => porId.get(id),
  }
}

export type DataTableModel<T> = ReturnType<typeof useDataTable<T>>
