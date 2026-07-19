'use client'

import { useEffect, useRef, useState } from 'react'
import { Bell, X, Star } from 'lucide-react'
import type { AlertSignalDef, AlertSignalId } from '@/lib/utils/alertSignals'

interface Props {
  defs:          AlertSignalDef[]
  counts:        Record<AlertSignalId, number>
  active:        AlertSignalId[]
  pinned:        AlertSignalId[]
  onToggle:      (id: AlertSignalId) => void
  onTogglePin:   (id: AlertSignalId) => void
}

export function AlertsPopover({ defs, counts, active, pinned, onToggle, onTogglePin }: Props) {
  const [open, setOpen] = useState(false)
  const panelRef  = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus() } }
    const onClick = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open])

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all ${
          active.length > 0
            ? 'text-accent border-accent/40 bg-accent/5'
            : 'text-gray-500 border-border bg-white hover:border-gray-300'
        }`}
      >
        <Bell size={13} />
        Alertas
        {active.length > 0 && (
          <span className="inline-flex items-center justify-center min-w-4 h-4 px-1 text-[10px] font-bold bg-accent text-white rounded-full">
            {active.length}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Alertas"
          className="absolute left-0 top-full mt-1.5 z-30 w-80 bg-white border border-border rounded-xl shadow-xl p-2 animate-modal-in"
        >
          <div className="flex items-center justify-between px-2 py-1.5">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Alertas</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar alertas"
              className="text-gray-300 hover:text-gray-500">
              <X size={14} />
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-border/50">
            {defs.map(def => {
              const isActive = active.includes(def.id)
              const isPinned = pinned.includes(def.id)
              const count = counts[def.id] ?? 0
              return (
                <div key={def.id} className="flex items-center gap-2 px-2 py-2">
                  <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={() => onToggle(def.id)}
                      className="shrink-0"
                    />
                    <span className="text-xs text-gray-700 truncate">{def.label}</span>
                  </label>
                  <span className={`text-xs font-bold ${count > 0 ? def.colorCls : 'text-gray-300'}`}>{count}</span>
                  <button
                    type="button"
                    onClick={() => onTogglePin(def.id)}
                    aria-label={isPinned ? `Quitar ${def.label} de las tiles fijas` : `Fijar ${def.label} como tile visible`}
                    aria-pressed={isPinned}
                    className={`shrink-0 p-1 rounded transition-colors ${isPinned ? 'text-amber-500' : 'text-gray-300 hover:text-gray-400'}`}
                  >
                    <Star size={13} fill={isPinned ? 'currentColor' : 'none'} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
