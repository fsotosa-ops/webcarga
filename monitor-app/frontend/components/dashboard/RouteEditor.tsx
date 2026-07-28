'use client'

import { useState } from 'react'
import type { Location, TripStopCreatePayload } from '@/lib/types'
import { Plus, Trash2 } from 'lucide-react'
import { LocationPicker } from './LocationPicker'

interface Props {
  /** Incluye a lo sumo 1 stop con stop_type='ORIGIN' + N con stop_type=
   *  'DESTINATION' (o sin stop_type, tratado como DESTINATION). Mismo shape
   *  que POST /trips espera desde el Plan 1 de la Fase 2 (backend). */
  stops:    TripStopCreatePayload[]
  onChange: (stops: TripStopCreatePayload[]) => void
  size?:    'sm' | 'md'
}

const ZONE_LABEL: Record<string, string> = {
  RM: 'RM', Z0: 'Zona Cero', 'Region Norte': 'Región Norte', 'Region Sur': 'Región Sur',
}

// Sin w-full: convive en la fila de destino con el input de nombre (LocationPicker
// trae w-full y dos utilidades de ancho en conflicto dejan el ancho al azar del stylesheet)
const INPUT_DATE = "text-sm border border-border rounded-lg px-2 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all w-[150px] sm:w-[185px]"

export function RouteEditor({ stops, onChange, size = 'md' }: Props) {
  const origin       = stops.find(s => s.stop_type === 'ORIGIN') ?? null
  const destinations = stops.filter(s => s.stop_type !== 'ORIGIN')

  // Zona (RM/Zona Cero/Región Norte/Región Sur) del local elegido para cada
  // destino — solo para mostrar el badge, no viaja en el payload (ver
  // pickDestinationLocation: lo que sí viaja es destination_region numérico).
  const [zones, setZones] = useState<Record<number, string | null>>({})

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

  // Escribir el nombre a mano (sin elegir una sugerencia) invalida cualquier
  // zona ya resuelta — el texto ya no corresponde necesariamente al local
  // que la generó. Elegir un local real (2026-07-28) reemplaza el picker
  // manual de Región/Ciudad: destination_region pasa a ser el region_number
  // real del local (numérico — antes RegionCityPicker mandaba el nombre de
  // la región de Chile, un string que el trigger de auto-clasificación de
  // Tarifario no entiende, dejando el destino siempre sin clasificar).
  function typeDestinationLocal(index: number, local: string) {
    patchDestination(index, { local, destination_region: null })
    setZones(z => ({ ...z, [index]: null }))
  }

  function pickDestinationLocation(index: number, loc: Location) {
    patchDestination(index, {
      local: loc.name,
      destination_region: loc.region_number != null ? String(loc.region_number) : null,
    })
    setZones(z => ({ ...z, [index]: loc.operation_type }))
  }

  function removeDestination(index: number) {
    let seen = -1
    onChange(stops.filter(s => {
      if (s.stop_type === 'ORIGIN') return true
      seen += 1
      return seen !== index
    }))
    setZones(z => {
      const next: Record<number, string | null> = {}
      for (const [k, v] of Object.entries(z)) {
        const ki = Number(k)
        if (ki < index) next[ki] = v
        else if (ki > index) next[ki - 1] = v
      }
      return next
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Origen</label>
        <LocationPicker
          value={origin?.local ?? ''}
          onChange={setOrigin}
          placeholder="Nombre del origen (CD, planta…)"
          ariaLabel="Origen"
          size={size}
        />
      </div>
      <div className="space-y-2">
        <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Destinos</label>
        {destinations.map((s, i) => (
          <div key={i} className="space-y-1.5 border border-border/60 rounded-lg p-2">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
              <LocationPicker
                value={s.local}
                onChange={local => typeDestinationLocal(i, local)}
                onSelectLocation={loc => pickDestinationLocation(i, loc)}
                placeholder={`Destino ${i + 1} — nombre del local`}
                ariaLabel={`Nombre destino ${i + 1}`}
                size={size}
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
            {zones[i] ? (
              <p className="text-[10px] text-accent bg-accent/5 border border-accent/15 rounded-lg px-2 py-1 inline-block">
                Zona: {ZONE_LABEL[zones[i]!] ?? zones[i]}
              </p>
            ) : (
              <p className="text-[10px] text-gray-400">
                Elegí una sugerencia de la lista para clasificar la zona automáticamente
              </p>
            )}
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
