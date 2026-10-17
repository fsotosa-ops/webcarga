'use client'

import { useState } from 'react'
import { User } from 'lucide-react'
import { type CarrierOperationalStatus, type DriverPickCandidate } from '@/lib/types'
import { StatusChip } from '@/components/ui/StatusChip'
import { lifecycleStyle } from '@/lib/states'
import { DriverSearchPicker } from './DriverSearchPicker'
import { Button } from '@/components/ui/Button'
import { inputClass } from '@/components/ui/Field'

export type FleetAssignValue = {
  driver_id:        string | null
  driver_name:      string | null
  driver_rut:       string | null
  driver_phone:     string | null
  carrier_id:       string | null
  carrier_name:     string | null
  /** Solo para avisar en pantalla; la decisión es de la API (D-R10). */
  carrier_operational_status?: CarrierOperationalStatus | null
  tractor_asset_id: string | null
  tractor_plate:    string | null
  trailer_plate:    string | null
}

export const EMPTY_FLEET_ASSIGN_VALUE: FleetAssignValue = {
  driver_id: null, driver_name: null, driver_rut: null, driver_phone: null,
  carrier_id: null, carrier_name: null, carrier_operational_status: null,
  tractor_asset_id: null, tractor_plate: null, trailer_plate: null,
}

interface Props {
  value:           FleetAssignValue
  onChange:        (value: FleetAssignValue) => void
  /** Ej: conductores disponibles hoy (tripsApi.availableDrivers) — mostrado
   *  cuando el campo de búsqueda está vacío, mismo patrón de DriverSearchPicker. */
  suggested?:      DriverPickCandidate[]
  suggestedLabel?: string
  size?:           'sm' | 'md'
  /** Mostrado bajo la búsqueda cuando el operador tipeó ≥2 caracteres y
   *  todavía no eligió un conductor — cada consumidor pasa su propio texto
   *  (ej. TripAssignDialog explica que bloquea la creación del viaje). El
   *  componente no expone su estado de búsqueda interno al padre, así que
   *  esta es la única forma de condicionar contenido según ese estado. */
  notFoundHint?:   React.ReactNode
}

const INPUT = `w-full ${inputClass()}`
const INPUT_SM = `w-full ${inputClass({ size: 'xs' })}`

export function FleetAssignSection({ value, onChange, suggested = [], suggestedLabel, size = 'md', notFoundHint }: Props) {
  const [query, setQuery] = useState('')
  const inputCls = size === 'sm' ? INPUT_SM : INPUT

  function pick(d: DriverPickCandidate) {
    setQuery('')
    // La empresa se autocompleta tal cual: si no puede recibir viajes, lo dice
    // la API con un 409 (D1 §7.1, D-R10). Antes se descartaba acá en silencio y
    // el viaje se creaba sin empresa, que es lo que la guarda viene a impedir.
    onChange({
      driver_id:        d.driver_id,
      driver_name:      d.driver_name,
      driver_rut:       d.driver_rut,
      driver_phone:     d.driver_phone,
      carrier_id:       d.carrier_id,
      carrier_name:     d.carrier_name,
      carrier_operational_status: d.carrier_operational_status ?? null,
      tractor_asset_id: d.tractor_asset_id,
      tractor_plate:    d.tractor_plate,
      trailer_plate:    value.trailer_plate,
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
      <div>
        <DriverSearchPicker
          query={query}
          onQueryChange={setQuery}
          onPick={pick}
          suggested={suggested}
          suggestedLabel={suggestedLabel}
        />
        {notFoundHint && query.trim().length >= 2 && notFoundHint}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-md border border-accent/20 bg-accent/5 px-4 py-3">
        <div className="min-w-0 flex items-center gap-2">
          <User size={14} className="text-accent shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-dato font-semibold text-text-primary">{value.driver_name}</p>
            <p className="font-identificador text-etiqueta text-informativo">{value.driver_rut ?? ''}</p>
          </div>
        </div>
        <Button variant="link" onClick={clear} className="ml-3 shrink-0">
          Cambiar
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-etiqueta font-semibold text-informativo mb-1.5">Empresa de transporte</label>
          <input type="text" value={value.carrier_name ?? ''} onChange={e => patch('carrier_name', e.target.value)} placeholder="Se autocompleta al elegir conductor" aria-label="Empresa de transporte" className={inputCls} />
          {value.carrier_operational_status && value.carrier_operational_status !== 'ACTIVE' && (() => {
            const s = lifecycleStyle('carrier', value.carrier_operational_status)
            return <div className="mt-1"><StatusChip tone={s.tone} icon={s.icon}>{s.label}</StatusChip></div>
          })()}
        </div>
        <div>
          <label className="block text-etiqueta font-semibold text-informativo mb-1.5">Teléfono</label>
          <input type="text" value={value.driver_phone ?? ''} onChange={e => patch('driver_phone', e.target.value)} placeholder="+56912345678" aria-label="Teléfono" className={inputCls} />
        </div>
        <div>
          <label className="block text-etiqueta font-semibold text-informativo mb-1.5">Patente tracto</label>
          <input type="text" value={value.tractor_plate ?? ''} onChange={e => patch('tractor_plate', e.target.value.toUpperCase())} placeholder="BGVS12" aria-label="Patente tracto" className={inputCls + ' uppercase'} />
        </div>
        <div>
          <label className="block text-etiqueta font-semibold text-informativo mb-1.5">Patente rampla</label>
          <input type="text" value={value.trailer_plate ?? ''} onChange={e => patch('trailer_plate', e.target.value.toUpperCase())} placeholder="RMPLA01" aria-label="Patente rampla" className={inputCls + ' uppercase'} />
        </div>
      </div>
      <p className="text-etiqueta text-informativo">
        Autocompletado editable desde la asignación activa del conductor — corrige aquí si ese día manejó otro equipo.
      </p>
    </div>
  )
}
