'use client'

import { useQuery } from '@tanstack/react-query'
import { Loader2, ShieldAlert, ShieldCheck } from 'lucide-react'
import { carriersApi } from '@/lib/api/carriers'
import { formatExpiry } from '@/lib/compliance'

interface Props {
  carrierId: string
}

/** Card compacta de Seguros en la ficha de empresa — plan §4.2. Próxima
 *  cuota + cuotas vencidas + % pagado, agregando app.carrier_insurance_status
 *  (ya viene pre-agregado por póliza, sin date-math client-side). Sin link a
 *  un módulo Seguros separado: Seguros vive anidado en esta misma ficha. */
export function InsuranceSummaryCard({ carrierId }: Props) {
  const { data, isPending, error } = useQuery({
    queryKey: ['carrier-policies', carrierId],
    queryFn: () => carriersApi.listPolicies(carrierId),
  })

  const policies = data ?? []
  const overdueCount = policies.reduce((sum, p) => sum + p.overdue_installments, 0)
  const totalInstallments = policies.reduce((sum, p) => sum + p.total_installments, 0)
  const paidInstallments = policies.reduce((sum, p) => sum + p.paid_installments, 0)
  const paidPct = totalInstallments > 0 ? Math.round((100 * paidInstallments) / totalInstallments) : null
  const nextDue = policies
    .map(p => p.next_payment_date)
    .filter((d): d is string => d != null)
    .sort((a, b) => (a < b ? -1 : 1))[0]

  return (
    <div className="bg-white rounded-xl border border-border p-4 space-y-3">
      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Seguros</h3>

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
                <p className="font-mono text-gray-700">{formatExpiry(nextDue)}</p>
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
