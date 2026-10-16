'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { Location } from '@/lib/types'
import { locationsApi } from '@/lib/api/locations'
import { useTripsMeta } from '@/hooks/useTripsMeta'
import { INPUT } from '@/app/dashboard/admin/settings/shared'

/** Tab "Por revisar" (Robustecer Tarifario, 2026-07-27) — solo locales sin
 *  ninguna región disponible en su historial de viajes (needs_manual_
 *  classification=true del backend). Todo lo demás se auto-clasifica solo
 *  y nunca llega acá — ver docs/superpowers/specs/2026-07-27-tarifario-
 *  robustecimiento-design.md.
 *
 *  Ajuste 2026-07-28: click en la tarjeta (fuera del <select>) llama a
 *  onSelect — el padre lo usa para saltar a "Todos los locales" filtrado
 *  por ese nombre, en vez de un panel de detalle nuevo.
 *
 *  Las zonas salen del catálogo de la API (`meta.operation_types`); sin
 *  `canEdit` (commercial.edit) se ve qué falta clasificar, sin selector. */
export function LocationsPendingTab({
  items, shipperName, onChanged, onSelect, canEdit,
}: {
  items: Location[]
  shipperName: (entityId: string) => string
  onChanged: () => void
  onSelect: (loc: Location) => void
  canEdit: boolean
}) {
  const zonas = useTripsMeta().data?.operation_types ?? []
  const [saving, setSaving] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  async function classify(loc: Location, operationType: string) {
    if (!operationType) return
    setSaving(loc.id)
    setErrors(e => { const n = { ...e }; delete n[loc.id]; return n })
    try {
      await locationsApi.patch(loc.id, { operation_type: operationType })
      onChanged()
    } catch (e) {
      setErrors(prev => ({ ...prev, [loc.id]: e instanceof Error ? e.message : 'Error al guardar' }))
    } finally {
      setSaving(null)
    }
  }

  if (items.length === 0) {
    return (
      <p className="bg-white rounded-2xl border border-border px-4 py-14 text-center text-dato text-informativo">
        Sin locales por revisar — todo lo que llega del TMS con datos de viaje se clasifica solo.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {items.map(loc => (
        <div
          key={loc.id}
          onClick={() => onSelect(loc)}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter') onSelect(loc) }}
          className="flex items-center justify-between bg-white border border-border rounded-xl px-4 py-3 cursor-pointer hover:border-accent/30 transition-colors"
        >
          <div>
            <p className="text-dato font-semibold text-text-primary">{loc.name}</p>
            <p className="text-etiqueta text-informativo mt-0.5">{shipperName(loc.entity_id)} · sin viajes registrados todavía</p>
            {errors[loc.id] && <p role="alert" className="text-etiqueta text-status-incidente mt-1">{errors[loc.id]}</p>}
          </div>
          {canEdit && <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
            {saving === loc.id && <Loader2 size={13} className="animate-spin text-accent" />}
            <select
              defaultValue=""
              disabled={saving === loc.id}
              onChange={e => classify(loc, e.target.value)}
              aria-label={`Clasificar ${loc.name}`}
              className={INPUT}
            >
              <option value="" disabled>Elegir zona…</option>
              {zonas.map(z => <option key={z.id} value={z.id}>{z.label}</option>)}
            </select>
          </div>}
        </div>
      ))}
    </div>
  )
}
