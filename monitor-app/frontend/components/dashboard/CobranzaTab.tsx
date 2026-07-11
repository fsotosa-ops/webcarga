'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Check } from 'lucide-react'
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
    return <div className="flex items-center justify-center py-20 text-gray-400 gap-2 text-sm">
      <Loader2 size={16} className="animate-spin" /> Cargando cuotas…
    </div>
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex gap-2 flex-wrap items-center">
        <span className="text-[11px] text-gray-400 mr-1">Agrupar por</span>
        {GROUP_OPTIONS.map(opt => (
          <button
            key={opt.id}
            role="button"
            aria-pressed={groupBy === opt.id}
            onClick={() => setGroupBy(opt.id)}
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all ${
              groupBy === opt.id ? 'bg-accent border-accent text-white' : 'text-gray-500 border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {groups.map(group => {
        const isOverdue = group.key === 'overdue'
        const isCollapsed = collapsed.has(group.key)
        return (
          <div key={group.key} className="space-y-2">
            <button
              onClick={() => toggleCollapsed(group.key)}
              className="w-full flex items-center justify-between px-1"
            >
              <span className={`text-[11px] font-bold uppercase tracking-wide ${isOverdue ? 'text-red-600' : 'text-gray-500'}`}>
                {isCollapsed ? '▸' : ''} {group.label} · {group.rows.length}
              </span>
              <span className={`text-xs font-semibold ${isOverdue ? 'text-red-600' : 'text-gray-500'}`}>
                {group.totalUf.toFixed(1)} UF
              </span>
            </button>
            {!isCollapsed && (
              <div className={`bg-white border rounded-xl overflow-hidden ${isOverdue ? 'border-red-200' : 'border-border'}`}>
                {group.rows.map(row => (
                  <div
                    key={row.installment_id}
                    className="grid items-center px-3.5 py-2.5 border-b border-border/60 last:border-b-0 text-xs"
                    style={{ gridTemplateColumns: '64px 1fr 100px 90px 56px 56px 72px' }}
                  >
                    <span className={`font-semibold ${row.is_overdue ? 'text-red-600' : 'text-gray-600'}`}>
                      {formatExpiry(row.due_date)}
                    </span>
                    <span className="font-semibold text-text-primary truncate">{row.business_name ?? row.rut}</span>
                    <span className="text-gray-400">{row.company}</span>
                    <span className="text-gray-400 font-mono">{row.policy_number}</span>
                    <span className="text-gray-400">{row.installment_number}</span>
                    <span className="font-semibold text-right">{row.amount_uf ?? '—'}</span>
                    {row.status !== 'pagada' && canAdmin && (
                      <button className="justify-self-end flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full border border-border/60 text-gray-500 hover:text-accent hover:border-accent">
                        <Check size={9} /> Pagar
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {groups.length === 0 && (
        <p className="bg-white rounded-xl border border-border px-4 py-14 text-center text-sm text-gray-400">
          Sin cuotas registradas
        </p>
      )}
    </div>
  )
}
