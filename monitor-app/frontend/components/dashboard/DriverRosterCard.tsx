// components/dashboard/DriverRosterCard.tsx
'use client'

import type { TransporterDriver } from '@/lib/types'
import { getInitials, getInitialColor } from '@/lib/utils/avatar'
import { driverRosterStatus } from '@/lib/utils/transporterDocs'

const TONE_CLS: Record<'ok' | 'warn' | 'danger', string> = {
  ok:     'text-green-600',
  warn:   'text-amber-600',
  danger: 'text-red-600',
}

interface Props {
  driver: TransporterDriver
  onOpen: () => void
}

/** Tarjeta compacta del roster de conductores — solo lo escaneable
 *  (avatar + nombre + un estado resumen). El detalle completo vive en
 *  DriverDetailPanel, abierto al hacer click. */
export function DriverRosterCard({ driver, onOpen }: Props) {
  const status = driverRosterStatus(driver)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center gap-2.5 border border-border rounded-xl px-3 py-2.5 text-left hover:border-gray-300 hover:shadow-sm transition-all bg-white"
    >
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
        style={{ backgroundColor: getInitialColor(driver.name) }}
      >
        {getInitials(driver.name)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-text-primary truncate">{driver.name}</p>
        <p className={`text-[10px] font-semibold ${TONE_CLS[status.tone]}`}>{status.label}</p>
      </div>
    </button>
  )
}
