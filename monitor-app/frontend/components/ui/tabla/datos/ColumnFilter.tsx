'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ListFilter, Search } from 'lucide-react'
import { useLayer } from '@/lib/ui/layers'
import { ABSENT, PRESENT } from './columnas'

const ETIQUETA_DE_PRESENCIA: Record<string, string> = { [PRESENT]: 'Tiene', [ABSENT]: 'No tiene' }

/** El filtro de una columna (Cierre con un solo patrón, spec §4.1): lista de
 *  valores con su cifra facetada, buscador que filtra al tipear, selección
 *  múltiple, "Seleccionar todo" y "Limpiar". Abre en un portal para que ningún
 *  contenedor con `overflow` lo recorte (el defecto del filtro viejo), y Escape
 *  cierra solo esta capa. */
export function ColumnFilter({ header, kind, values, selected, count, onChange, anchor, onClose }: {
  header: string
  kind: 'values' | 'presence'
  values: string[]
  selected: string[]
  count: (value: string) => number
  onChange: (values: string[]) => void
  /** Abierto desde otro botón ("+ Filtro" de la barra): se ancla a él y no dibuja su embudo. */
  anchor?: React.RefObject<HTMLElement | null>
  onClose?: () => void
}) {
  const [abierto, setAbierto] = useState(!!anchor)
  const [q, setQ] = useState('')
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const boton = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const buscador = useRef<HTMLInputElement>(null)
  const esLaDeArriba = useLayer(abierto)
  const tituloId = useId()

  const etiqueta = (v: string) => (kind === 'presence' ? ETIQUETA_DE_PRESENCIA[v] ?? v : v)
  const visibles = values.filter(v => etiqueta(v).toLowerCase().includes(q.trim().toLowerCase()))

  const ancla = anchor ?? boton

  function cerrar() {
    setAbierto(false)
    setQ('')
    ancla.current?.focus()
    onClose?.()
  }

  useLayoutEffect(() => {
    if (!abierto || !ancla.current) return
    const r = ancla.current.getBoundingClientRect()
    setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 272)) })
  }, [abierto])

  useEffect(() => {
    if (!abierto) return
    buscador.current?.focus()
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape' && esLaDeArriba()) cerrar() }
    const fuera = (e: MouseEvent) => {
      const t = e.target as Node
      if (!panel.current?.contains(t) && !ancla.current?.contains(t)) { setAbierto(false); setQ(''); onClose?.() }
    }
    document.addEventListener('keydown', tecla)
    document.addEventListener('mousedown', fuera)
    return () => { document.removeEventListener('keydown', tecla); document.removeEventListener('mousedown', fuera) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto])

  function alternar(v: string) {
    onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v])
  }

  /** Flechas arriba/abajo entre el buscador y las opciones. */
  function mover(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const focos = [buscador.current, ...Array.from(panel.current?.querySelectorAll<HTMLInputElement>('input[type=checkbox]') ?? [])]
      .filter((x): x is HTMLInputElement => !!x)
    const i = focos.indexOf(document.activeElement as HTMLInputElement)
    const siguiente = e.key === 'ArrowDown' ? Math.min(i + 1, focos.length - 1) : Math.max(i - 1, 0)
    focos[siguiente]?.focus()
  }

  const nombre = selected.length
    ? `Filtrar por ${header} (${selected.length} ${selected.length === 1 ? 'elegido' : 'elegidos'})`
    : `Filtrar por ${header}`

  return (
    <>
      {!anchor && <button
        ref={boton} type="button" aria-label={nombre} aria-haspopup="dialog" aria-expanded={abierto}
        onClick={() => (abierto ? cerrar() : setAbierto(true))}
        className={`rounded p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
          selected.length ? 'text-accion' : 'text-informativo hover:text-text-primary'}`}
      >
        <ListFilter size={13} aria-hidden="true" />
      </button>}
      {abierto && createPortal(
        <div
          ref={panel} role="dialog" aria-label={`Filtrar por ${header}`} aria-describedby={tituloId}
          onKeyDown={mover}
          style={pos ? { top: pos.top, left: pos.left } : undefined}
          className="fixed z-50 w-64 rounded-xl border border-border bg-white p-2 shadow-lg"
        >
          <p id={tituloId} className="sr-only">Elige uno o más valores de {header}</p>
          {kind === 'values' && (
            <div className="relative mb-1.5">
              <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-informativo" aria-hidden="true" />
              <input
                ref={buscador} type="search" role="searchbox" value={q} onChange={e => setQ(e.target.value)}
                aria-label={`Buscar en ${header}`} placeholder={`Buscar ${header.toLowerCase()}…`}
                className="w-full rounded-md border border-border py-1 pl-7 pr-2 text-dato focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
          )}
          <ul className="max-h-64 overflow-y-auto">
            {visibles.map(v => {
              const n = count(v)
              return (
                <li key={v}>
                  <label className="flex cursor-pointer items-center justify-between gap-2 rounded px-1.5 py-1 hover:bg-bg-main">
                    <span className="flex min-w-0 items-center gap-2">
                      <input
                        type="checkbox" checked={selected.includes(v)} onChange={() => alternar(v)}
                        aria-label={`${etiqueta(v)}, ${n}`} className="accent-accent"
                      />
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
        </div>,
        document.body,
      )}
    </>
  )
}
