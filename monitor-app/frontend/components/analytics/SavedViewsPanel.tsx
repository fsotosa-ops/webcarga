'use client'

import { Pencil, Plus, Trash2 } from 'lucide-react'
import { inputClass } from '@/components/ui/Field'
import type { SavedView } from '@/lib/api/analytics'

/** Las vistas guardadas (HU Analítica, criterios 9 y 10): compartidas y mías. En el escritorio, una lista a la
 *  izquierda; en el teléfono, un selector arriba. */
export function SavedViewsPanel({ views, activeId, onApply, onNew, onRename, onDelete }: {
  views: SavedView[]
  activeId: string | null
  onApply: (view: SavedView) => void
  onNew: () => void
  /** Solo para las vistas que la persona puede editar (`can_edit`). */
  onRename?: (view: SavedView) => void
  onDelete?: (view: SavedView) => void
}) {
  const grupos = [
    { titulo: 'Compartidas', vistas: views.filter(v => v.scope === 'shared') },
    { titulo: 'Mías', vistas: views.filter(v => v.scope === 'personal') },
  ]
  return (
    <>
      <nav aria-label="Vistas guardadas" className="hidden w-52 shrink-0 space-y-4 lg:block">
        {grupos.map(g => (
          <div key={g.titulo}>
            <p className="mb-1 text-etiqueta font-semibold text-informativo">{g.titulo}</p>
            {g.vistas.length === 0 && <p className="text-etiqueta text-informativo">Ninguna</p>}
            <ul className="space-y-0.5">
              {g.vistas.map(v => (
                <li key={v.id} className="group flex items-center gap-0.5">
                  <button type="button" onClick={() => onApply(v)} aria-current={v.id === activeId ? 'true' : undefined}
                    className={`min-w-0 flex-1 truncate rounded-md px-2 py-1 text-left text-dato ${v.id === activeId
                      ? 'bg-accent/10 font-semibold text-text-primary' : 'text-text-primary hover:bg-bg-main'}`}>
                    {v.name}
                  </button>
                  {v.can_edit && onRename && (
                    <button type="button" aria-label={`Renombrar ${v.name}`} onClick={() => onRename(v)}
                      className="rounded p-1 text-informativo hover:text-accion focus-visible:opacity-100 lg:opacity-0 lg:group-hover:opacity-100">
                      <Pencil size={12} aria-hidden="true" />
                    </button>
                  )}
                  {v.can_edit && onDelete && (
                    <button type="button" aria-label={`Borrar ${v.name}`} onClick={() => onDelete(v)}
                      className="rounded p-1 text-informativo hover:text-status-incidente focus-visible:opacity-100 lg:opacity-0 lg:group-hover:opacity-100">
                      <Trash2 size={12} aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <button type="button" onClick={onNew}
          className="inline-flex items-center gap-1 text-dato font-semibold text-accion hover:underline">
          <Plus size={14} aria-hidden="true" /> Nueva vista
        </button>
      </nav>
      <label className="flex items-center gap-2 text-dato lg:hidden">
        <span className="text-informativo">Vista</span>
        <select aria-label="Vista guardada" value={activeId ?? ''} className={`${inputClass({ size: 'sm' })} flex-1`}
          onChange={e => {
            if (e.target.value === '__nueva') { onNew(); return }
            const v = views.find(x => x.id === e.target.value)
            if (v) onApply(v)
          }}>
          <option value="">Sin vista</option>
          {grupos.map(g => g.vistas.length > 0 && (
            <optgroup key={g.titulo} label={g.titulo}>
              {g.vistas.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </optgroup>
          ))}
          <option value="__nueva">+ Guardar como vista nueva</option>
        </select>
      </label>
    </>
  )
}
