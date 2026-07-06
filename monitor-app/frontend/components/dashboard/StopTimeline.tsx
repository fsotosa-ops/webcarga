'use client'

import { Check, Timer } from 'lucide-react'
import type { TripStop } from '@/lib/types'
import { stopWasVisited, describeStopTiming } from '@/lib/utils/temperature'
import { stopDwellTime, transitTime } from '@/lib/utils/stopStats'

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
        const timing = describeStopTiming(stop)
        const dwell = stopDwellTime(stop)
        const transit = isLast ? null : transitTime(stop, stops[i + 1])
        return (
          <div key={stop.stop_id ?? i} className="relative">
            <div className="flex items-start gap-2.5">
              <span
                className={`w-[18px] h-[18px] rounded-full mt-0.5 shrink-0 z-10 flex items-center justify-center ${
                  state === 'done'
                    ? 'bg-green-500 text-white'
                    : state === 'active'
                    ? 'bg-white border-2 border-accent ring-4 ring-accent/10'
                    : 'bg-white border-2 border-gray-200'
                }`}
              >
                {state === 'done' && <Check size={10} strokeWidth={3} />}
                {state === 'active' && <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />}
              </span>
              <div className="min-w-0 flex-1 pb-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className={`text-xs truncate ${state === 'active' ? 'font-bold text-slate-800' : 'font-semibold text-slate-700'}`}>{name}</p>
                  {/* Gestión por excepción: solo se badgea lo que está MAL —
                      ON TIME ya lo comunica el check verde (feedback 2026-07-06: saturación) */}
                  {stop.on_time_status === 'OFF TIME' && (
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-100">OFF TIME</span>
                  )}
                  {stop.milestone_status && (
                    <span className="text-[9px] text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">{stop.milestone_status}</span>
                  )}
                </div>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  {timing ?? (state === 'done' ? 'completada' : state === 'active' ? 'en camino' : 'pendiente')}
                  {dwell && <span className="text-gray-500"> · {dwell} en parada</span>}
                  {stopWasVisited(stop) && stop.temperature != null && ` · ${stop.temperature}°C`}
                </p>
              </div>
            </div>
            {/* Conector + tránsito entre paradas */}
            {!isLast && (
              <div className="flex items-center gap-2.5 pl-[8px] py-0.5">
                <span className="w-px self-stretch min-h-[14px] bg-gray-200 ml-[0.5px]" />
                {transit && (
                  <span className="inline-flex items-center gap-1 text-[9px] text-gray-400">
                    <Timer size={9} />
                    {transit} de tránsito
                  </span>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
