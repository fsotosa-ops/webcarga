'use client'

import type { Trip, TripsMeta } from '@/lib/types'
import { getLatestTemp, classifyTemperature } from '@/lib/utils/temperature'
import { stopComplianceSummary } from '@/lib/utils/compliance'
import { StopProgressDots } from './StopProgressDots'
import { IndicatorDots } from './IndicatorDots'

interface Props {
  trip:     Trip
  meta?:    TripsMeta | null
  onSaved:  (t: Trip) => void
  onSelect: (t: Trip) => void
}

export function TripCard({ trip, meta, onSaved, onSelect }: Props) {
  const temp       = getLatestTemp(trip.stops ?? [])
  const tempStatus = classifyTemperature(temp, trip.cargo_type, meta?.temperature_ranges ?? [])
  const compliance = stopComplianceSummary(trip.stops ?? [])
  const plate      = trip.tractor_plate ?? trip.trailer_plate ?? null

  return (
    <div
      onClick={() => onSelect(trip)}
      className={`bg-white border rounded-lg p-2.5 mb-2 cursor-pointer hover:shadow-sm transition-shadow ${
        compliance === 'warn' ? 'border-l-[3px] border-l-red-500 border-y-border border-r-border' : 'border-border'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`font-mono text-xs font-bold ${plate ? 'text-slate-800' : 'text-gray-300 italic font-normal'}`}>
          {plate ?? 'sin patente'}
        </span>
        {temp != null && (
          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${tempStatus === 'out_of_range' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
            {temp}°C
          </span>
        )}
      </div>
      <p className="text-[11px] text-gray-500 truncate mt-0.5">
        {trip.driver_name ?? <span className="italic text-gray-300">sin conductor</span>}
      </p>
      {(trip.stops?.length ?? 0) > 0 && (
        <div className="mt-1.5">
          <StopProgressDots stops={trip.stops} />
        </div>
      )}
      <div className="flex items-center justify-between mt-1.5">
        {trip.source_system === 'manual' && <IndicatorDots trip={trip} onSaved={onSaved} />}
        {compliance === 'warn' && (
          <span className="text-[8px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">OFF TIME</span>
        )}
      </div>
    </div>
  )
}
