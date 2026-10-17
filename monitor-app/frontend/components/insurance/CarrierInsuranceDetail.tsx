import Link from 'next/link'
import type { CarrierInsuranceDetail as Detail } from '@/lib/api/insurance'
import { fechaCorta, formatUf, installmentStateStyle, policyStateStyle } from '@/lib/states'
import { policyHref } from '@/lib/navegacion/insurance'
import { StatusChip } from '@/components/ui/StatusChip'
import { Button } from '@/components/ui/Button'

/** El seguro de una empresa: una tarjeta por póliza no cancelada con sus cuotas impagas
 *  (Seguros por empresa, 17/10). Una sola pieza: la usan el panel de Seguros › Empresas y
 *  la pestaña Seguros de la ficha de empresa. Pinta lo que manda la API, sin recalcular. */
export function CarrierInsuranceDetail({ detail, canEdit, onAddPolicy, returnTo }: {
  detail: Detail
  canEdit: boolean
  /** "Registrar póliza" (solo con `policies.edit`). */
  onAddPolicy?: () => void
  /** A dónde vuelve la ficha de la póliza. */
  returnTo?: string
}) {
  if (detail.policies.length === 0) {
    return (
      <div className="space-y-2 rounded-md border border-border bg-white p-4 text-center">
        <p className="text-dato text-informativo">Sin pólizas registradas</p>
        {canEdit && onAddPolicy && <Button variant="primary" size="sm" onClick={onAddPolicy}>Registrar póliza</Button>}
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {detail.policies.map(p => {
        const titulo = `${p.insurance_company} · Póliza ${p.policy_number ?? 'sin número'}`
        const estado = policyStateStyle(p)
        const impagas = p.installments.filter(i => i.installment_state !== 'PAID')
        const pagadas = p.installments.length - impagas.length
        return (
          <article key={p.id} aria-label={titulo} className="rounded-md border border-border bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-dato font-semibold text-text-primary">{titulo}</h3>
              <StatusChip tone={estado.tone} icon={estado.icon}>{estado.label}</StatusChip>
            </div>
            <p className="mt-0.5 text-etiqueta text-informativo">
              {p.valid_from && p.valid_to ? `Vigencia ${fechaCorta(p.valid_from)} – ${fechaCorta(p.valid_to)}` : 'Sin fechas de vigencia'}
            </p>
            {impagas.length > 0 && (
              <ul className="mt-2 divide-y divide-border/60 border-t border-border">
                {impagas.map(i => {
                  const s = installmentStateStyle(i)
                  return (
                    <li key={i.id} className="flex items-center justify-between gap-2 py-1.5 text-dato text-text-primary">
                      <span>
                        Cuota {i.installment_number} de {i.installments_total}
                        {i.amount_uf != null && <span className="text-informativo"> · {formatUf(i.amount_uf)}</span>}
                      </span>
                      <StatusChip tone={s.tone} icon={s.icon}>{s.label}</StatusChip>
                    </li>
                  )
                })}
              </ul>
            )}
            <div className="mt-2 flex items-center justify-between text-etiqueta text-informativo">
              <span>{pagadas === 1 ? '1 pagada' : `${pagadas} pagadas`}</span>
              <Link href={policyHref(p.id, returnTo)} prefetch={false} className="font-semibold text-accion hover:underline">
                Abrir la póliza
              </Link>
            </div>
          </article>
        )
      })}
    </div>
  )
}
