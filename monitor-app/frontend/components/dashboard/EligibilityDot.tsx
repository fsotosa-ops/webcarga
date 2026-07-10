'use client'

import type { BlockingReason } from '@/lib/types'
import { eligibilityColor, describeEligibility } from '@/lib/utils/eligibility'

interface Props {
  eligible:         boolean | null
  blockingReasons?: BlockingReason[]
  compliancePct?:   number | null
  size?:            'sm' | 'md'
}

const COLOR_CLS: Record<string, string> = {
  green: 'bg-green-500',
  amber: 'bg-amber-400',
  red:   'bg-red-500',
}

/** Semáforo de habilitación (verde/ámbar/rojo) con tooltip legible de
 *  blocking_reasons — reusado en el listado y en la ficha detalle. */
export function EligibilityDot({ eligible, blockingReasons = [], compliancePct, size = 'md' }: Props) {
  const color = eligibilityColor(eligible, blockingReasons)
  const tooltip = describeEligibility(eligible, blockingReasons, compliancePct)
  const dim = size === 'sm' ? 'w-2 h-2' : 'w-2.5 h-2.5'
  return (
    <span
      role="img"
      aria-label={tooltip}
      title={tooltip}
      className={`inline-block rounded-full shrink-0 ${dim} ${COLOR_CLS[color]}`}
    />
  )
}
