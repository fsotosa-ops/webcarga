// components/dashboard/VehicleRosterCard.tsx
'use client'

import { Truck } from 'lucide-react'
import type { TransporterVehicle } from '@/lib/types'
import { vehicleRosterStatus, vehicleCategory, VEHICLE_CATEGORY_LABELS } from '@/lib/utils/transporterDocs'

const TONE_CLS: Record<'ok' | 'warn' | 'danger', string> = {
  ok:     'text-green-600',
  warn:   'text-amber-600',
  danger: 'text-red-600',
}

interface Props {
  vehicle: TransporterVehicle
  onOpen:  () => void
}

/** Tarjeta compacta del roster de equipos — patente + categoría + estado
 *  resumen. El detalle completo vive en VehicleDetailPanel. */
export function VehicleRosterCard({ vehicle, onOpen }: Props) {
  const status = vehicleRosterStatus(vehicle)
  const category = vehicleCategory(vehicle.type)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center gap-2.5 border border-border rounded-xl px-3 py-2.5 text-left hover:border-gray-300 hover:shadow-sm transition-all bg-white"
    >
      <div className="w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 text-slate-500 shrink-0">
        <Truck size={14} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-xs font-bold text-text-primary font-mono truncate">{vehicle.plate}</p>
          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 shrink-0">
            {VEHICLE_CATEGORY_LABELS[category]}
          </span>
        </div>
        <p className={`text-[10px] font-semibold ${TONE_CLS[status.tone]}`}>{status.label}</p>
      </div>
    </button>
  )
}
