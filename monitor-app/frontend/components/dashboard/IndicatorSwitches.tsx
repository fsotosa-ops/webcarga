'use client'

import { useState } from 'react'
import type { Trip } from '@/lib/types'
import { tripsApi, type TripPatch } from '@/lib/api/trips'
import { fmtDT } from '@/lib/utils/datetime'

type IndicatorField = 'is_active' | 'is_working' | 'is_assigned'

const INDICATORS: { field: IndicatorField; label: string }[] = [
  { field: 'is_active',   label: 'Activo' },
  { field: 'is_working',  label: 'Trabajando' },
  { field: 'is_assigned', label: 'Asignado' },
]

// En un viaje del TMS, Activo y Trabajando los define el TMS (09/10): el
// backend rechaza el cambio (PATCH /trips/{id}, 422). Asignado sigue siendo
// una corrección de Operaciones.
const DEL_TMS: IndicatorField[] = ['is_active', 'is_working']

interface Props {
  trip:    Trip
  onSaved: (updated: Trip) => void
}

export function IndicatorSwitches({ trip, onSaved }: Props) {
  const [pending, setPending]       = useState<Partial<Record<IndicatorField, boolean>>>({})
  const [optimistic, setOptimistic] = useState<Partial<Record<IndicatorField, boolean>>>({})
  const [reverting, setReverting]   = useState<Partial<Record<IndicatorField, boolean>>>({})
  const [error, setError]           = useState<string | null>(null)

  async function toggle(field: IndicatorField) {
    const next = !(optimistic[field] ?? trip[field])
    setOptimistic(o => ({ ...o, [field]: next }))
    setPending(p => ({ ...p, [field]: true }))
    setError(null)
    try {
      const updated = await tripsApi.patch(trip.id, { [field]: next } as TripPatch)
      onSaved(updated)
      setOptimistic(o => { const n = { ...o }; delete n[field]; return n })
    } catch (err) {
      setOptimistic(o => { const n = { ...o }; delete n[field]; return n })
      setError(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setPending(p => { const n = { ...p }; delete n[field]; return n })
    }
  }

  async function revert(field: IndicatorField) {
    setReverting(r => ({ ...r, [field]: true }))
    setError(null)
    try {
      // DELETE /trips/{id}/overrides/{field} devuelve solo {ok, field} — no
      // recalcula manually_edited_fields del lado del servidor, así que el
      // filtro local es la única forma de reflejarlo sin esperar un refetch.
      await tripsApi.resetField(trip.id, field)
      onSaved({
        ...trip,
        manually_edited_fields: (trip.manually_edited_fields ?? []).filter(f => f !== field),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al revertir')
    } finally {
      setReverting(r => { const n = { ...r }; delete n[field]; return n })
    }
  }

  return (
    <div className="space-y-2.5">
      {INDICATORS.map(ind => {
        const active = optimistic[ind.field] ?? trip[ind.field]
        const frozen = trip.manually_edited_fields?.includes(ind.field) ?? false
        const delTms = trip.source_system !== 'manual' && DEL_TMS.includes(ind.field)
        return (
          <div key={ind.field}>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-700">{ind.label}</span>
              <button
                type="button"
                role="switch"
                aria-checked={active}
                aria-label={ind.label}
                disabled={delTms || !!pending[ind.field]}
                onClick={() => toggle(ind.field)}
                className={`relative w-8 h-4 rounded-full transition-colors disabled:opacity-50 ${
                  active ? 'bg-accent' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${
                    active ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            {delTms && <p className="text-[11px] text-informativo mt-1">Lo define el TMS</p>}
            {frozen && (
              <p className="text-[10px] text-gray-400 mt-1">
                Editado manualmente {trip.edited_by ? `por ${trip.edited_by} ` : ''}el {fmtDT(trip.edited_at)} ·{' '}
                <button
                  type="button"
                  disabled={!!reverting[ind.field]}
                  onClick={() => revert(ind.field)}
                  className="text-accent hover:text-accent/80 underline disabled:opacity-50"
                >
                  Revertir a automático
                </button>
              </p>
            )}
          </div>
        )
      })}
      {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}
    </div>
  )
}
