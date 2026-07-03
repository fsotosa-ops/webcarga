'use client'

import type { Trip, TripsMeta } from '@/lib/types'
import { TripCard } from './TripCard'

interface Group {
  id:       string
  label:    string
  statuses: string[]
}

interface Props {
  trips:    Trip[]
  groups:   Group[]
  meta?:    TripsMeta | null
  onSaved:  (t: Trip) => void
  onSelect: (t: Trip) => void
}

export function TripBoard({ trips, groups, meta, onSaved, onSelect }: Props) {
  function statusOf(trip: Trip): string {
    return trip.estado_manual ?? trip.current_status ?? ''
  }

  const ungrouped = trips.filter(t => !groups.some(g => g.statuses.includes(statusOf(t))))
  const hasOtroGroup = groups.some(g => g.id === 'otro')

  const grouped = groups.map(g => ({
    ...g,
    trips: g.id === 'otro'
      ? [...trips.filter(t => g.statuses.includes(statusOf(t))), ...ungrouped]
      : trips.filter(t => g.statuses.includes(statusOf(t))),
  }))

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {grouped.map(g => (
        <div key={g.id} className="flex-none w-[220px] bg-gray-50 rounded-xl p-2">
          <div className="flex items-center justify-between px-1 pb-2">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{g.label}</span>
            <span className="text-[10px] text-gray-400">{g.trips.length}</span>
          </div>
          {g.trips.map(trip => (
            <TripCard key={trip.id} trip={trip} meta={meta} onSaved={onSaved} onSelect={onSelect} />
          ))}
          {g.trips.length === 0 && (
            <p className="text-[10px] text-gray-300 text-center py-4">Sin viajes</p>
          )}
        </div>
      ))}
      {!hasOtroGroup && ungrouped.length > 0 && (
        <div className="flex-none w-[220px] bg-gray-50 rounded-xl p-2">
          <div className="flex items-center justify-between px-1 pb-2">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Otro</span>
            <span className="text-[10px] text-gray-400">{ungrouped.length}</span>
          </div>
          {ungrouped.map(trip => (
            <TripCard key={trip.id} trip={trip} meta={meta} onSaved={onSaved} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  )
}
