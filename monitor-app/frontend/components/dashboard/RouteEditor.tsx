'use client'

import type { TripStopCreatePayload } from '@/lib/types'
import { Plus, Trash2 } from 'lucide-react'
import { RegionCityPicker } from '@/components/ui/RegionCityPicker'

interface Props {
  /** Incluye a lo sumo 1 stop con stop_type='ORIGIN' + N con stop_type=
   *  'DESTINATION' (o sin stop_type, tratado como DESTINATION). Mismo shape
   *  que POST /trips espera desde el Plan 1 de la Fase 2 (backend). */
  stops:    TripStopCreatePayload[]
  onChange: (stops: TripStopCreatePayload[]) => void
  size?:    'sm' | 'md'
}

const INPUT = "w-full text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all placeholder:text-gray-300"
const INPUT_SM = "w-full text-xs border border-border rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all placeholder:text-gray-300"
// Sin w-full: convive en la fila de destino con el input de nombre (INPUT trae
// w-full y dos utilidades de ancho en conflicto dejan el ancho al azar del stylesheet)
const INPUT_DATE = "text-sm border border-border rounded-lg px-2 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all w-[150px] sm:w-[185px]"

export function RouteEditor({ stops, onChange, size = 'md' }: Props) {
  const origin       = stops.find(s => s.stop_type === 'ORIGIN') ?? null
  const destinations = stops.filter(s => s.stop_type !== 'ORIGIN')
  const inputCls      = size === 'sm' ? INPUT_SM : INPUT

  function setOrigin(local: string) {
    const rest = stops.filter(s => s.stop_type !== 'ORIGIN')
    onChange([{ local, stop_type: 'ORIGIN' }, ...rest])
  }

  function addDestination() {
    onChange([...stops, { local: '', planning_date: null, stop_type: 'DESTINATION' }])
  }

  function patchDestination(index: number, patch: Partial<TripStopCreatePayload>) {
    let seen = -1
    onChange(stops.map(s => {
      if (s.stop_type === 'ORIGIN') return s
      seen += 1
      return seen === index ? { ...s, ...patch } : s
    }))
  }

  function removeDestination(index: number) {
    let seen = -1
    onChange(stops.filter(s => {
      if (s.stop_type === 'ORIGIN') return true
      seen += 1
      return seen !== index
    }))
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Origen</label>
        <input
          type="text"
          value={origin?.local ?? ''}
          onChange={e => setOrigin(e.target.value)}
          placeholder="Nombre del origen (CD, planta…)"
          aria-label="Origen"
          className={inputCls}
        />
      </div>
      <div className="space-y-2">
        <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Destinos</label>
        {destinations.map((s, i) => (
          <div key={i} className="space-y-1.5 border border-border/60 rounded-lg p-2">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
              <input
                type="text"
                value={s.local}
                onChange={e => patchDestination(i, { local: e.target.value })}
                placeholder={`Destino ${i + 1} — nombre del local`}
                className={inputCls}
                aria-label={`Nombre destino ${i + 1}`}
              />
              <input
                type="datetime-local"
                value={s.planning_date ?? ''}
                onChange={e => patchDestination(i, { planning_date: e.target.value || null })}
                className={INPUT_DATE}
                aria-label={`Fecha planificada destino ${i + 1}`}
              />
              <button
                type="button"
                onClick={() => removeDestination(i)}
                aria-label={`Quitar destino ${i + 1}`}
                className="p-2 rounded-lg border border-transparent text-gray-400 hover:text-red-500 hover:border-red-200 hover:bg-red-50 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <RegionCityPicker
              size="sm"
              region={s.destination_region ?? null}
              city={s.destination_city ?? null}
              onChange={(region, city) => patchDestination(i, { destination_region: region, destination_city: city })}
              labelSuffix={`destino ${i + 1}`}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={addDestination}
          className="flex items-center gap-1.5 text-xs text-accent hover:text-accent/80 transition-colors"
        >
          <Plus size={12} />
          Agregar destino
        </button>
      </div>
    </div>
  )
}
