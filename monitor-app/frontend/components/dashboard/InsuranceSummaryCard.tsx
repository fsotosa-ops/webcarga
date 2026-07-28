'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react'
import { carriersApi } from '@/lib/api/carriers'
import { formatExpiry } from '@/lib/compliance'

interface Props {
  carrierId: string
  taxId:     string
}

/** Card compacta de Seguros en la ficha de empresa — plan §4.2. Próxima
 *  cuota + cuotas vencidas + % pagado, agregando app.carrier_insurance_status
 *  (ya viene pre-agregado por póliza, sin date-math client-side). Clickeable:
 *  navega a la landing /dashboard/insurance pre-filtrada por tax_id (deep link
 *  vía ?q=), la "landing sincronizada con Empresas" del rediseño H3 —
 *  reemplaza la nota vieja de "sin link a un módulo Seguros separado" de
 *  cuando ese módulo todavía no existía. */
export function InsuranceSummaryCard({ carrierId, taxId }: Props) {
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
    <Link
      href={`/dashboard/insurance?q=${encodeURIComponent(taxId)}`}
      className="block bg-white rounded-xl border border-border p-4 space-y-3 text-left hover:border-gray-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Seguros</h3>
        <ArrowRight size={13} className="text-gray-300" />
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
    </Link>
  )
}
