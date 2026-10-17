'use client'

import { useState } from 'react'
import { tripStageStyle } from '@/lib/states'
import { Check, Loader2 } from 'lucide-react'
import type { FilterGroup, GroupColor } from '@/lib/api/filterGroups'
import { filterGroupsApi } from '@/lib/api/filterGroups'
import type { StatusMeta } from '@/lib/types'
import { GROUP_COLORS, GROUP_COLOR_IDS, GROUP_COLOR_LABEL } from '@/lib/ui/groupColors'
import { PanelLateral } from '@/components/ui/PanelLateral'
import { Button } from '@/components/ui/Button'
import { Field, FIELD_LABEL, inputClass } from '@/components/ui/Field'

// Fallback when meta hasn't loaded
const STATUS_SECTIONS_FALLBACK = [
  { label: 'En Ruta',    statuses: ['ASIGNADO', 'ORIGEN', 'RUTA'] },
  { label: 'En Local',   statuses: ['EN LOCAL', 'VIAJE EN PREDIO'] },
  { label: 'Retornando', statuses: ['RETORNANDO', 'RETORNADO CD'] },
  { label: 'Cerrados',   statuses: ['CERRADO FINALIZADO', 'CERRADO INCOMPLETO', 'CERRADO MANUAL', 'CERRADO SIN GPS', 'CERRADO POR OTRO VIAJE', 'CERRADO FINALIZADO CC'] },
  { label: 'Problema',   statuses: ['CANCELADO', 'EN PANA', 'DEVUELTO'] },
]

function buildSections(statuses?: StatusMeta[]) {
  if (!statuses?.length) {
    return STATUS_SECTIONS_FALLBACK.map(s => ({
      ...s,
      statuses: s.statuses.map(id => ({ id, label: id })),
    }))
  }
  const grouped: Record<string, { id: string; label: string }[]> = {}
  for (const s of statuses) {
    const g = s.group ?? 'otro'
    if (!grouped[g]) grouped[g] = []
    // label configurado en vez del id crudo (los ids TMS son jerga interna)
    grouped[g].push({ id: s.id, label: s.label || s.id })
  }
  return Object.entries(grouped).map(([group, items]) => ({
    label: tripStageStyle(group).label,
    statuses: items,
  }))
}

interface Props {
  editing?:          FilterGroup
  onSaved:           (group: FilterGroup) => void
  onDeleted?:        (id: string) => void
  onClose:           () => void
  statuses?:         StatusMeta[]   // from meta — replaces hardcoded STATUS_SECTIONS
  initialStatuses?:  string[]       // prefill al crear desde el filtro activo (page.tsx "Guardar como grupo")
}

export function GroupBuilder({ editing, onSaved, onDeleted, onClose, statuses, initialStatuses }: Props) {
  const STATUS_SECTIONS = buildSections(statuses)

  const [name,      setName]      = useState(editing?.name ?? '')
  const [selected,  setSelected]  = useState<Set<string>>(new Set(editing?.statuses ?? initialStatuses ?? []))
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

  const title = editing ? `Editar grupo ${editing.name}` : 'Nuevo grupo de estados'
  const checkboxClass = (encendida: boolean, parcial = false) =>
    `flex shrink-0 items-center justify-center rounded border-2 transition-colors ${
      encendida ? 'border-accent bg-accent' : parcial ? 'border-accent bg-accent/30' : 'border-border group-hover:border-informativo'}`

  return (
    <PanelLateral
      placement="center"
      titulo={title}
      onCerrar={onClose}
      pie={
        <div className="flex items-center gap-2">
          {editing && onDeleted && (
            <Button variant="danger" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 size={12} className="animate-spin" /> : 'Eliminar'}
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" onClick={handleSave} disabled={saving || !name.trim() || selected.size === 0}>
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              {editing ? 'Guardar cambios' : 'Crear grupo'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Nombre del grupo">{id => (
          <input
            id={id}
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            placeholder="Ej: Activos hoy, Por vencer…"
            maxLength={50}
            className={`${inputClass()} w-full`}
          />
        )}</Field>

        <div>
          <p className={`${FIELD_LABEL} mb-1.5`}>Color</p>
          <div role="radiogroup" aria-label="Color" className="flex flex-wrap gap-2">
            {GROUP_COLOR_IDS.map(id => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={color === id}
                aria-label={GROUP_COLOR_LABEL[id]}
                title={GROUP_COLOR_LABEL[id]}
                onClick={() => setColor(id)}
                className={`h-6 w-6 rounded-full ${GROUP_COLORS[id].swatch} transition-all ${
                  color === id ? `ring-2 ring-offset-2 ${GROUP_COLORS[id].ring} scale-110` : 'hover:scale-105'
                }`}
              />
            ))}
          </div>
        </div>

        <div>
          <p className={`${FIELD_LABEL} mb-1.5`}>
            Estados{selected.size > 0 && <span className="ml-1.5 text-accion">({selected.size} seleccionados)</span>}
          </p>
          <div className="space-y-3">
            {STATUS_SECTIONS.map(section => {
              const ids = section.statuses.map(s => s.id)
              const allOn = ids.every(s => selected.has(s))
              const someOn = ids.some(s => selected.has(s))
              return (
                <div key={section.label}>
                  <button
                    type="button"
                    onClick={() => toggleSection(ids)}
                    aria-pressed={allOn}
                    className="group mb-1.5 flex w-full items-center gap-2 text-left"
                  >
                    <span className={`h-4 w-4 ${checkboxClass(allOn, someOn)}`}>
                      {(allOn || someOn) && <Check size={10} className={allOn ? 'text-white' : 'text-accent'} />}
                    </span>
                    <span className="text-dato font-semibold text-text-primary">{section.label}</span>
                  </button>
                  <div className="space-y-1 pl-6">
                    {section.statuses.map(status => (
                      // checkbox real (focuseable/operable por teclado), visual custom
                      <label key={status.id} className="group flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selected.has(status.id)}
                          onChange={() => toggle(status.id)}
                          className="peer sr-only"
                        />
                        <span className={`h-3.5 w-3.5 peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40 ${checkboxClass(selected.has(status.id))}`}>
                          {selected.has(status.id) && <Check size={8} className="text-white" />}
                        </span>
                        <span className="text-dato text-informativo transition-colors group-hover:text-text-primary">
                          {status.label}
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
          <p role="alert" className="rounded-md border border-status-incidente/20 bg-status-incidente/5 px-3 py-2 text-dato text-status-incidente">{error}</p>
        )}
      </div>
    </PanelLateral>
  )
}
