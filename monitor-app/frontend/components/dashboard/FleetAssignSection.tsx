'use client'

import { useState } from 'react'
import { User } from 'lucide-react'
import type { DriverPickCandidate } from '@/lib/types'
import { DriverSearchPicker } from './DriverSearchPicker'

export type FleetAssignValue = {
  driver_id:        string | null
  driver_name:      string | null
  driver_rut:       string | null
  driver_phone:     string | null
  carrier_id:       string | null
  carrier_name:     string | null
  tractor_asset_id: string | null
  tractor_plate:    string | null
  trailer_plate:    string | null
}

export const EMPTY_FLEET_ASSIGN_VALUE: FleetAssignValue = {
  driver_id: null, driver_name: null, driver_rut: null, driver_phone: null,
  carrier_id: null, carrier_name: null, tractor_asset_id: null, tractor_plate: null,
  trailer_plate: null,
}

interface Props {
  value:           FleetAssignValue
  onChange:        (value: FleetAssignValue) => void
  /** Ej: conductores disponibles hoy (tripsApi.availableDrivers) — mostrado
   *  cuando el campo de búsqueda está vacío, mismo patrón de DriverSearchPicker. */
  suggested?:      DriverPickCandidate[]
  suggestedLabel?: string
  size?:           'sm' | 'md'
}

const INPUT = "w-full text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all placeholder:text-gray-300"
const INPUT_SM = "w-full text-xs border border-border rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all placeholder:text-gray-300"

export function FleetAssignSection({ value, onChange, suggested = [], suggestedLabel, size = 'md' }: Props) {
  const [query, setQuery] = useState('')
  const inputCls = size === 'sm' ? INPUT_SM : INPUT

  function pick(d: DriverPickCandidate) {
    setQuery('')
    onChange({
      driver_id:        d.driver_id,
      driver_name:       d.driver_name,
      driver_rut:        d.driver_rut,
      driver_phone:      d.driver_phone,
      carrier_id:        d.carrier_id,
      carrier_name:      d.carrier_name,
      tractor_asset_id:  d.tractor_asset_id,
      tractor_plate:     d.tractor_plate,
      trailer_plate:     value.trailer_plate,
    })
  }

  function clear() {
    onChange(EMPTY_FLEET_ASSIGN_VALUE)
  }

  function patch(field: keyof FleetAssignValue, v: string) {
    onChange({ ...value, [field]: v || null })
  }

  if (!value.driver_id) {
    return (
      <DriverSearchPicker
        query={query}
        onQueryChange={setQuery}
        onPick={pick}
        suggested={suggested}
        suggestedLabel={suggestedLabel}
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between bg-accent/5 border border-accent/20 rounded-xl px-4 py-3">
        <div className="min-w-0 flex items-center gap-2">
          <User size={14} className="text-accent shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800 truncate">{value.driver_name}</p>
            <p className="text-[10px] text-gray-400 font-mono">{value.driver_rut ?? ''}</p>
          </div>
        </div>
        <button type="button" onClick={clear} className="text-xs text-gray-400 hover:text-red-400 transition-colors shrink-0 ml-3">
          Cambiar
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Empresa de transporte</label>
          <input type="text" value={value.carrier_name ?? ''} onChange={e => patch('carrier_name', e.target.value)} placeholder="Se autocompleta al elegir conductor" aria-label="Empresa de transporte" className={inputCls} />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Teléfono</label>
          <input type="text" value={value.driver_phone ?? ''} onChange={e => patch('driver_phone', e.target.value)} placeholder="+56912345678" aria-label="Teléfono" className={inputCls} />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Patente tracto</label>
          <input type="text" value={value.tractor_plate ?? ''} onChange={e => patch('tractor_plate', e.target.value.toUpperCase())} placeholder="BGVS12" aria-label="Patente tracto" className={inputCls + ' uppercase'} />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Patente rampla</label>
          <input type="text" value={value.trailer_plate ?? ''} onChange={e => patch('trailer_plate', e.target.value.toUpperCase())} placeholder="RMPLA01" aria-label="Patente rampla" className={inputCls + ' uppercase'} />
        </div>
      </div>
      <p className="text-[10px] text-gray-400">
        Autocompletado editable desde la asignación activa del conductor — corregí acá si ese día manejó otro equipo.
      </p>
    </div>
  )
}
