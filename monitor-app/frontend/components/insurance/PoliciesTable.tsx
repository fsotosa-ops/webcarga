'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CABECERA } from '@/components/ui/tabla/EncabezadoOrdenable'
import { StatusChip } from '@/components/ui/StatusChip'
import { EntityCell } from '@/components/dashboard/EntityCell'
import {
  carrierInsuranceStyle, fechaCorta, installmentsSummaryStyle, policyFileStyle, policyStateStyle, type StateStyle,
} from '@/lib/states'
import { carrierHref } from '@/lib/navegacion/directory'
import { policyHref } from '@/lib/navegacion/insurance'
import type { CarrierInsuranceRow, PolicyRow } from '@/lib/api/insurance'

const Chip = ({ s }: { s: StateStyle }) => <StatusChip tone={s.tone} icon={s.icon}>{s.label}</StatusChip>
const vigencia = (r: { valid_from: string | null; valid_to: string | null }) =>
  r.valid_from || r.valid_to ? `${r.valid_from ? fechaCorta(r.valid_from) : '…'} – ${r.valid_to ? fechaCorta(r.valid_to) : '…'}` : '—'

/** La tabla de Pólizas (Seguros E2): por póliza o por empresa. La usan Seguros ›
 *  Pólizas y la pestaña Seguros de la ficha de empresa (`hideCarrier`). La fila
 *  abre la ficha de la póliza; la empresa, su vista rápida. */
export function PoliciesTable({ rows, returnTo, hideCarrier = false }: {
  rows: PolicyRow[]
  returnTo?: string
  hideCarrier?: boolean
}) {
  const router = useRouter()
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-white">
      <table className="w-full text-dato">
        <thead>
          <tr className="border-b border-border bg-bg-main">
            <th scope="col" className={CABECERA}>Póliza</th>
            {!hideCarrier && <th scope="col" className={CABECERA}>Empresa</th>}
            <th scope="col" className={`${CABECERA} w-40`}>Vigencia</th>
            <th scope="col" className={`${CABECERA} w-48`}>Estado</th>
            <th scope="col" className={`${CABECERA} w-36`}>Cuotas</th>
            <th scope="col" className={`${CABECERA} w-28`}>Archivo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const href = policyHref(r.id, returnTo)
            return (
              <tr key={r.id} onClick={() => router.push(href)} className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-bg-main">
                <td className="px-3 py-2.5">
                  <Link href={href} prefetch={false} onClick={e => e.stopPropagation()} className="font-semibold text-text-primary hover:text-accent">
                    {r.insurance_company}{r.policy_number && <span className="font-normal text-informativo"> · {r.policy_number}</span>}
                  </Link>
                </td>
                {!hideCarrier && (
                  <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                    <EntityCell kind="carrier" id={r.carrier_id} label={r.carrier_name} />
                  </td>
                )}
                <td className="px-3 py-2.5 text-etiqueta text-informativo tabular-nums whitespace-nowrap">{vigencia(r)}</td>
                <td className="px-3 py-2.5"><Chip s={policyStateStyle(r)} /></td>
                <td className="px-3 py-2.5">
                  <Chip s={installmentsSummaryStyle({ overdue: r.overdue_installments, unpaid: r.unpaid_installments, total: r.installments_total })} />
                </td>
                <td className="px-3 py-2.5"><Chip s={policyFileStyle(r.has_file)} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Pólizas agrupadas por empresa: aparecen también las activas sin póliza. La
 *  fila abre la ficha de la empresa en su pestaña Seguros. */
export function CarriersInsuranceTable({ rows, returnTo }: { rows: CarrierInsuranceRow[]; returnTo?: string }) {
  const router = useRouter()
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-white">
      <table className="w-full text-dato">
        <thead>
          <tr className="border-b border-border bg-bg-main">
            <th scope="col" className={CABECERA}>Empresa</th>
            <th scope="col" className={`${CABECERA} w-24`}>Pólizas</th>
            <th scope="col" className={`${CABECERA} w-48`}>Estado</th>
            <th scope="col" className={`${CABECERA} w-36`}>Cuotas</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const href = `${carrierHref(r.carrier_id, returnTo)}${returnTo ? '&' : '?'}tab=seguros`
            return (
              <tr key={r.carrier_id} onClick={() => router.push(href)} className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-bg-main">
                <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                  <EntityCell kind="carrier" id={r.carrier_id} label={r.carrier_name} />
                </td>
                <td className="px-3 py-2.5 tabular-nums text-informativo">{r.policies}</td>
                <td className="px-3 py-2.5"><Chip s={carrierInsuranceStyle(r.worst_state)} /></td>
                <td className="px-3 py-2.5">
                  {r.policies === 0 && r.unpaid_installments === 0
                    ? <span className="text-informativo">—</span>
                    : <Chip s={installmentsSummaryStyle({ overdue: r.overdue_installments, unpaid: r.unpaid_installments })} />}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
