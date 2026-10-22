'use client'

import { useRef, useState } from 'react'
import { ChevronDown, Pencil, Star, Trash2 } from 'lucide-react'
import { Popover } from '@/components/ui/Popover'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { inputClass } from '@/components/ui/Field'
import type { SavedView } from '@/lib/api/analytics'

/** "Todas las vistas" (patrón de HubSpot, decisión del usuario 22/10): las pestañas muestran las fijadas; aquí están
 *  todas, con búsqueda, Compartidas o Mías, y por vista fijar, abrir, renombrar y borrar (si puede editarla). */
export function ViewsManager({ views, activeId, onApply, onPin, onRename, onDelete }: {
  views: SavedView[]
  activeId: string | null
  onApply: (v: SavedView) => void
  onPin: (v: SavedView, pinned: boolean) => void
  onRename: (v: SavedView) => void
  onDelete: (v: SavedView) => void
}) {
  const boton = useRef<HTMLButtonElement>(null)
  const [abierto, setAbierto] = useState(false)
  const [q, setQ] = useState('')
  const [alcance, setAlcance] = useState<'shared' | 'personal'>('shared')
  const visibles = views
    .filter(v => v.scope === alcance)
    .filter(v => !q.trim() || v.name.toLowerCase().includes(q.trim().toLowerCase()))

  const detalle = (v: SavedView) =>
    v.scope === 'personal' ? 'Mía' : v.is_mine ? 'Compartida · creada por ti' : v.can_edit ? 'Compartida' : 'Compartida · Sistema'

  return (
    <>
      <button ref={boton} type="button" aria-haspopup="dialog" aria-expanded={abierto} onClick={() => setAbierto(a => !a)}
        className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-informativo hover:text-text-primary">
        Todas las vistas ({views.length}) <ChevronDown size={12} aria-hidden="true" />
      </button>
      <Popover anchor={boton} open={abierto} onClose={() => setAbierto(false)} label="Todas las vistas" align="end" width={360}>
        <div className="space-y-2 p-1">
          <input aria-label="Buscar vista" placeholder="Buscar vista…" value={q} onChange={e => setQ(e.target.value)}
            className={`${inputClass({ size: 'sm' })} w-full`} />
          <SegmentedControl label="Alcance de las vistas" value={alcance} onChange={setAlcance}
            options={[{ id: 'shared', label: 'Compartidas' }, { id: 'personal', label: 'Mías' }]} />
          <ul className="max-h-72 space-y-0.5 overflow-y-auto">
            {visibles.length === 0 && (
              <li className="px-2 py-3 text-center text-dato text-informativo">
                {q.trim() ? 'Ninguna vista con ese nombre' : alcance === 'personal' ? 'Todavía no guardas vistas propias' : 'No hay vistas compartidas'}
              </li>
            )}
            {visibles.map(v => (
              <li key={v.id} className={`flex items-center gap-1 rounded-lg px-1 py-1 ${v.id === activeId ? 'bg-accent/10' : 'hover:bg-bg-main'}`}>
                <button type="button" aria-label={v.pinned ? `Soltar ${v.name}` : `Fijar ${v.name}`} aria-pressed={v.pinned}
                  onClick={() => onPin(v, !v.pinned)} className="rounded p-1 text-informativo hover:text-accion">
                  <Star size={14} aria-hidden="true" className={v.pinned ? 'fill-accent text-accent' : ''} />
                </button>
                <button type="button" onClick={() => { onApply(v); setAbierto(false) }}
                  className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-dato font-medium text-text-primary">{v.name}</span>
                  <span className="block text-etiqueta text-informativo">{detalle(v)}</span>
                </button>
                {v.can_edit && (
                  <>
                    <button type="button" aria-label={`Renombrar ${v.name}`} onClick={() => { setAbierto(false); onRename(v) }}
                      className="rounded p-1 text-informativo hover:text-accion">
                      <Pencil size={13} aria-hidden="true" />
                    </button>
                    <button type="button" aria-label={`Borrar ${v.name}`} onClick={() => { setAbierto(false); onDelete(v) }}
                      className="rounded p-1 text-informativo hover:text-status-incidente">
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      </Popover>
    </>
  )
}
