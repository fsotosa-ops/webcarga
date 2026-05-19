'use client'

import { AlertTriangle, Clock } from 'lucide-react'
import type { AlertStatus } from '@/lib/types'

interface Props {
  status:   AlertStatus | null
  tooltip?: string
  compact?: boolean
}

export function ComplianceBadge({ status, tooltip, compact = false }: Props) {
  if (!status || status === 'ok') return null
  const expired = status === 'expired'

  if (compact) {
    return (
      <span
        title={tooltip}
        className={`inline-block w-2 h-2 rounded-full shrink-0 ${
          expired ? 'bg-red-500' : 'bg-amber-400'
        }`}
      />
    )
  }

  return (
    <span
      title={tooltip}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${
        expired ? 'bg-red-100 text-red-600' : 'bg-amber-50 text-amber-600'
      }`}
    >
      {expired ? <AlertTriangle size={9} /> : <Clock size={9} />}
      {expired ? 'Vencido' : 'Vence pronto'}
    </span>
  )
}
