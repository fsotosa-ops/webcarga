// components/dashboard/DriverRosterCard.tsx
'use client'

import { ShieldAlert, ShieldCheck } from 'lucide-react'
import type { CarrierDriverRosterItem } from '@/lib/types'
import { getInitials, getInitialColor } from '@/lib/utils/avatar'

interface Props {
  driver: CarrierDriverRosterItem
  onOpen: () => void
}

/** Tarjeta compacta del roster de conductores — avatar + nombre + pill de
 *  compliance_health (documentación LEGAL_MANDATORY pendiente/vencida,
 *  mismo criterio y componente visual que TransporterCard en el listado de
 *  Empresas) — reemplaza el conteo plano "N requisitos" que no distinguía
 *  cuáles conductores necesitan atención. El detalle por documento vive en
 *  DriverDetailPanel, abierto al hacer click. */
export function DriverRosterCard({ driver, onOpen }: Props) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center gap-2.5 border border-border rounded-xl px-3 py-2.5 text-left hover:border-gray-300 hover:shadow-sm transition-all bg-white"
    >
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
        style={{ backgroundColor: getInitialColor(driver.full_name) }}
      >
        {getInitials(driver.full_name)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-text-primary truncate">{driver.full_name}</p>
        {driver.compliance_health === 'PENDING' ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 mt-0.5">
            <ShieldAlert size={9} /> {driver.pending_mandatory} pendiente{driver.pending_mandatory === 1 ? '' : 's'}
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
