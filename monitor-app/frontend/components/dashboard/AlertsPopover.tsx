'use client'

import { useRef, useState } from 'react'
import { Bell, X, Star } from 'lucide-react'
import type { AlertSignalDef, AlertSignalId } from '@/lib/utils/alertSignals'
import { SIGNAL_TONE_TEXT } from '@/lib/states'
import { Button } from '@/components/ui/Button'
import { Popover } from '@/components/ui/Popover'

interface Props {
  defs:          AlertSignalDef[]
  counts:        Record<AlertSignalId, number>
  active:        AlertSignalId[]
  pinned:        AlertSignalId[]
  onToggle:      (id: AlertSignalId) => void
  onTogglePin:   (id: AlertSignalId) => void
}

/** "Alertas" del Monitor: todas las señales, cuál filtra y cuál va fija como recuadro.
 *  El panel es el `Popover` del kit (Escape, clic afuera, el foco vuelve al botón): antes
 *  traía su propia copia de ese comportamiento. */
export function AlertsPopover({ defs, counts, active, pinned, onToggle, onTogglePin }: Props) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <Button ref={buttonRef} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(v => !v)}
        className={active.length > 0 ? 'border-accent/40 bg-accent/5 text-accion' : ''}>
        <Bell size={13} aria-hidden="true" />
        Alertas
        {active.length > 0 && (
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-etiqueta font-bold text-white">
            {active.length}
          </span>
        )}
      </Button>

      <Popover anchor={buttonRef} open={open} onClose={() => setOpen(false)} label="Alertas" width={320}>
        <div className="flex items-center justify-between px-2 py-1.5">
          <p className="text-etiqueta font-semibold text-informativo">Alertas</p>
          <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar alertas"
            className="text-informativo hover:text-text-primary">
            <X size={14} aria-hidden="true" />
          </button>
        </div>
        <div className="max-h-80 divide-y divide-border/50 overflow-y-auto">
          {defs.map(def => {
            const isActive = active.includes(def.id)
            const isPinned = pinned.includes(def.id)
            const count = counts[def.id] ?? 0
            return (
              <div key={def.id} className="flex items-center gap-2 px-2 py-2">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={isActive} onChange={() => onToggle(def.id)} className="shrink-0 accent-accent" />
                  <span className="truncate text-dato text-text-primary">{def.label}</span>
                </label>
                <span className={`text-dato font-bold tabular-nums ${count > 0 ? SIGNAL_TONE_TEXT[def.tone] : 'text-informativo'}`}>{count}</span>
                <button
                  type="button"
                  onClick={() => onTogglePin(def.id)}
                  aria-label={isPinned ? `Quitar ${def.label} de las tiles fijas` : `Fijar ${def.label} como tile visible`}
                  aria-pressed={isPinned}
                  className={`shrink-0 rounded p-1 transition-colors ${isPinned ? 'text-accion' : 'text-informativo hover:text-text-primary'}`}
                >
                  <Star size={13} fill={isPinned ? 'currentColor' : 'none'} aria-hidden="true" />
                </button>
              </div>
            )
          })}
        </div>
      </Popover>
    </>
  )
}
