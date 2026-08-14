'use client'

import { FileQuestion, Trash2 } from 'lucide-react'
import type { TrayItem } from '@/lib/types'

interface Props {
  items:       TrayItem[]
  focusedId:   string | null
  selectedIds: Set<string>
  onFocus:     (id: string) => void
  onToggle:    (id: string) => void
  onToggleAll: () => void
  onDiscard:   (id: string) => void
}

/** Panel izquierdo de la bandeja: los archivos que esperan clasificación.
 *
 *  Concentra toda la interacción de teclado — flechas para moverse, espacio
 *  para marcar, Delete para descartar — porque vaciar una bandeja de dos mil
 *  documentos con el mouse no es viable. */
export function TriageFileList({
  items, focusedId, selectedIds, onFocus, onToggle, onToggleAll, onDiscard,
}: Props) {
  function handleKey(e: React.KeyboardEvent) {
    if (!items.length) return
    const i = items.findIndex(it => it.id === focusedId)
    const cur = i < 0 ? 0 : i

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      onFocus(items[Math.min(cur + 1, items.length - 1)].id)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      onFocus(items[Math.max(cur - 1, 0)].id)
    } else if (e.key === ' ') {
      e.preventDefault()
      onToggle(items[cur].id)
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      onDiscard(items[cur].id)
    }
  }

  if (!items.length) {
    return (
      <div className="p-4 text-center">
        <FileQuestion size={20} className="mx-auto text-gray-300 mb-2" />
        <p className="text-xs text-gray-400">No hay documentos sin clasificar</p>
        <p className="text-[11px] text-gray-400 mt-1">
          Arrastrá archivos para empezar.
        </p>
      </div>
    )
  }

  const allSelected = items.every(it => selectedIds.has(it.id))

  return (
    <div
      role="listbox"
      tabIndex={0}
      aria-label="Documentos sin clasificar"
      onKeyDown={handleKey}
      className="focus:outline-none focus:ring-2 focus:ring-accent/40 rounded-lg"
    >
      <label className="flex items-center gap-2 px-2 py-1.5 text-[11px] font-semibold text-gray-500 border-b border-border">
        <input
          type="checkbox"
          aria-label="Seleccionar todos"
          checked={allSelected}
          onChange={onToggleAll}
        />
        Todos ({items.length})
      </label>

      {items.map(item => {
        const focused = item.id === focusedId
        const checked = selectedIds.has(item.id)
        return (
          <div
            key={item.id}
            role="option"
            aria-selected={checked}
            onClick={() => onFocus(item.id)}
            className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer transition-colors ${
              focused ? 'bg-accent/10' : 'hover:bg-gray-50'
            }`}
          >
            <input
              type="checkbox"
              aria-label={`Seleccionar ${item.file_name}`}
              checked={checked}
              onChange={() => onToggle(item.id)}
              onClick={e => e.stopPropagation()}
            />
            <span className="text-[11px] truncate flex-1 font-mono">{item.file_name}</span>
            <button
              type="button"
              aria-label={`Descartar ${item.file_name}`}
              onClick={e => { e.stopPropagation(); onDiscard(item.id) }}
              className="p-0.5 text-gray-400 hover:text-red-500 transition-colors"
            >
              <Trash2 size={11} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
