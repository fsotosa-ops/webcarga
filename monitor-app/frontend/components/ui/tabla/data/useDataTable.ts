'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  getCoreRowModel, getFacetedRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel,
  useReactTable, type ColumnDef, type Row,
} from '@tanstack/react-table'
import type { SortDir, TableView } from '@/lib/table/viewInUrl'
import { ABSENT, PRESENT, cellMatches, cellValues, compareCells, type DataColumn } from './columns'

/** Lo que cada persona eligió ver: columnas en orden y si están ocultas. */
export type ColumnPrefs = { id: string; hidden: boolean }[]

/** Modo servidor (Analítica, 22/10): filtrar, ordenar y paginar los hace la API. Las filas que llegan son la
 *  página, tal cual; las cifras de cada filtro llegan en `counts`. `total` null = todavía no se sabe: no se muestra
 *  ninguna cifra (una cifra derivada no se muestra hasta tener el dato). */
export type ServerMode = {
  total: number | null
  counts: Record<string, Record<string, number>> | null
  page: number
  pageSize: number
  onPage: (page: number, pageSize: number) => void
}

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
  server?: ServerMode
}

/** El motor de las tablas de datos del kit (Cierre con un solo patrón, spec §4.1):
 *  TanStack Table sin dibujo. El estado de la vista es CONTROLADO (llega y sale por
 *  `view`), así la URL es la única verdad y un recuadro, un embudo o un chip son
 *  puertas a lo mismo. La cifra de un valor es facetada: cuenta con los demás
 *  filtros y la búsqueda, no con el filtro de su propia columna. */
