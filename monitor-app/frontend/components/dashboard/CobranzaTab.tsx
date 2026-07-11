'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Check, ChevronRight, AlertTriangle, Receipt } from 'lucide-react'
import { insuranceApi } from '@/lib/api/insurance'
import { groupInstallments, type GroupBy } from '@/lib/utils/insuranceGrouping'
import { formatExpiry } from '@/lib/compliance'

const GROUP_OPTIONS: { id: GroupBy; label: string }[] = [
  { id: 'week',         label: 'Semana' },
  { id: 'month',        label: 'Mes' },
  { id: 'quarter',       label: 'Trimestre' },
  { id: 'transporter',  label: 'Empresa' },
  { id: 'company',      label: 'Aseguradora' },
  { id: 'client_group', label: 'Cliente GC' },
]

const TODAY = () => new Date().toISOString().slice(0, 10)

/** "vence en 3 días" / "vencida hace 4 días" / "vence hoy" — a diferencia de
 *  formatRelativeTime (lib/utils/datetime.ts), este opera sobre fechas
 *  YYYY-MM-DD sin hora, y es bidireccional (pasado y futuro). */
function dueRelative(dueDate: string | null, isOverdue: boolean): string | null {
  if (!dueDate) return null
  const diffDays = Math.round((new Date(dueDate + 'T00:00:00').getTime() - new Date(TODAY() + 'T00:00:00').getTime()) / 86400000)
  if (diffDays === 0) return 'vence hoy'
  if (diffDays > 0) return `vence en ${diffDays} día${diffDays === 1 ? '' : 's'}`
  return isOverdue ? `vencida hace ${Math.abs(diffDays)} día${Math.abs(diffDays) === 1 ? '' : 's'}` : null
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

interface Props {
  canAdmin: boolean
}

export function CobranzaTab({ canAdmin }: Props) {
  const [groupBy, setGroupBy] = useState<GroupBy>('week')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const query = useQuery({
    queryKey: ['insurance', 'installments-flat'],
    queryFn: () => insuranceApi.installmentsFlat(),
  })

  const groups = useMemo(() => groupInstallments(query.data ?? [], groupBy), [query.data, groupBy])

  function toggleCollapsed(key: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (query.isPending) {
    return <div className="flex items-center justify-center py-24 text-gray-400 gap-2 text-sm">
      <Loader2 size={18} className="animate-spin" /> Cargando cuotas…
    </div>
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl">
      <div className="inline-flex items-center gap-1 bg-gray-100/80 rounded-xl p-1">
        {GROUP_OPTIONS.map(opt => (
          <button
            key={opt.id}
            aria-pressed={groupBy === opt.id}
            onClick={() => setGroupBy(opt.id)}
            className={`px-3.5 py-1.5 text-[13px] font-semibold rounded-lg transition-all ${
              groupBy === opt.id
                ? 'bg-white text-text-primary shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="space-y-5">
        {groups.map(group => {
          const isOverdue = group.key === 'overdue'
          const isCollapsed = collapsed.has(group.key)
          return (
            <div
              key={group.key}
              className={`rounded-2xl overflow-hidden border transition-shadow ${
                isOverdue ? 'border-red-200 bg-red-50/40 shadow-sm shadow-red-100' : 'border-border bg-white'
              }`}
            >
              <button
                onClick={() => toggleCollapsed(group.key)}
                className={`w-full flex items-center justify-between gap-3 px-5 py-4 text-left transition-colors ${
                  isOverdue ? 'hover:bg-red-50' : 'hover:bg-gray-50/70'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                    isOverdue ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {isOverdue ? <AlertTriangle size={16} /> : <Receipt size={16} />}
                  </div>
                  <div className="min-w-0">
                    <p className={`text-[15px] font-bold truncate ${isOverdue ? 'text-red-700' : 'text-text-primary'}`}>
                      {group.label}
                    </p>
                    <p className="text-xs text-gray-400">{group.rows.length} cuota{group.rows.length === 1 ? '' : 's'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`text-lg font-bold tabular-nums ${isOverdue ? 'text-red-600' : 'text-text-primary'}`}>
                    {group.totalUf.toFixed(1)} <span className="text-xs font-semibold text-gray-400">UF</span>
                  </span>
                  <ChevronRight size={16} className={`text-gray-400 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} />
                </div>
              </button>

              {!isCollapsed && (
                <div className={`divide-y ${isOverdue ? 'divide-red-100 border-t border-red-100' : 'divide-border/60 border-t border-border'}`}>
                  {group.rows.map(row => {
                    const relative = dueRelative(row.due_date, row.is_overdue)
                    const name = row.business_name ?? row.rut
                    return (
                      <div
                        key={row.installment_id}
                        className="flex items-center gap-4 px-5 py-3.5 hover:bg-black/[0.02] transition-colors"
                      >
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                          row.is_overdue ? 'bg-red-100 text-red-600' : 'bg-accent/10 text-accent'
                        }`}>
                          {initialsOf(name)}
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="text-[14px] font-semibold text-text-primary truncate">{name}</p>
                          <p className="text-xs text-gray-400 truncate">
                            {row.company} · Póliza {row.policy_number} · cuota {row.installment_number}
                          </p>
                        </div>

                        <div className="hidden sm:block text-right shrink-0 w-32">
                          <p className={`text-[13px] font-semibold tabular-nums ${row.is_overdue ? 'text-red-600' : 'text-gray-600'}`}>
                            {formatExpiry(row.due_date)}
                          </p>
                          {relative && (
                            <p className={`text-[11px] ${row.is_overdue ? 'text-red-500' : 'text-gray-400'}`}>{relative}</p>
                          )}
                        </div>

                        <p className="text-[15px] font-bold text-text-primary tabular-nums shrink-0 w-20 text-right">
                          {row.amount_uf != null ? row.amount_uf.toFixed(1) : '—'}
                          <span className="text-[11px] font-semibold text-gray-400 ml-1">UF</span>
                        </p>

                        {row.status !== 'pagada' && canAdmin && (
                          <button
                            disabled
                            title="Marcar como pagada desde Cobranza — próximamente"
                            className="shrink-0 flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border border-border text-gray-500 hover:text-accent hover:border-accent disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-500 disabled:hover:border-border transition-colors"
                          >
                            <Check size={12} /> Pagar
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        {groups.length === 0 && (
          <p className="bg-white rounded-2xl border border-border px-4 py-16 text-center text-sm text-gray-400">
            Sin cuotas registradas
          </p>
        )}
      </div>
    </div>
  )
}
