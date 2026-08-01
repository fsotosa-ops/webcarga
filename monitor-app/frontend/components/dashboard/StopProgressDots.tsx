'use client'

import type { TripStop } from '@/lib/types'
import { getStopStates } from '@/lib/utils/stopState'

interface Props {
  stops: TripStop[]
}

/** Versión compacta (card/board) del mismo lenguaje visual que StopTimeline
 *  y StopPills: verde = visitada, anillo accent = activa, gris = pendiente.
 *  Filtra el origen internamente — el llamador no necesita hacerlo. */
export function StopProgressDots({ stops }: Props) {
  const destinations = stops?.filter(s => s.stop_type !== 'ORIGIN') ?? []
  if (!destinations.length) return null

  const states = getStopStates(destinations)

  return (
    <div className="flex gap-1 items-center">
      {destinations.map((stop, i) => {
        const state = states[i]
        return (
          <span
            key={stop.stop_id ?? i}
            title={stop.local ?? stop.destination_city ?? undefined}
            className={`w-2 h-2 rounded-full shrink-0 ${
              state === 'done'
                ? 'bg-green-500'
                : state === 'active'
                ? 'bg-white border-2 border-accent ring-1 ring-accent/20'
                : 'bg-gray-200'
            }`}
          />
        )
      })}
    </div>
  )
}
