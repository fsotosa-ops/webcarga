'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CABECERA } from '@/components/ui/tabla/EncabezadoOrdenable'
import { StatusChip } from '@/components/ui/StatusChip'
import { EntityCell } from '@/components/dashboard/EntityCell'
import {
  fechaCorta, installmentsSummaryStyle, policyFileStyle, policyStateStyle, type StateStyle,
} from '@/lib/states'
import { policyHref } from '@/lib/navegacion/insurance'
import type { PolicyRow } from '@/lib/api/insurance'
import { useOpenCarrierInsurance } from './CarrierInsurancePanel'

const Chip = ({ s }: { s: StateStyle }) => <StatusChip tone={s.tone} icon={s.icon}>{s.label}</StatusChip>
const vigencia = (r: { valid_from: string | null; valid_to: string | null }) =>
  r.valid_from || r.valid_to ? `${r.valid_from ? fechaCorta(r.valid_from) : '…'} – ${r.valid_to ? fechaCorta(r.valid_to) : '…'}` : '—'

/** La tabla de Seguros › Pólizas (Seguros E2), una fila por póliza. La fila abre la
 *  ficha de la póliza; el nombre de la empresa, su panel de Seguros (17/10). */
export function PoliciesTable({ rows, returnTo }: { rows: PolicyRow[]; returnTo?: string }) {
  const router = useRouter()
  const openInsurance = useOpenCarrierInsurance()
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-white">
      <table className="w-full text-dato">
        <thead>
          <tr className="border-b border-border bg-bg-main">
            <th scope="col" className={CABECERA}>Póliza</th>
            <th scope="col" className={CABECERA}>Empresa</th>
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
                <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                  <EntityCell kind="carrier" id={r.carrier_id} label={r.carrier_name} onOpen={openInsurance} />
                </td>
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
