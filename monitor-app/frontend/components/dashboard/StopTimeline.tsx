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
  stops:    TripStop[]
  compact?: boolean
}

export function StopTimeline({ stops, compact = false }: Props) {
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
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-700 truncate">{name}</p>
              {!compact && (
                <p className="text-[10px] text-gray-400">
                  {state === 'done' && `✓ llegó ${fmtShort(stop.arrival_date)} · salió ${fmtShort(stop.departure_date)}`}
                  {state === 'active' && 'en camino'}
                  {state === 'pending' && 'pendiente'}
                  {stopWasVisited(stop) && stop.temperature != null && ` · ${stop.temperature}°C`}
                </p>
              )}
              {compact && state === 'active' && <p className="text-[10px] text-gray-400">en camino</p>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