export function useDataTable<T>({
  rows, columns, getRowId, view, onViewChange, search, columnPrefs = null, pageSize = 50, server,
}: UseDataTableOptions<T>) {
  const porId = useMemo(() => new Map(columns.map(c => [c.id, c])), [columns])
  // Las columnas de la tabla; un filtro del servidor no es columna (ver `DataColumn.server`).
  const enTabla = useMemo(() => columns.filter(c => !c.server), [columns])

  const defs = useMemo<ColumnDef<T, string | null>[]>(() => enTabla.map(c => ({
    id: c.id,
    accessorFn: (row: T) => c.value(row),
    filterFn: (row: Row<T>, _id: string, selected: string[]) => cellMatches(c, row.original, selected),
    sortingFn: (a: Row<T>, b: Row<T>) => compareCells(c.value(a.original), c.value(b.original), 'asc'),
    enableSorting: c.sortable !== false,
    enableHiding: c.hideable !== false,
  })), [enTabla])

  const [paginaLocal, setPaginaLocal] = useState({ pageIndex: 0, pageSize })
  // En modo servidor la página la gobierna quien consulta: el kit solo avisa los cambios.
  const pagination = server ? { pageIndex: server.page, pageSize: server.pageSize } : paginaLocal
  const setPagination = (next: typeof paginaLocal | ((p: typeof paginaLocal) => typeof paginaLocal)) => {
    const valor = typeof next === 'function' ? next(pagination) : next
    if (server) server.onPage(valor.pageIndex, valor.pageSize); else setPaginaLocal(valor)
  }
  // Cualquier cambio de la vista vuelve a la primera página: la página 3 de otro filtro no existe.
  const firma = JSON.stringify(view)
  const primeraVez = useRef(true)
  useEffect(() => {
    if (primeraVez.current) { primeraVez.current = false; return }
    if (server) { if (server.page !== 0) server.onPage(0, server.pageSize); return }
    setPaginaLocal(p => (p.pageIndex === 0 ? p : { ...p, pageIndex: 0 }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firma])

  const visibility = useMemo(() => {
    const v: Record<string, boolean> = {}
    for (const c of enTabla) v[c.id] = !c.defaultHidden
    for (const p of columnPrefs ?? []) {
      const c = enTabla.find(x => x.id === p.id)
      // Una preferencia vieja de una columna que ya no existe se ignora; la fija nunca se oculta.
      if (c) v[p.id] = c.hideable === false ? true : !p.hidden
    }
    return v
  }, [enTabla, columnPrefs])

  const order = useMemo(() => {
    const ids = enTabla.map(c => c.id)
    const guardado = (columnPrefs ?? []).map(p => p.id).filter(id => ids.includes(id))
    return [...guardado, ...ids.filter(id => !guardado.includes(id))]
  }, [enTabla, columnPrefs])

  // El estado que se le pasa a TanStack, estable mientras la vista no cambie: un
  // arreglo nuevo en cada dibujo le hacía recalcular el filtrado y las facetas de
  // todas las columnas en cada render (segundos con 50 filas, revisión final 16/10).
  // Solo los filtros de columnas de esta tabla: el del servidor ya llegó aplicado, y
  // uno de otra tabla (un enlace viejo, otra sección) no tiene con qué filtrar.
  const columnFilters = useMemo(() => Object.entries(view.filters)
    .filter(([id]) => porId.has(id) && !porId.get(id)!.server)
    .map(([id, value]) => ({ id, value })), [view.filters, porId])
  const sorting = useMemo(
    () => (view.sort ? [{ id: view.sort.column, desc: view.sort.dir === 'desc' }] : []), [view.sort])

  const table = useReactTable<T>({
    data: rows,
    columns: defs,
    getRowId,
    state: {
      columnFilters,
      globalFilter: view.q,
      sorting,
      columnVisibility: visibility,
      columnOrder: order,
      pagination,
    },
    globalFilterFn: (row, _id, q: string) => !q || !search || search(row.original, q.trim().toLowerCase()),
    getColumnCanGlobalFilter: () => true,
    onPaginationChange: setPagination,
    // La página la gobierna el kit (vuelve a la primera con un cambio de vista y se ajusta si
    // deja de existir). La de TanStack vuelve a la primera cada vez que se rearman filas o
    // columnas, y un guardado o un catálogo que llega te sacaba de la página 2.
    autoResetPageIndex: false,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    manualFiltering: !!server,
    manualSorting: !!server,
    manualPagination: !!server,
    rowCount: server ? (server.total ?? 0) : undefined,
  })
  // Si las filas se achican (un guardado que refresca, otro filtro) y la página elegida ya no
  // existe, se muestra la última que queda en vez de una página vacía. Ajuste en el render, no
  // en un efecto, para que no se pinte nunca la página vacía.
  const ultima = Math.max(0, table.getPageCount() - 1)
  if (!server && pagination.pageIndex > ultima) setPaginaLocal(p => ({ ...p, pageIndex: ultima }))

  function facetRows(columnId: string): T[] {
    const col = table.getColumn(columnId)
    return col ? col.getFacetedRowModel().rows.map(r => r.original) : []
  }

  function facetCount(columnId: string, value: string): number {
    const c = porId.get(columnId)
    if (!c) return 0
    if (c.count) return c.count(value)
    if (server) return server.counts?.[columnId]?.[value] ?? 0
    return facetRows(columnId).filter(r => cellMatches(c, r, [value])).length
  }

  function valuesOf(columnId: string): string[] {
    const c = porId.get(columnId)
    if (!c) return []
    if (c.filter === 'presence') return [PRESENT, ABSENT]
    const fijos = c.options ?? []
    if (c.server) return [...fijos, ...(view.filters[columnId] ?? []).filter(v => !fijos.includes(v))]
    if (server) {
      const delServidor = Object.keys(server.counts?.[columnId] ?? {})
      const elegidos = (view.filters[columnId] ?? []).filter(v => !delServidor.includes(v))
      return [...fijos, ...delServidor.filter(v => !fijos.includes(v)), ...elegidos]
    }
    const presentes = new Set<string>()
    for (const r of facetRows(columnId)) for (const v of cellValues(c, r)) if (v) presentes.add(v)
    for (const v of view.filters[columnId] ?? []) presentes.add(v)
    const resto = [...presentes].filter(v => !fijos.includes(v))
      .sort((a, b) => compareCells(a, b, 'asc'))
    return [...fijos, ...resto]
  }

  const setView = (cambios: Partial<TableView>) => onViewChange({ ...view, ...cambios })

  /** Cuántas filas pasan la búsqueda y `filters` (en vez de los de la vista): la cifra
   *  de un atajo es lo que se vería al tocarlo. Los filtros del servidor ya llegaron
   *  aplicados. */
  function countWith(filters: Record<string, string[]>): number {
    const q = view.q.trim().toLowerCase()
    return table.getCoreRowModel().rows.filter(r =>
      (!q || !search || search(r.original, q))
      && Object.entries(filters).every(([id, elegidos]) => {
        const c = porId.get(id)
        return !c || c.server || cellMatches(c, r.original, elegidos)
      })).length
  }

  function setFilter(columnId: string, values: string[]) {
    const filters = { ...view.filters }
    if (values.length) filters[columnId] = values; else delete filters[columnId]
    setView({ filters })
  }

  return {
    table,
    view,
    /** Todas las filas que pasan la vista, ordenadas (sin paginar): lo que se ve y se descarga. En modo
     *  servidor, la página que llegó (la descarga la arma la API). */
    rows: server ? rows : table.getSortedRowModel().rows.map(r => r.original),
    pageRows: server ? rows : table.getRowModel().rows.map(r => r.original),
    /** Cuántas filas pasan la vista; null mientras el servidor no lo dice. */
    total: server ? server.total : table.getSortedRowModel().rows.length,
    /** Las columnas visibles, en el orden de la persona. */
    visibleColumns: table.getVisibleLeafColumns().map(c => porId.get(c.id)!),
    /** Todas las columnas en el orden de la persona, con si se ven (para "Columnas"). */
    orderedColumns: order.map(id => ({ column: porId.get(id)!, visible: visibility[id] !== false })),
    /** Los filtros que aplica el servidor: van por "+ Filtro" y como chip, no como columna. */
    serverFilters: columns.filter(c => c.server),
    facetCount,
    valuesOf,
    setFilter,
    /** Reemplaza todos los filtros de una vez (un atajo pone uno y quita otros). */
    setFilters: (filters: Record<string, string[]>) =>
      setView({ filters: Object.fromEntries(Object.entries(filters).filter(([, v]) => v.length)) }),
    countWith,
    setQ: (q: string) => setView({ q }),
    setSort: (column: string, dir: SortDir | null) => setView({ sort: dir ? { column, dir } : null }),
    clearAll: () => setView({ filters: {}, q: '' }),
    columnById: (id: string) => porId.get(id),
  }
}

export type DataTableModel<T> = ReturnType<typeof useDataTable<T>>
