'use client'

import type { Trip, TripsMeta } from '@/lib/types'
import { getLatestTemp, getActiveStop, describeStopTiming } from '@/lib/utils/temperature'
import { dwellStatus } from '@/lib/utils/kpis'
import { StopProgressDots } from './StopProgressDots'
import { DwellSeverityBadge } from '@/components/ui/DwellSeverityBadge'
import { TmsChip } from './TripTable'
import { nombreLegible } from '@/lib/utils/nombres'

interface Props {
  trip:               Trip
  meta?:              TripsMeta | null
  onSaved:            (t: Trip) => void
  onSelect:           (t: Trip) => void
  onSelectFocusNotes: (t: Trip) => void
  /** true si el último reporte TMS de este viaje cambió en el refetch más reciente */
  updated?: boolean
}

export function TripCard({ trip, meta, onSaved, onSelect, onSelectFocusNotes, updated }: Props) {
  const temp       = getLatestTemp(trip.stops ?? [])
  const tempStatus = trip.temp_status
  const plate      = trip.tractor_plate ?? trip.trailer_plate ?? null
  const activeStop = getActiveStop(trip.stops ?? [])
  const eta        = activeStop ? describeStopTiming(activeStop) : null
  const dwell      = dwellStatus(trip, meta?.monitor_alert_rules ?? undefined)

  return (
    <div
      onClick={() => onSelect(trip)}
      className={`border rounded-lg p-2.5 mb-2 cursor-pointer transition-all border-border shadow-[0_1px_2px_rgba(16,23,40,0.04)] hover:shadow-[0_2px_8px_rgba(16,23,40,0.08)] hover:-translate-y-px ${
        updated ? 'bg-amber-50' : 'bg-white'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {plate ? (
            <span className="font-identificador text-dato font-semibold tracking-[0.09em] text-text-primary border border-border rounded px-1.5 py-0.5 bg-gray-50/80 shrink-0">
              {plate}
            </span>
          ) : (
            <span className="text-dato text-gray-400 italic shrink-0">sin patente</span>
          )}
          {trip.source_system && <TmsChip tms={trip.source_system} meta={meta} />}
        </div>
        {temp != null && (
          <span className={`text-etiqueta font-semibold tabular-nums px-1.5 py-0.5 rounded shrink-0 ${tempStatus === 'out_of_range' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
            {temp}°C
          </span>
        )}
      </div>
      <p className="text-etiqueta text-gray-500 truncate mt-1.5">
        {trip.driver_name
          ? nombreLegible(trip.driver_name)
          : <span className="italic text-gray-400">sin conductor</span>}
        {trip.client_name && <span className="text-gray-400 capitalize"> · {trip.client_name}</span>}
      </p>
      {/* Solo destinos — StopProgressDots filtra el origen internamente
          (hito 13, mismo lenguaje visual que StopTimeline/StopPills). */}
      {(trip.stops?.some(s => s.stop_type !== 'ORIGIN') ?? false) && (
        <div className="mt-1.5">
          <StopProgressDots stops={trip.stops ?? []} />
        </div>
      )}
      {eta && (
        <p className="text-etiqueta text-gray-400 truncate mt-1">{eta}</p>
      )}
      {/* Indicadores (Activo/Trabajando/Asignado/1ra Vuelta) se ven y
          filtran arriba de la tabla, se editan en el detalle del viaje —
          Fase 3 del hardening del Diario, 2026-07-18. */}
      {dwell && (
        <div className="flex items-center justify-end mt-1.5">
          <DwellSeverityBadge
            severity={dwell.severity}
            label={dwell.label}
            onClick={e => { e.stopPropagation(); onSelectFocusNotes(trip) }}
          />
        </div>
      )}
    </div>
  )
}
