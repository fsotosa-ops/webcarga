'use client'

import type { Trip, TripsMeta } from '@/lib/types'
import { getLatestTemp, getActiveStop, describeStopTiming } from '@/lib/utils/temperature'
import { dwellStatus } from '@/lib/utils/kpis'
import { StopProgressDots } from './StopProgressDots'
import { DwellSeverityBadge } from '@/components/ui/DwellSeverityBadge'
import { TmsChip } from './TripTable'

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
      className={`border rounded-lg p-2.5 mb-2 cursor-pointer hover:shadow-sm transition-all border-border ${
        updated ? 'bg-amber-50' : 'bg-white'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`font-mono text-xs font-bold shrink-0 ${plate ? 'text-slate-800' : 'text-gray-300 italic font-normal'}`}>
            {plate ?? 'sin patente'}
          </span>
          {trip.source_system && <TmsChip tms={trip.source_system} meta={meta} />}
        </div>
        {temp != null && (
          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${tempStatus === 'out_of_range' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
            {temp}°C
          </span>
        )}
      </div>
      <p className="text-[11px] text-gray-500 truncate mt-0.5">
        {trip.driver_name ?? <span className="italic text-gray-300">sin conductor</span>}
        {trip.client_name && <span className="text-gray-300"> · {trip.client_name}</span>}
      </p>
      {/* Solo destinos — StopProgressDots filtra el origen internamente
          (hito 13, mismo lenguaje visual que StopTimeline/StopPills). */}
      {(trip.stops?.some(s => s.stop_type !== 'ORIGIN') ?? false) && (
        <div className="mt-1.5">
          <StopProgressDots stops={trip.stops ?? []} />
        </div>
      )}
      {eta && (
        <p className="text-[9px] text-gray-400 truncate mt-1">{eta}</p>
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
