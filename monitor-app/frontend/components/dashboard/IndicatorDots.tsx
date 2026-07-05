'use client'

import { useState } from 'react'
import { Lock } from 'lucide-react'
import type { Trip } from '@/lib/types'
import { tripsApi, type TripPatch } from '@/lib/api/trips'
import { fmtDT } from '@/lib/utils/datetime'

type IndicatorField = 'activo' | 'trabajando' | 'asignado' | 'primera_vuelta'

const INDICATORS: { field: IndicatorField; label: string; title: string; color: string }[] = [
  { field: 'activo',         label: 'A',  title: 'Activo',     color: 'bg-blue-500'   },
  { field: 'trabajando',     label: 'T',  title: 'Trabajando', color: 'bg-green-500'  },
  { field: 'asignado',       label: 'As', title: 'Asignado',   color: 'bg-violet-500' },
  { field: 'primera_vuelta', label: '1V', title: '1ra Vuelta', color: 'bg-amber-500'  },
]

interface Props {
  trip:    Trip
  onSaved: (updated: Trip) => void
  size?:   'sm' | 'md'
}

export function IndicatorDots({ trip, onSaved, size = 'sm' }: Props) {
  const [pending, setPending]       = useState<Partial<Record<IndicatorField, boolean>>>({})
  const [optimistic, setOptimistic] = useState<Partial<Record<IndicatorField, boolean>>>({})
  const [error, setError]           = useState<string | null>(null)

  async function toggle(field: IndicatorField, e: React.MouseEvent) {
    e.stopPropagation()
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

  const dotSize = size === 'md' ? 'w-3 h-3' : 'w-2.5 h-2.5'

  return (
    <div onClick={e => e.stopPropagation()}>
      <div className="flex gap-1 items-center">
        {INDICATORS.map(ind => {
          const active = optimistic[ind.field] ?? trip[ind.field]
          const frozen = trip.manually_edited_fields?.includes(ind.field) ?? false
          return (
            <span key={ind.field} className="relative inline-flex">
              <button
                type="button"
                title={frozen
                  ? `${ind.title} — congelado por ${trip.edited_by ?? 'alguien'} el ${fmtDT(trip.edited_at)}`
                  : ind.title}
                disabled={!!pending[ind.field]}
                onClick={e => toggle(ind.field, e)}
                className={`${dotSize} rounded-full transition-all hover:scale-110 disabled:opacity-50 ${
                  active ? ind.color : 'bg-gray-200'
                }`}
              />
              {frozen && (
                <Lock size={7} className="absolute -top-1 -right-1 text-slate-500 pointer-events-none" aria-label="congelado" />
              )}
            </span>
          )
        })}
      </div>
      {error && <p className="text-[9px] text-red-500 mt-0.5 max-w-[140px]">{error}</p>}
    </div>
  )
}
