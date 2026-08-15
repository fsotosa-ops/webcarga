// components/dashboard/VehicleRosterCard.tsx
'use client'

import { Truck, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { CarrierAssetRosterItem } from '@/lib/types'

const ASSET_TYPE_LABELS: Record<string, string> = {
  TRACTOCAMION: 'Tracto', RAMPLA: 'Rampla',
}

interface Props {
  vehicle: CarrierAssetRosterItem
  onOpen:  () => void
}

/** Tarjeta compacta del roster de equipos — patente + tipo + pill de
 *  compliance_health (mismo criterio y componente visual que TransporterCard
 *  en el listado de Empresas) — reemplaza el conteo plano "N requisitos".
 *  El detalle por documento vive en VehicleDetailPanel. */
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
          {vehicle.fleet_service_type_label && (
            <span
              className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0"
              style={{
                backgroundColor: vehicle.fleet_service_type_bg_color ?? undefined,
                color: vehicle.fleet_service_type_text_color ?? undefined,
              }}
            >
              {vehicle.fleet_service_type_label}
            </span>
          )}
        </div>
        {vehicle.compliance_health === 'PENDING' ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 mt-0.5">
            <ShieldAlert size={9} /> {vehicle.pending_mandatory} pendiente{vehicle.pending_mandatory === 1 ? '' : 's'}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-50 text-green-700 mt-0.5">
            <ShieldCheck size={9} /> Al día
          </span>
        )}
      </div>
    </button>
  )
}
