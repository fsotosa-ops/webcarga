'use client'

import type { Trip, TripsMeta } from '@/lib/types'
import { getLatestTemp, classifyTemperature, getActiveStop, describeStopTiming } from '@/lib/utils/temperature'
import { stopComplianceSummary } from '@/lib/utils/compliance'
import { formatRelativeTime } from '@/lib/utils/datetime'
import { StopProgressDots } from './StopProgressDots'
import { IndicatorDots } from './IndicatorDots'
import { TmsChip } from './TripTable'

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
  const activeStop = getActiveStop(trip.stops ?? [])
  const eta        = activeStop ? describeStopTiming(activeStop) : null
  const since      = formatRelativeTime(trip.status_reported_at)

  return (
    <div
      onClick={() => onSelect(trip)}
      className={`bg-white border rounded-lg p-2.5 mb-2 cursor-pointer hover:shadow-sm transition-shadow ${
        compliance === 'warn' ? 'border-l-[3px] border-l-red-500 border-y-border border-r-border' : 'border-border'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`font-mono text-xs font-bold shrink-0 ${plate ? 'text-slate-800' : 'text-gray-300 italic font-normal'}`}>
            {plate ?? 'sin patente'}
          </span>
          {trip.source_system && <TmsChip tms={trip.source_system} meta={meta} />}
        </div>
        {temp != null && (
          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${tempStatus === 'out_of_range' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
            {temp}°C
          </span>
        )}
      </div>
      <p className="text-[11px] text-gray-500 truncate mt-0.5">
        {trip.driver_name ?? <span className="italic text-gray-300">sin conductor</span>}
        {trip.client_name && <span className="text-gray-300"> · {trip.client_name}</span>}
      </p>
      {(trip.stops?.length ?? 0) > 0 && (
        <div className="mt-1.5">
          <StopProgressDots stops={trip.stops} />
        </div>
      )}
      {(eta || since !== '—') && (
        <p className="text-[9px] text-gray-400 truncate mt-1">
          {eta}
          {eta && since !== '—' && ' · '}
          {since !== '—' && since}
        </p>
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
