'use client'

import type { TripStop } from '@/lib/types'
import { stopWasVisited } from '@/lib/utils/temperature'
import { fmtShort } from '@/lib/utils/datetime'

type StopState = 'done' | 'active' | 'pending'

function isCompleted(s: TripStop): boolean {
  return !!(s.arrival_date || s.gps_arrival_date || s.on_time_status)
}

function stateFor(i: number, currentIdx: number, stop: TripStop): StopState {
  if (currentIdx < 0) return isCompleted(stop) ? 'done' : 'pending'
  if (i < currentIdx) return 'done'
  if (i === currentIdx) return 'active'
  return 'pending'
}

interface Props {
  stops: TripStop[]
}

export function StopTimeline({ stops }: Props) {
  if (!stops?.length) return null

  const currentIdx = stops.findIndex(s => !isCompleted(s))

  return (
    <div className="flex flex-col">
      {stops.map((stop, i) => {
        const state = stateFor(i, currentIdx, stop)
        const name = stop.local ?? stop.destination_city ?? '—'
        const isLast = i === stops.length - 1
        return (
          <div key={stop.stop_id ?? i} className="flex items-start gap-2 relative pb-2.5 last:pb-0">
            {!isLast && (
              <span className="absolute left-[4px] top-3 bottom-0 w-px bg-gray-200" />
            )}
            <span
              className={`w-2.5 h-2.5 rounded-full mt-0.5 shrink-0 z-10 ${
                state === 'done' ? 'bg-green-500' : state === 'active' ? 'bg-blue-500 ring-4 ring-blue-100' : 'bg-gray-200'
              }`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-xs font-semibold text-slate-700 truncate">{name}</p>
                {stop.on_time_status === 'ON TIME' && (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-green-50 text-green-600 border border-green-100">ON TIME</span>
                )}
                {stop.on_time_status === 'OFF TIME' && (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-100">OFF TIME</span>
                )}
                {stop.milestone_status && (
                  <span className="text-[9px] text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">{stop.milestone_status}</span>
                )}
              </div>
              <p className="text-[10px] text-gray-400">
                {state === 'done' && `✓ llegó ${fmtShort(stop.arrival_date)} · salió ${fmtShort(stop.departure_date)}`}
                {state === 'active' && 'en camino'}
                {state === 'pending' && 'pendiente'}
                {stopWasVisited(stop) && stop.temperature != null && ` · ${stop.temperature}°C`}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
