'use client'

import { ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-react'

interface Props {
  insuranceOk:    boolean | null
  /** Cuando se conoce (ficha detalle / rollup), 0 pólizas siempre es "Sin información" */
  policiesCount?: number | null
}

/** Badge Al día / Vencido / Sin información — plan §4.1. `insurance_ok` es
 *  null (o policiesCount === 0) cuando la empresa no tiene pólizas cargadas,
 *  lo que es un dato ausente, no un incumplimiento. */
export function InsuranceStatusBadge({ insuranceOk, policiesCount }: Props) {
  if (policiesCount === 0 || insuranceOk == null) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
        <ShieldQuestion size={9} /> Sin información
      </span>
    )
  }
  if (insuranceOk) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-100">
        <ShieldCheck size={9} /> Al día
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-600">
      <ShieldAlert size={9} /> Vencido
    </span>
  )
}
