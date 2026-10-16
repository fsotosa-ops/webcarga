'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { ListFilter } from 'lucide-react'
import { Popover } from '@/components/ui/Popover'
import { SearchInput } from '@/components/ui/SearchInput'
import { PRESENCE_LABEL } from './columnas'

/** El filtro de una columna (Cierre con un solo patrón, spec §4.1): lista de
 *  valores con su cifra facetada, buscador que filtra al tipear, selección
 *  múltiple, "Seleccionar todo" y "Limpiar". Se abre desde su embudo o, con
 *  `anchor`, desde otro botón ("+ Filtro" de la barra). */
export function ColumnFilter({ header, kind, values, selected, count, onChange, anchor, onClose }: {
  header: string
  kind: 'values' | 'presence'
  values: string[]
  selected: string[]
  count: (value: string) => number
  onChange: (values: string[]) => void
  /** Abierto desde otro botón: se ancla a él y no dibuja su embudo. */
  anchor?: RefObject<HTMLElement | null>
  onClose?: () => void
}) {
  const [abierto, setAbierto] = useState(!!anchor)
  const [q, setQ] = useState('')
  const boton = useRef<HTMLButtonElement>(null)
  const buscador = useRef<HTMLInputElement>(null)
  const lista = useRef<HTMLUListElement>(null)

  // Al abrir, el foco va al buscador (o a la primera opción en "tiene / no tiene").
  useEffect(() => {
    if (abierto) (buscador.current ?? lista.current?.querySelector<HTMLInputElement>('input'))?.focus()
  }, [abierto])

  const etiqueta = (v: string) => (kind === 'presence' ? PRESENCE_LABEL[v] ?? v : v)
  const visibles = values.filter(v => etiqueta(v).toLowerCase().includes(q.trim().toLowerCase()))

  function cerrar() {
    setAbierto(false)
    setQ('')
    onClose?.()
  }

  function alternar(v: string) {
    onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v])
  }

  /** Flechas arriba/abajo entre el buscador y las opciones. */
  function mover(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const focos = [buscador.current, ...Array.from(lista.current?.querySelectorAll<HTMLInputElement>('input[type=checkbox]') ?? [])]
      .filter((x): x is HTMLInputElement => !!x)
    const i = focos.indexOf(document.activeElement as HTMLInputElement)
    focos[e.key === 'ArrowDown' ? Math.min(i + 1, focos.length - 1) : Math.max(i - 1, 0)]?.focus()
  }

  const nombre = selected.length
    ? `Filtrar por ${header} (${selected.length} ${selected.length === 1 ? 'elegido' : 'elegidos'})`
    : `Filtrar por ${header}`

  return (
    <>
      {!anchor && (
        <button ref={boton} type="button" aria-label={nombre} aria-haspopup="dialog" aria-expanded={abierto}
          onClick={() => (abierto ? cerrar() : setAbierto(true))}
          className={`rounded p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
            selected.length ? 'text-accion' : 'text-informativo hover:text-text-primary'}`}>
          <ListFilter size={13} aria-hidden="true" />
        </button>
      )}
      <Popover anchor={anchor ?? boton} open={abierto} onClose={cerrar} label={`Filtrar por ${header}`} onKeyDown={mover}>
        {kind === 'values' && (
          <SearchInput ref={buscador} value={q} onChange={setQ} size="compact" className="mb-1.5"
            label={`Buscar en ${header}`} placeholder={`Buscar ${header.toLowerCase()}…`} />
        )}
        <ul ref={lista} className="max-h-64 overflow-y-auto">
          {visibles.map(v => {
            const n = count(v)
            return (
              <li key={v}>
                <label className="flex cursor-pointer items-center justify-between gap-2 rounded px-1.5 py-1 hover:bg-bg-main">
                  <span className="flex min-w-0 items-center gap-2">
                    <input type="checkbox" checked={selected.includes(v)} onChange={() => alternar(v)}
                      aria-label={`${etiqueta(v)}, ${n}`} className="accent-accent" />
                    <span className="truncate text-dato text-text-primary">{etiqueta(v)}</span>
                  </span>
                  <span className="text-etiqueta tabular-nums text-informativo">{n}</span>
                </label>
              </li>
            )
          })}
          {visibles.length === 0 && <li className="px-1.5 py-1 text-etiqueta text-informativo">Ningún valor coincide</li>}
        </ul>
        <div className="mt-1.5 flex justify-between border-t border-border/60 pt-1.5">
          <button type="button" onClick={() => onChange(Array.from(new Set([...selected, ...visibles])))}
            className="text-etiqueta font-medium text-accion hover:underline">Seleccionar todo</button>
          <button type="button" onClick={() => onChange([])}
            className="text-etiqueta font-medium text-accion hover:underline">Limpiar</button>
        </div>
      </Popover>
    </>
  )
}
