'use client'

import { forwardRef } from 'react'
import { ChevronRight, ShieldQuestion, ShieldCheck, ShieldAlert } from 'lucide-react'
import type { InsuranceSummaryRow } from '@/lib/types'
import { formatExpiry } from '@/lib/compliance'

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

/** Barra de pago gruesa y visible — distinta de la ComplianceProgressBar
 *  compartida (usada en Empresas) para no arrastrar cambios a ese módulo. */
export function PaidProgressBar({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-xs text-gray-300">Sin cuotas</span>
  const cls = pct >= 90 ? 'bg-green-500' : pct >= 60 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${cls}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      <span className="text-xs font-bold text-text-primary tabular-nums w-9 text-right">{pct.toFixed(0)}%</span>
    </div>
  )
}

// ── Fila de una empresa: resumen colapsado que abre el detalle en slide-over ─

interface Props {
  row:      InsuranceSummaryRow
  active:   boolean
  onOpen:   () => void
}

export const InsuranceCompanyCard = forwardRef<HTMLDivElement, Props>(function InsuranceCompanyCard(
  { row, active, onOpen }, ref,
) {
  const statusBadge = row.overdue_count > 0
    ? { cls: 'bg-red-100 text-red-600', icon: <ShieldAlert size={11} />, label: `${row.overdue_count} vencida${row.overdue_count > 1 ? 's' : ''}`, avatarCls: 'bg-red-100 text-red-600' }
    : row.policies_count === 0
      ? { cls: 'bg-gray-100 text-gray-500', icon: <ShieldQuestion size={11} />, label: 'Sin información', avatarCls: 'bg-gray-100 text-gray-400' }
      : { cls: 'bg-green-50 text-green-700 border border-green-100', icon: <ShieldCheck size={11} />, label: 'Al día', avatarCls: 'bg-green-50 text-green-600' }

  const displayName = row.business_name ?? row.rut

  return (
    <div ref={ref}>
      <button
        type="button"
        onClick={onOpen}
        aria-current={active}
        className={`w-full bg-white rounded-2xl border flex items-center gap-4 px-5 py-4 text-left transition-all ${
          active ? 'border-accent ring-2 ring-accent/10' : 'border-border hover:border-gray-300 hover:shadow-md'
        }`}
      >
        <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 text-sm font-bold ${statusBadge.avatarCls}`}>
          {initialsOf(displayName)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold text-[15px] text-text-primary truncate leading-tight">
              {row.business_name ?? <span className="italic text-gray-400 font-normal">{row.rut}</span>}
            </p>
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${statusBadge.cls}`}>
              {statusBadge.icon} {statusBadge.label}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">{row.rut}</p>
        </div>
        <div className="hidden sm:block w-36 shrink-0">
          <p className="text-[11px] text-gray-400">Próxima cuota</p>
          {row.next_due ? (
            <p className="text-[13px] font-semibold text-gray-700">
              {formatExpiry(row.next_due.date)}{row.next_due.amount_uf != null && ` · ${row.next_due.amount_uf} UF`}
            </p>
          ) : <p className="text-[13px] text-gray-300">—</p>}
        </div>
        <div className="hidden md:block w-32 shrink-0">
          <PaidProgressBar pct={row.paid_pct} />
        </div>
        <ChevronRight size={18} className="text-gray-400 shrink-0" />
      </button>
    </div>
  )
})
