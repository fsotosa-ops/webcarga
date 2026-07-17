// components/dashboard/DriverRosterCard.tsx
'use client'

import type { CarrierDriverRosterItem } from '@/lib/types'
import { getInitials, getInitialColor } from '@/lib/utils/avatar'
import { formatExpiry } from '@/lib/compliance'

interface Props {
  driver: CarrierDriverRosterItem
  onOpen: () => void
}

/** Tarjeta compacta del roster de conductores — solo lo escaneable
 *  (avatar + nombre + cantidad de requisitos). app.carrier_driver_roster no
 *  desglosa por estado (solo total_requirements agregado), así que no hay
 *  semáforo acá — el detalle por documento vive en DriverDetailPanel,
 *  abierto al hacer click. */
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
        <p className="text-[10px] font-semibold text-gray-400">
          {driver.total_requirements ?? 0} requisito{driver.total_requirements === 1 ? '' : 's'}
          {driver.last_document_update && ` · ${formatExpiry(driver.last_document_update)}`}
        </p>
      </div>
    </button>
  )
}
