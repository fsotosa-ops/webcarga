'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronDown, ChevronUp, Columns3, GripVertical } from 'lucide-react'
import { useLayer } from '@/lib/ui/layers'
import type { DataColumn } from './columnas'
import type { ColumnPrefs } from './useDataTable'

type Entrada<T> = { column: DataColumn<T>; visible: boolean }

/** "Columnas" (spec §4.1, C5): mostrar u ocultar con casillas y reordenar
 *  arrastrando o con los botones de subir y bajar, que también sirven con teclado.
 *  La columna que identifica la fila (`hideable: false`) no tiene casilla. Cada
 *  cambio entrega la lista completa en orden: es lo que se guarda por persona. */
export function ColumnsMenu<T>({ columns, onChange, onReset }: {
  columns: Entrada<T>[]
  onChange: (prefs: ColumnPrefs) => void
  onReset: () => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const boton = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const esLaDeArriba = useLayer(abierto)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const prefs = (lista: Entrada<T>[]): ColumnPrefs =>
    lista.map(e => ({ id: e.column.id, hidden: !e.visible }))

  function mover(desde: number, hasta: number) {
    if (hasta < 0 || hasta >= columns.length) return
    onChange(prefs(arrayMove(columns, desde, hasta)))
  }

  function alSoltar(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return
    mover(columns.findIndex(c => c.column.id === e.active.id), columns.findIndex(c => c.column.id === e.over!.id))
  }

  useEffect(() => {
    if (!abierto) return
    if (boton.current) {
      const r = boton.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) })
    }
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape' && esLaDeArriba()) { setAbierto(false); boton.current?.focus() } }
    const fuera = (e: MouseEvent) => {
      const t = e.target as Node
      if (!panel.current?.contains(t) && !boton.current?.contains(t)) setAbierto(false)
    }
    document.addEventListener('keydown', tecla)
    document.addEventListener('mousedown', fuera)
    return () => { document.removeEventListener('keydown', tecla); document.removeEventListener('mousedown', fuera) }
  }, [abierto, esLaDeArriba])

  return (
    <>
      <button ref={boton} type="button" aria-haspopup="dialog" aria-expanded={abierto} onClick={() => setAbierto(a => !a)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-dato text-text-primary hover:bg-bg-main">
        <Columns3 size={13} aria-hidden="true" /> Columnas
      </button>
      {abierto && createPortal(
        <div ref={panel} role="dialog" aria-label="Columnas" style={pos ? { top: pos.top, right: pos.right } : undefined}
          className="fixed z-50 w-64 rounded-xl border border-border bg-white p-2 shadow-lg">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={alSoltar}>
            <SortableContext items={columns.map(c => c.column.id)} strategy={verticalListSortingStrategy}>
              <ul>
                {columns.map((e, i) => (
                  <FilaDeColumna key={e.column.id} entrada={e} primera={i === 0} ultima={i === columns.length - 1}
                    onVisible={visible => onChange(prefs(columns.map(x => (x === e ? { ...x, visible } : x))))}
                    onSubir={() => mover(i, i - 1)} onBajar={() => mover(i, i + 1)} />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
          <div className="mt-1.5 border-t border-border/60 pt-1.5">
            <button type="button" onClick={onReset} className="text-etiqueta font-medium text-accion hover:underline">
              Restablecer
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

function FilaDeColumna<T>({ entrada, primera, ultima, onVisible, onSubir, onBajar }: {
  entrada: Entrada<T>; primera: boolean; ultima: boolean
  onVisible: (visible: boolean) => void; onSubir: () => void; onBajar: () => void
}) {
  const { column, visible } = entrada
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: column.id })
  const fija = column.hideable === false
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className="flex items-center gap-1.5 rounded px-1 py-1 hover:bg-bg-main">
      <button type="button" aria-label={`Arrastrar ${column.header}`} {...attributes} {...listeners}
        className="cursor-grab text-informativo">
        <GripVertical size={13} aria-hidden="true" />
      </button>
      {fija
        ? <span className="flex-1 truncate text-dato text-text-primary">{column.header} <span className="text-etiqueta text-informativo">· fija</span></span>
        : (
          <label className="flex flex-1 cursor-pointer items-center gap-2 truncate text-dato text-text-primary">
            <input type="checkbox" checked={visible} onChange={e => onVisible(e.target.checked)}
              aria-label={`Mostrar ${column.header}`} className="accent-accent" />
            {column.header}
          </label>
        )}
      <button type="button" aria-label={`Subir ${column.header}`} disabled={primera} onClick={onSubir}
        className="rounded p-0.5 text-informativo hover:text-text-primary disabled:opacity-30">
        <ChevronUp size={12} aria-hidden="true" />
      </button>
      <button type="button" aria-label={`Bajar ${column.header}`} disabled={ultima} onClick={onBajar}
        className="rounded p-0.5 text-informativo hover:text-text-primary disabled:opacity-30">
        <ChevronDown size={12} aria-hidden="true" />
      </button>
    </li>
  )
}
