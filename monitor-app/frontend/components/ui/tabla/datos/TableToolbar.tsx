'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Plus, Search, X } from 'lucide-react'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { ABSENT, PRESENT } from './columnas'
import { ColumnFilter } from './ColumnFilter'
import { ColumnsMenu } from './ColumnsMenu'
import type { DataTableModel } from './useDataTable'
import type { TablePreferences } from './useTablePreferences'

const PRESENCIA: Record<string, string> = { [PRESENT]: 'Tiene', [ABSENT]: 'No tiene' }

/** La barra de una tabla de datos del kit (spec §4.1): buscador, un chip por
 *  filtro activo (venga del recuadro, del embudo o de aquí), "+ Filtro",
 *  "Limpiar", "Columnas" y las acciones propias de la pantalla al final. */
export function TableToolbar<T>({ model, searchPlaceholder, preferences, actions }: {
  model: DataTableModel<T>
  searchPlaceholder: string
  preferences: TablePreferences
  actions?: ReactNode
}) {
  const { view } = model
  const [q, setQ] = useState(view.q)
  const buscado = useDebouncedValue(q, 250)
  // La URL manda: si la vista cambia desde afuera ("Limpiar", "Volver"), el campo la sigue.
  useEffect(() => { setQ(view.q) }, [view.q])
  useEffect(() => { if (buscado !== view.q) model.setQ(buscado) }, [buscado]) // eslint-disable-line react-hooks/exhaustive-deps

  const [menu, setMenu] = useState(false)
  const [eligiendo, setEligiendo] = useState<string | null>(null)
  const agregar = useRef<HTMLButtonElement>(null)

  const filtrables = model.orderedColumns.map(e => e.column).filter(c => c.filter !== false)
  const activos = Object.entries(view.filters).filter(([, v]) => v.length)
  const hayAlgo = activos.length > 0 || view.q !== ''
  const columna = eligiendo ? model.columnById(eligiendo) : undefined

  const texto = (columnId: string, valores: string[]) => {
    const c = model.columnById(columnId)
    const nombres = c?.filter === 'presence' ? valores.map(v => PRESENCIA[v] ?? v) : valores
    return `${c?.header ?? columnId}: ${nombres.join(', ')}`
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-white px-3 py-2">
      <div className="relative shrink-0">
        <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-informativo" aria-hidden="true" />
        <input type="search" role="searchbox" aria-label="Buscar" value={q} onChange={e => setQ(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-64 max-w-full rounded-lg border border-border bg-white py-1.5 pl-8 pr-3 text-dato placeholder:text-informativo focus:outline-none focus:ring-2 focus:ring-accent/20" />
      </div>

      {activos.map(([columnId, valores]) => {
        const c = model.columnById(columnId)
        const quitar = () => model.setFilter(columnId, [])
        return (
          <span key={columnId} className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-main py-0.5 pl-2.5 pr-1 text-dato text-text-primary">
            {texto(columnId, valores)}
            <button type="button" aria-label={`Quitar filtro ${c?.header ?? columnId}`} onClick={quitar}
              onKeyDown={e => { if (e.key === 'Backspace' || e.key === 'Delete') quitar() }}
              className="rounded-full p-0.5 text-informativo hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        )
      })}

      <span className="relative">
        <button ref={agregar} type="button" aria-label="Agregar filtro" aria-haspopup="menu" aria-expanded={menu}
          onClick={() => setMenu(m => !m)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-0.5 text-dato text-accion hover:bg-bg-main">
          <Plus size={12} aria-hidden="true" /> Filtro
        </button>
        {menu && (
          <ul role="menu" aria-label="Filtrar por" className="absolute left-0 top-full z-40 mt-1 w-48 rounded-xl border border-border bg-white p-1 shadow-lg">
            {filtrables.map(c => (
              <li key={c.id} role="none">
                <button role="menuitem" type="button" onClick={() => { setMenu(false); setEligiendo(c.id) }}
                  className="w-full rounded px-2 py-1 text-left text-dato text-text-primary hover:bg-bg-main">
                  {c.header}
                </button>
              </li>
            ))}
          </ul>
        )}
        {columna && (
          <ColumnFilter anchor={agregar} onClose={() => setEligiendo(null)}
            header={columna.header} kind={columna.filter === 'presence' ? 'presence' : 'values'}
            values={model.valuesOf(columna.id)} selected={view.filters[columna.id] ?? []}
            count={v => model.facetCount(columna.id, v)} onChange={v => model.setFilter(columna.id, v)} />
        )}
      </span>

      {hayAlgo && (
        <button type="button" onClick={() => { setQ(''); model.clearAll() }}
          className="text-dato font-medium text-accion hover:underline">
          Limpiar
        </button>
      )}

      <span className="ml-auto flex items-center gap-2">
        {actions}
        <ColumnsMenu columns={model.orderedColumns} onChange={preferences.save} onReset={preferences.reset} />
      </span>
    </div>
  )
}
