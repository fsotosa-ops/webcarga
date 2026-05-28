'use client'

import { useState } from 'react'
import { X, Check, Loader2 } from 'lucide-react'
import type { FilterGroup, GroupColor } from '@/lib/api/filterGroups'
import { filterGroupsApi } from '@/lib/api/filterGroups'

// All raw status values organized by section
const STATUS_SECTIONS = [
  {
    label: 'En Ruta',
    statuses: ['ASIGNADO', 'ORIGEN', 'RUTA'],
  },
  {
    label: 'En Local',
    statuses: ['EN LOCAL', 'VIAJE EN PREDIO'],
  },
  {
    label: 'Retornando',
    statuses: ['RETORNANDO', 'RETORNADO CD'],
  },
  {
    label: 'Cerrados',
    statuses: [
      'CERRADO FINALIZADO', 'CERRADO INCOMPLETO', 'CERRADO MANUAL',
      'CERRADO SIN GPS', 'CERRADO POR OTRO VIAJE', 'CERRADO FINALIZADO CC',
    ],
  },
  {
    label: 'Problema',
    statuses: ['CANCELADO', 'EN PANA', 'DEVUELTO'],
  },
]

const COLORS: { id: GroupColor; bg: string; ring: string }[] = [
  { id: 'blue',   bg: 'bg-blue-500',   ring: 'ring-blue-500'   },
  { id: 'green',  bg: 'bg-green-500',  ring: 'ring-green-500'  },
  { id: 'orange', bg: 'bg-orange-500', ring: 'ring-orange-500' },
  { id: 'purple', bg: 'bg-purple-500', ring: 'ring-purple-500' },
  { id: 'red',    bg: 'bg-red-500',    ring: 'ring-red-500'    },
  { id: 'teal',   bg: 'bg-teal-500',   ring: 'ring-teal-500'   },
  { id: 'amber',  bg: 'bg-amber-500',  ring: 'ring-amber-500'  },
  { id: 'pink',   bg: 'bg-pink-500',   ring: 'ring-pink-500'   },
]

interface Props {
  /** Pass an existing group to edit it; undefined to create a new one. */
  editing?:  FilterGroup
  onSaved:   (group: FilterGroup) => void
  onDeleted?: (id: string) => void
  onClose:   () => void
}

export function GroupBuilder({ editing, onSaved, onDeleted, onClose }: Props) {
  const [name,      setName]      = useState(editing?.name ?? '')
  const [selected,  setSelected]  = useState<Set<string>>(new Set(editing?.statuses ?? []))
  const [color,     setColor]     = useState<GroupColor>(editing?.color ?? 'blue')
  const [saving,    setSaving]    = useState(false)
  const [deleting,  setDeleting]  = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  function toggle(status: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  }

  function toggleSection(statuses: string[]) {
    const allOn = statuses.every(s => selected.has(s))
    setSelected(prev => {
      const next = new Set(prev)
      if (allOn) statuses.forEach(s => next.delete(s))
      else statuses.forEach(s => next.add(s))
      return next
    })
  }

  async function handleSave() {
    if (!name.trim()) { setError('El nombre es requerido'); return }
    if (selected.size === 0) { setError('Selecciona al menos un estado'); return }
    setError(null); setSaving(true)
    try {
      const payload = { name: name.trim(), statuses: [...selected], color }
      const result = editing
        ? await filterGroupsApi.update(editing.id, payload)
        : await filterGroupsApi.create(payload)
      onSaved(result)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!editing || !onDeleted) return
    if (!confirm(`¿Eliminar el grupo "${editing.name}"?`)) return
    setDeleting(true)
    try {
      await filterGroupsApi.delete(editing.id)
      onDeleted(editing.id)
      onClose()
    } catch {
      setError('Error al eliminar')
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-semibold text-sm text-text-primary">
            {editing ? 'Editar grupo' : 'Nuevo grupo de estados'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-400">
            <X size={15} />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">

          {/* Name */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">Nombre del grupo</label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              placeholder="Ej: Activos hoy, Por vencer…"
              maxLength={50}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30"
            />
          </div>

          {/* Color picker */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-2">Color</label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setColor(c.id)}
                  className={`w-6 h-6 rounded-full ${c.bg} transition-all ${
                    color === c.id ? `ring-2 ring-offset-2 ${c.ring} scale-110` : 'hover:scale-105'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Status checkboxes */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-2">
              Estados{selected.size > 0 && <span className="ml-1.5 text-accent">({selected.size} seleccionados)</span>}
            </label>
            <div className="space-y-3">
              {STATUS_SECTIONS.map(section => {
                const allOn = section.statuses.every(s => selected.has(s))
                const someOn = section.statuses.some(s => selected.has(s))
                return (
                  <div key={section.label}>
                    <button
                      type="button"
                      onClick={() => toggleSection(section.statuses)}
                      className="flex items-center gap-2 w-full text-left mb-1.5 group"
                    >
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                        allOn ? 'border-accent bg-accent' : someOn ? 'border-accent bg-accent/30' : 'border-gray-300 group-hover:border-gray-400'
                      }`}>
                        {(allOn || someOn) && <Check size={10} className={allOn ? 'text-white' : 'text-accent'} />}
                      </div>
                      <span className="text-xs font-semibold text-gray-600">{section.label}</span>
                    </button>
                    <div className="pl-6 space-y-1">
                      {section.statuses.map(status => (
                        <label key={status} className="flex items-center gap-2 cursor-pointer group">
                          <div
                            onClick={() => toggle(status)}
                            className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                              selected.has(status) ? 'border-accent bg-accent' : 'border-gray-300 group-hover:border-gray-400'
                            }`}
                          >
                            {selected.has(status) && <Check size={8} className="text-white" />}
                          </div>
                          <span
                            onClick={() => toggle(status)}
                            className="text-[11px] text-gray-500 group-hover:text-gray-700 transition-colors"
                          >
                            {status}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border flex items-center gap-2">
          {editing && onDeleted && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="px-3 py-2 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
            >
              {deleting ? <Loader2 size={12} className="animate-spin" /> : 'Eliminar'}
            </button>
          )}
          <div className="flex gap-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 text-xs font-medium text-gray-500 border border-border rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !name.trim() || selected.size === 0}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-accent text-white rounded-lg hover:bg-accent/90 disabled:opacity-40 transition-colors"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              {editing ? 'Guardar cambios' : 'Crear grupo'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
