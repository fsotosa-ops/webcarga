'use client'

import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { CABECERA } from '../EncabezadoOrdenable'
import { OrdenIcono } from '../OrdenIcono'
import { ColumnFilter } from './ColumnFilter'
import type { DataTableModel } from './useDataTable'

/** El dibujo de una tabla de datos del kit (Cierre con un solo patrón, spec §4.1):
 *  encabezado con `CABECERA`, orden de tres estados con `aria-sort`, embudo en cada
 *  columna filtrable y paginación. Todo lo que hace sale del modelo (`useDataTable`);
 *  aquí no se decide nada de datos. */
/** Elegir filas para una acción en lote: la casilla solo aparece en las que se pueden elegir. */
export type RowSelection<T> = {
  isSelectable: (row: T) => boolean
  isSelected: (row: T) => boolean
  onToggle: (row: T) => void
  /** El nombre accesible de la casilla ("Seleccionar Ana Soto"). */
  label: (row: T) => string
}

export function DataTable<T>({ model, label, empty, selection, pageSizes, isRowActive }: {
  model: DataTableModel<T>
  label: string
  /** Qué decir cuando ninguna fila pasa la vista. */
  empty: ReactNode
  selection?: RowSelection<T>
  /** Ofrecer "Ver N" filas por página. */
  pageSizes?: number[]
  /** La fila desde la que se abrió algo (la vista rápida): queda marcada. */
  isRowActive?: (row: T) => boolean
}) {
  const { table, view, visibleColumns, pageRows, rows } = model
  const pageCount = table.getPageCount()
  const { pageIndex } = table.getState().pagination

  function ordenar(columnId: string) {
    const actual = view.sort?.column === columnId ? view.sort.dir : null
    model.setSort(columnId, actual === null ? 'asc' : actual === 'asc' ? 'desc' : null)
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-2xl border border-border bg-white">
        <table aria-label={label} className="w-full text-dato">
          <thead>
            <tr className="border-b border-border bg-bg-main">
              {selection && <th scope="col" className="w-8 px-3"><span className="sr-only">Selección</span></th>}
              {visibleColumns.map(c => {
                const activo = view.sort?.column === c.id
                const ariaSort = activo ? (view.sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                return (
                  <th key={c.id} scope="col" aria-sort={c.sortable === false ? undefined : ariaSort}
                    className={`${CABECERA} whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''}`}>
                    <span className="inline-flex items-center gap-1">
                      {c.sortable === false ? c.header : (
                        <button type="button" onClick={() => ordenar(c.id)}
                          className="inline-flex items-center rounded hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                          {c.header}
                          <OrdenIcono activo={activo} direccion={view.sort?.dir ?? 'asc'} />
                        </button>
                      )}
                      {c.filter !== false && (
                        <ColumnFilter
                          header={c.header} kind={c.filter === 'presence' ? 'presence' : 'values'}
                          values={model.valuesOf(c.id)} selected={view.filters[c.id] ?? []}
                          count={v => model.facetCount(c.id, v)} onChange={v => model.setFilter(c.id, v)}
                        />
                      )}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r, i) => {
              const activa = isRowActive?.(r) ?? false
              return (
              <tr key={table.getRowModel().rows[i]?.id ?? i} aria-current={activa ? 'true' : undefined}
                className={`border-b border-border/60 last:border-0 ${activa ? 'bg-accent/5 shadow-[inset_3px_0_0_var(--accent)]' : ''}`}>
                {selection && (
                  <td className="px-3 py-2.5 align-top">
                    {selection.isSelectable(r) && (
                      <input type="checkbox" aria-label={selection.label(r)} checked={selection.isSelected(r)}
                        onChange={() => selection.onToggle(r)} className="accent-accent" />
                    )}
                  </td>
                )}
                {visibleColumns.map(c => (
                  <td key={c.id} className={`px-3 py-2.5 align-top ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>
                    {c.render ? c.render(r) : (c.value(r) ?? <span className="text-informativo">—</span>)}
                  </td>
                ))}
              </tr>
              )
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="px-4 py-8 text-center text-dato text-informativo">{empty}</p>}
      </div>
      {rows.length > 0 && (
        <div className="flex items-center justify-between gap-3 text-etiqueta text-informativo">
          <span className="inline-flex items-center gap-2.5">
            {rows.length === 1 ? '1 resultado' : `${rows.length} resultados`}
            {pageSizes && (
              <label className="inline-flex items-center gap-1.5">
                Ver
                <select aria-label="Filas por página" value={table.getState().pagination.pageSize}
                  onChange={e => table.setPageSize(Number(e.target.value))}
                  className="rounded-lg border border-border bg-white px-1.5 py-1 text-etiqueta">
                  {pageSizes.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            )}
          </span>
          {pageCount > 1 && (
            <span className="inline-flex items-center gap-2">
              <button type="button" aria-label="Página anterior" disabled={!table.getCanPreviousPage()}
                onClick={() => table.previousPage()} className="rounded p-1 hover:bg-bg-main disabled:opacity-40">
                <ChevronLeft size={14} aria-hidden="true" />
              </button>
              <span className="tabular-nums">{pageIndex + 1} de {pageCount}</span>
              <button type="button" aria-label="Página siguiente" disabled={!table.getCanNextPage()}
                onClick={() => table.nextPage()} className="rounded p-1 hover:bg-bg-main disabled:opacity-40">
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  )
}
