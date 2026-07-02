'use client'

import type { Trip, TripsMeta } from '@/lib/types'
import { getLatestTemp, classifyTemperature } from '@/lib/utils/temperature'
import { StopTimeline } from './StopTimeline'
import { IndicatorDots } from './IndicatorDots'

interface Props {
  trip:       Trip
  meta?:      TripsMeta | null
  onSaved:    (t: Trip) => void
  onOpenFull: () => void
}

export function TripRowExpanded({ trip, meta, onSaved, onOpenFull }: Props) {
  const temp       = getLatestTemp(trip.stops ?? [])
  const tempStatus = classifyTemperature(temp, trip.cargo_type, meta?.temperature_ranges ?? [])

  return (
    <div
      className="px-4 py-3 flex flex-col md:flex-row gap-4 md:items-start bg-blue-50/30"
      onClick={e => e.stopPropagation()}
    >
      <div className="shrink-0">
        <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">Temp</p>
        {temp != null
          ? <p className={`text-lg font-black ${tempStatus === 'out_of_range' ? 'text-red-600' : 'text-blue-600'}`}>{temp}°C</p>
          : <p className="text-sm text-gray-300">—</p>}
      </div>

      <div className="flex-1 min-w-0">
        <StopTimeline stops={trip.stops ?? []} compact />
      </div>

      <div className="shrink-0 space-y-1.5">
        <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">Indicadores</p>
        <IndicatorDots trip={trip} onSaved={onSaved} size="md" />
        <button
          type="button"
          onClick={onOpenFull}
          className="text-[11px] font-semibold text-accent hover:text-accent/80 transition-colors block"
        >
          Ver ficha completa →
        </button>
      </div>
    </div>
  )
}
