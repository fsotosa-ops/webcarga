// components/dashboard/VehicleRosterCard.tsx
'use client'

import { Truck } from 'lucide-react'
import type { CarrierAssetRosterItem } from '@/lib/types'
import { formatExpiry } from '@/lib/compliance'

const ASSET_TYPE_LABELS: Record<string, string> = {
  TRACTOCAMION: 'Tracto', RAMPLA: 'Rampla', CAMION: 'Camión', FURGON: 'Furgón', OTRO: 'Otro',
}

interface Props {
  vehicle: CarrierAssetRosterItem
  onOpen:  () => void
}

/** Tarjeta compacta del roster de equipos — patente + tipo + cantidad de
 *  requisitos. app.carrier_asset_roster no desglosa por estado (solo
 *  total_requirements agregado), así que no hay semáforo acá — el detalle
 *  por documento vive en VehicleDetailPanel. */
export function VehicleRosterCard({ vehicle, onOpen }: Props) {
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
          <p className="text-xs font-bold text-text-primary font-mono truncate">{vehicle.license_plate}</p>
          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 shrink-0">
            {ASSET_TYPE_LABELS[vehicle.asset_type] ?? vehicle.asset_type}
          </span>
        </div>
        <p className="text-[10px] font-semibold text-gray-400">
          {vehicle.total_requirements ?? 0} requisito{vehicle.total_requirements === 1 ? '' : 's'}
          {vehicle.last_document_update && ` · ${formatExpiry(vehicle.last_document_update)}`}
        </p>
      </div>
    </button>
  )
}
