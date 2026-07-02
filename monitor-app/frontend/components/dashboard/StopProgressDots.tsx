'use client'

import type { TripStop } from '@/lib/types'

interface Props {
  stops: TripStop[]
}

export function StopProgressDots({ stops }: Props) {
  if (!stops?.length) return null

  return (
    <div className="flex gap-0.5 items-center">
      {stops.map((stop, i) => (
        <span
          key={stop.stop_id ?? i}
          title={stop.local ?? stop.destination_city ?? undefined}
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            stop.on_time_status === 'ON TIME' ? 'bg-green-500' :
            stop.on_time_status === 'OFF TIME' ? 'bg-red-500' :
            'bg-gray-200'
          }`}
        />
      ))}
    </div>
  )
}
