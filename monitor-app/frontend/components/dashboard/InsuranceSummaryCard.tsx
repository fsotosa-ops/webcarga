'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react'
import { insuranceApi } from '@/lib/api/insurance'
import { formatExpiry } from '@/lib/compliance'

interface Props {
  transporterId: string
  rut:           string | null
}

/** Card compacta de Seguros en la ficha de empresa — plan §4.2.
 *  Próxima cuota + cuotas vencidas + % pagado, con link al módulo Seguros. */
export function InsuranceSummaryCard({ transporterId, rut }: Props) {
  const { data, isPending, error } = useQuery({
    queryKey: ['insurance', 'transporter', transporterId],
    queryFn: () => insuranceApi.getForTransporter(transporterId),
  })

  const policies = data?.policies ?? []
  const allInstallments = policies.flatMap(p => p.installments ?? [])
  const overdueCount = allInstallments.filter(
    i => i.status === 'vencida' || (i.status === 'pendiente' && i.due_date != null && i.due_date < new Date().toISOString().slice(0, 10)),
  ).length
  const paidCount = allInstallments.filter(i => i.status === 'pagada').length
  const paidPct = allInstallments.length > 0 ? Math.round((100 * paidCount) / allInstallments.length) : null
  const nextDue = allInstallments
    .filter(i => i.status === 'pendiente' && i.due_date && i.due_date >= new Date().toISOString().slice(0, 10))
    .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))[0]

  return (
    <div className="bg-white rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Seguros</h3>
        <Link
          href={rut ? `/dashboard/seguros?rut=${encodeURIComponent(rut)}` : '/dashboard/seguros'}
          className="text-[11px] text-accent hover:underline flex items-center gap-1"
        >
          Ver en Seguros <ArrowRight size={11} />
        </Link>
      </div>

      {isPending ? (
        <p className="text-xs text-gray-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Cargando…</p>
      ) : error ? (
        <p className="text-xs text-red-500">{error instanceof Error ? error.message : 'Error cargando seguros'}</p>
      ) : policies.length === 0 ? (
        <p className="text-xs text-gray-400 italic">Sin información de pólizas</p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {overdueCount > 0 ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-600">
                <ShieldAlert size={9} /> {overdueCount} cuota{overdueCount > 1 ? 's' : ''} vencida{overdueCount > 1 ? 's' : ''}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-100">
                <ShieldCheck size={9} /> Sin cuotas vencidas
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <p className="text-[10px] text-gray-400">Próxima cuota</p>
              {nextDue ? (
                <p className="font-mono text-gray-700">
                  {formatExpiry(nextDue.due_date)} {nextDue.amount_uf != null && `· ${nextDue.amount_uf} UF`}
                </p>
              ) : <p className="text-gray-300">—</p>}
            </div>
            <div>
              <p className="text-[10px] text-gray-400">% pagado</p>
              <p className="font-mono text-gray-700">{paidPct != null ? `${paidPct}%` : '—'}</p>
            </div>
          </div>
          <p className="text-[10px] text-gray-400">{policies.length} póliza{policies.length > 1 ? 's' : ''}</p>
        </div>
      )}
    </div>
  )
}
