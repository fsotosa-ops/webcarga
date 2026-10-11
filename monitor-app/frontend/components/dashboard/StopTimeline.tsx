'use client'

import { Check, Timer } from 'lucide-react'
import type { TripStop } from '@/lib/types'
import { stopWasVisited, describeStopTiming } from '@/lib/utils/temperature'
import { stopDwellTime, transitTime } from '@/lib/utils/stopStats'
import { getStopStates } from '@/lib/utils/stopState'
import { StatusChip } from '@/components/ui/StatusChip'

interface Props {
  stops: TripStop[]
}

export function StopTimeline({ stops }: Props) {
  if (!stops?.length) return null

  const states = getStopStates(stops)

  return (
    <div className="flex flex-col">
      {stops.map((stop, i) => {
        const state = states[i]
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
                    ? 'bg-resuelto text-white'
                    : state === 'active'
                    ? 'bg-white border-2 border-accent ring-4 ring-accent/10'
                    : 'bg-white border-2 border-border'
                }`}
              >
                {state === 'done' && <Check size={10} strokeWidth={3} />}
                {state === 'active' && <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />}
              </span>
              <div className="min-w-0 flex-1 pb-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className={`text-dato truncate ${state === 'active' ? 'font-bold text-text-primary' : 'font-semibold text-text-primary'}`}>{name}</p>
                  {stop.milestone_status && (
                    <StatusChip tone="neutral">{stop.milestone_status}</StatusChip>
                  )}
                </div>
                <p className="text-etiqueta text-informativo mt-0.5">
                  {timing ?? (state === 'done' ? 'completada' : state === 'active' ? 'en camino' : 'pendiente')}
                  {dwell && <span> · {dwell} en parada</span>}
                  {stopWasVisited(stop) && stop.temperature != null && (
                    <span className={stop.temp_status === 'out_of_range' ? 'text-status-incidente font-semibold' : undefined}>
                      {` · ${stop.temperature}°C`}
                    </span>
                  )}
                </p>
                {/* Nº de entrega: dato de Facturación/Operaciones. Se lista
                    completo (no truncado) porque el caso de uso es cruzarlo
                    contra un documento — un "+2" obligaría a abrir otra vista. */}
                {stop.delivery_numbers && stop.delivery_numbers.length > 0 && (
                  <p className="text-etiqueta text-text-primary mt-0.5">
                    <span className="text-informativo">
                      {stop.delivery_numbers.length === 1 ? 'Entrega: ' : 'Entregas: '}
                    </span>
                    <span className="font-identificador">{stop.delivery_numbers.join(' · ')}</span>
                  </p>
                )}
              </div>
            </div>
            {/* Conector + tránsito entre paradas */}
            {!isLast && (
              <div className="flex items-center gap-2.5 pl-[8px] py-0.5">
                <span className="w-px self-stretch min-h-[14px] bg-border ml-[0.5px]" />
                {transit && (
                  <span className="inline-flex items-center gap-1 text-etiqueta text-informativo">
                    <Timer size={11} aria-hidden />
                    {transit}
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
