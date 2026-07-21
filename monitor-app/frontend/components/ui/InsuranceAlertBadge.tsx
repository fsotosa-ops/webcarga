'use client'

import { ShieldAlert, Clock } from 'lucide-react'
import type { Trip } from '@/lib/types'

/** HU-12 (Fase 2, 2026-07-22): alerta prominente en el Diario cuando el
 *  transportista resuelto de un viaje tiene póliza vencida o cuotas
 *  críticas impagas — pedido explícito de Pablo. Fuente: trip.insurance_alert
 *  (ver LATERAL join sobre app.carrier_insurance_status en trips.py). */

type InsuranceAlert = NonNullable<Trip['insurance_alert']>

const LABEL: Record<InsuranceAlert, string> = {
  EXPIRED: 'Póliza vencida',
  OVERDUE_INSTALLMENTS: 'Cuotas impagas',
  EXPIRING_SOON: 'Póliza por vencer',
}

interface Props {
  alert:    InsuranceAlert | null | undefined
  compact?: boolean
}

export function InsuranceAlertBadge({ alert, compact = false }: Props) {
  if (!alert) return null
  const critical = alert === 'EXPIRED' || alert === 'OVERDUE_INSTALLMENTS'

  if (compact) {
    return (
      <span
        title={LABEL[alert]}
        className={`inline-block w-2 h-2 rounded-full shrink-0 ${critical ? 'bg-red-500' : 'bg-amber-400'}`}
      />
    )
  }

  return (
    <span
      title={LABEL[alert]}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${
        critical ? 'bg-red-100 text-red-600' : 'bg-amber-50 text-amber-600'
      }`}
    >
      {critical ? <ShieldAlert size={9} /> : <Clock size={9} />}
      {LABEL[alert]}
    </span>
  )
}
