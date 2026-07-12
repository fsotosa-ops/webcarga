'use client'

import { AlertTriangle } from 'lucide-react'
import type { BlockingReason } from '@/lib/types'
import { describeBlockingReason } from '@/lib/utils/eligibility'

interface Props {
  eligible:        boolean
  blockingReasons: BlockingReason[]
  compliancePct:   number | null
}

/** Motivo concreto de bloqueo, siempre visible — reemplaza el ícono con
 *  tooltip que antes enterraba el motivo. */
export function TransporterAlertBanner({ eligible, blockingReasons, compliancePct }: Props) {
  if (eligible || blockingReasons.length === 0) return null

  return (
    <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2.5">
      <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
      <div>
        <p className="text-xs font-bold text-red-700 mb-1">No habilitada para asignar</p>
        <ul className="space-y-0.5">
          {blockingReasons.map(reason => (
            <li key={reason} className="text-xs text-red-600">
              {describeBlockingReason(reason, compliancePct)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
