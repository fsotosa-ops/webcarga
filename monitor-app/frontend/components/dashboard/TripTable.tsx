'use client'

import type { Trip } from '@/lib/types'
import { ChevronRight } from 'lucide-react'

const STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  'ASIGNADO':              { bg: '#e8eeff', text: '#053bfa' },
  'ORIGEN':                { bg: '#f3e8ff', text: '#8a00dd' },
  'RUTA':                  { bg: '#eef6e6', text: '#62a420' },
  'EN LOCAL':              { bg: '#fef0e6', text: '#ea6b25' },
  'RETORNANDO':            { bg: '#e6f8fd', text: '#0e8db5' },
  'RETORNADO CD':          { bg: '#f3f4f6', text: '#6b7280' },
  'VIAJE EN PREDIO':       { bg: '#f3f4f6', text: '#6b7280' },
  'CANCELADO':             { bg: '#fee2e2', text: '#b00020' },
  'CERRADO FINALIZADO':    { bg: '#f3f4f6', text: '#9ca3af' },
  'CERRADO INCOMPLETO':    { bg: '#fef3c7', text: '#d97706' },
  'CERRADO MANUAL':        { bg: '#f3f4f6', text: '#9ca3af' },
  'CERRADO SIN GPS':       { bg: '#f3f4f6', text: '#9ca3af' },
  'CERRADO POR OTRO VIAJE': { bg: '#f3f4f6', text: '#9ca3af' },
  'CERRADO FINALIZADO CC':  { bg: '#f3f4f6', text: '#9ca3af' },
  'DEVUELTO':               { bg: '#fee2e2', text: '#b00020' },
}

function StatusBadge({ status }: { status: string | null }) {
  const s = status ?? ''
  const colors = STATUS_COLOR[s]
  return (
    <span
      className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap"
      style={colors
        ? { backgroundColor: colors.bg, color: colors.text }
        : { backgroundColor: '#f3f4f6', color: '#9ca3af' }}
    >
      {s || '—'}
    </span>
  )
}

interface Props {
  trips:      Trip[]
  selectedId: string | null
  onSelect:   (trip: Trip) => void
}

export function TripTable({ trips, selectedId, onSelect }: Props) {
  if (trips.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-border p-12 text-center text-sm text-gray-400">
        Sin viajes para los filtros seleccionados
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden overflow-x-auto">
      <table className="w-full text-sm min-w-[640px]">
        <thead>
          <tr className="bg-gray-50 border-b border-border text-xs font-semibold text-gray-500 uppercase tracking-wide">
            <th className="px-4 py-3 text-left">Fecha</th>
            <th className="px-4 py-3 text-left">Tracto · Rampla</th>
            <th className="px-4 py-3 text-left">Conductor</th>
            <th className="px-4 py-3 text-left">EETT</th>
            <th className="px-4 py-3 text-left">Origen</th>
            <th className="px-4 py-3 text-left">Estado</th>
            <th className="px-3 py-3 text-center w-8"></th>
          </tr>
        </thead>
        <tbody>
          {trips.map((trip, i) => {
            const isActive = trip.id === selectedId
            return (
              <tr
                key={trip.id}
                onClick={() => onSelect(trip)}
                className={`border-b border-border/60 last:border-0 cursor-pointer transition-colors ${
                  isActive
                    ? 'bg-accent/5 border-l-2 border-l-accent'
                    : i % 2 === 1
                    ? 'bg-gray-50/40 hover:bg-gray-50'
                    : 'hover:bg-gray-50/70'
                }`}
              >
                <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                  {trip.planning_date
                    ? new Date(trip.planning_date + 'T12:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: '2-digit' })
                    : '—'}
                </td>
                <td className="px-4 py-3">
                  <div className="font-mono text-xs font-medium text-text-primary">
                    {trip.tractor_plate ?? '—'}
                  </div>
                  {trip.trailer_plate && (
                    <div className="font-mono text-[10px] text-gray-400">{trip.trailer_plate}</div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="text-sm text-text-primary">{trip.driver_name ?? '—'}</div>
                  {trip.driver_rut && (
                    <div className="text-[10px] text-gray-400 font-mono">{trip.driver_rut}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-gray-600 max-w-[140px] truncate">
                  {trip.transporter ?? '—'}
                </td>
                <td className="px-4 py-3 text-xs text-gray-500 max-w-[120px] truncate">
                  {trip.origin ?? '—'}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={trip.estado_manual ?? trip.current_status} />
                </td>
                <td className="px-3 py-3 text-center">
                  <ChevronRight size={14} className={`transition-colors ${isActive ? 'text-accent' : 'text-gray-300'}`} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
