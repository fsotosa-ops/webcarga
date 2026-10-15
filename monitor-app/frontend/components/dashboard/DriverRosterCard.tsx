// components/dashboard/DriverRosterCard.tsx
'use client'

import { StatusChip } from '@/components/ui/StatusChip'
import { fleetMemberStyle, isCarrierDeactivated, summaryStyle } from '@/lib/states'
import type { CarrierDriverRosterItem, CarrierOperationalStatus } from '@/lib/types'
import { getInitials, getInitialColor } from '@/lib/utils/avatar'

interface Props {
  driver: CarrierDriverRosterItem
  /** Estado de la empresa: si está dada de baja, la tarjeta lo dice (bloque 0, 0.9). */
  carrierStatus?: CarrierOperationalStatus
  onOpen: () => void
}

/** Tarjeta compacta del roster de conductores: avatar, nombre y el par de
 *  chips de la spec §6.2 (D-R8): el ciclo de vida (lo decide una persona) y el
 *  peor estado de sus documentos (`compliance_summary`, lo calcula la API).
 *  El par va completo, sin reemplazar uno por otro: dado de baja, el documental
 *  se ve en gris, no en verde ni en rojo. El detalle por documento vive en
 *  ficha (FleetProfile en modal), abierta al hacer click. */
export function DriverRosterCard({ driver, carrierStatus, onOpen }: Props) {
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
        <div className="mt-0.5 flex flex-wrap gap-1">
          {(() => {
            const life = fleetMemberStyle('driver', driver.operational_status, carrierStatus)
            const docs = summaryStyle(driver.compliance_summary,
              driver.operational_status === 'ACTIVE' && !isCarrierDeactivated(carrierStatus))
            return (<>
              <StatusChip tone={life.tone} icon={life.icon}>{life.label}</StatusChip>
              <StatusChip tone={docs.tone} icon={docs.icon}>{docs.label}</StatusChip>
            </>)
          })()}
        </div>
      </div>
    </button>
  )
}
