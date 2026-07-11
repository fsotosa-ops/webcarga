'use client'

import { forwardRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown, Check, Circle, AlertTriangle, Loader2,
  ExternalLink, ShieldQuestion, ShieldCheck, ShieldAlert,
} from 'lucide-react'
import { insuranceApi } from '@/lib/api/insurance'
import type { InsuranceInstallment, InsurancePolicy, InsuranceSummaryRow } from '@/lib/types'
import { formatExpiry } from '@/lib/compliance'
import { DocumentChecklist } from './DocumentChecklist'

const TODAY = () => new Date().toISOString().slice(0, 10)

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

/** Barra de pago gruesa y visible — distinta de la ComplianceProgressBar
 *  compartida (usada en Empresas) para no arrastrar cambios a ese módulo. */
function PaidProgressBar({ pct }: { pct: number | null }) {
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

/** true si una cuota "pendiente" ya pasó su fecha de vencimiento — misma
 *  regla usada en InsuranceSummaryCard (ficha de empresa). */
function isEffectivelyOverdue(inst: InsuranceInstallment): boolean {
  return inst.status === 'vencida' || (inst.status === 'pendiente' && !!inst.due_date && inst.due_date < TODAY())
}

// ── Nodo de cuota en el timeline horizontal ────────────────────────────────

function TimelineNode({
  installment, canAdmin, onPaid,
}: {
  installment: InsuranceInstallment
  canAdmin:    boolean
  onPaid:      (updated: InsuranceInstallment) => void
}) {
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState<string | null>(null)
  const overdue = isEffectivelyOverdue(installment)
  const paid = installment.status === 'pagada'

  const nodeCls = paid
    ? 'bg-green-500 border-green-500 text-white'
    : overdue
      ? 'bg-red-500 border-red-500 text-white'
      : 'bg-white border-amber-400 text-amber-500'

  async function markPaid() {
    setSaving(true); setErr(null)
    try {
      const updated = await insuranceApi.patchInstallment(installment.id, {
        status: 'pagada',
        paid_at: TODAY(),
        expected_updated_at: installment.updated_at ?? undefined,
      })
      onPaid(updated)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al marcar como pagada')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-1.5 w-24 shrink-0">
      <div
        title={paid ? 'Pagada' : overdue ? 'Vencida' : 'Pendiente'}
        className={`w-10 h-10 rounded-full border-2 flex items-center justify-center font-bold shrink-0 transition-transform hover:scale-105 ${nodeCls}`}
      >
        {paid ? <Check size={16} /> : overdue ? <AlertTriangle size={15} /> : <Circle size={15} />}
      </div>
      <span className="text-[11px] font-semibold text-gray-400 text-center leading-tight">#{installment.installment_number}</span>
      <span className="text-xs font-semibold text-gray-600 text-center leading-tight">{formatExpiry(installment.due_date)}</span>
      <span className="text-[11px] text-gray-500 text-center leading-tight">
        {installment.amount_uf != null ? `${installment.amount_uf} UF` : '—'}
      </span>
      {!paid && (
        <button
          type="button"
          onClick={markPaid}
          disabled={!canAdmin || saving}
          title={!canAdmin ? 'Solo un administrador puede marcar cuotas como pagadas' : undefined}
          className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full border border-border/60 text-gray-500 hover:text-accent hover:border-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
        >
          {saving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
          Pagar
        </button>
      )}
      {err && <span className="text-[10px] text-red-500 text-center leading-tight">{err}</span>}
    </div>
  )
}

// ── Sección de una póliza: header + timeline + acciones ────────────────────

function PolicySection({
  policy, canAdmin, canEdit, onChanged,
}: {
  policy:    InsurancePolicy
  canAdmin:  boolean
  canEdit:   boolean
  onChanged: (updated: InsurancePolicy) => void
}) {
  const queryClient = useQueryClient()
  const [docUploadErr, setDocUploadErr] = useState<string | null>(null)
  const docsQuery = useQuery({
    queryKey: ['insurance', 'policy-documents', policy.id],
    queryFn: () => insuranceApi.listPolicyDocuments(policy.id),
  })

  async function handleDocUpload(docCode: string, file: File) {
    try {
      await insuranceApi.uploadDocumentFile(policy.id, docCode, file)
      setDocUploadErr(null)
      queryClient.invalidateQueries({ queryKey: ['insurance', 'policy-documents', policy.id] })
    } catch (e) {
      setDocUploadErr(e instanceof Error ? e.message : 'Error al subir el documento')
    }
  }

  const installments = policy.installments ?? []

  return (
    <div className="border border-border rounded-2xl p-5 space-y-5 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[15px] font-bold text-text-primary">{policy.company}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Póliza {policy.policy_number}{policy.endorsement ? ` · Endoso ${policy.endorsement}` : ''}
            {policy.plate ? ` · ${policy.plate}` : ''}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Vigencia <span className="font-semibold text-gray-700">{formatExpiry(policy.valid_from)} – {formatExpiry(policy.valid_to)}</span>
          </p>
        </div>
        {policy.policy_type && (
          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 shrink-0">
            {policy.policy_type}
          </span>
        )}
      </div>

      {/* Timeline horizontal de cuotas */}
      <div>
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2.5">Cuotas</p>
        {installments.length === 0 ? (
          <p className="text-xs text-gray-300 italic">Sin cuotas registradas</p>
        ) : (
          <div className="flex items-start gap-3 overflow-x-auto pb-1">
            {installments.map(inst => (
              <TimelineNode
                key={inst.id}
                installment={inst}
                canAdmin={canAdmin}
                onPaid={updated => onChanged({
                  ...policy,
                  installments: installments.map(i => i.id === updated.id ? updated : i),
                })}
              />
            ))}
          </div>
        )}
      </div>

      <div className="pt-1 border-t border-border/60">
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2.5 mt-3">Documentos</p>
        {docsQuery.isPending ? (
          <p className="text-xs text-gray-400">Cargando documentos…</p>
        ) : (
          <DocumentChecklist
            items={docsQuery.data ?? []}
            canEdit={canEdit}
            onUpload={handleDocUpload}
          />
        )}
        {docUploadErr && <p className="text-xs text-red-500 mt-2">{docUploadErr}</p>}
      </div>

      {policy.payment_url && (
        <a href={policy.payment_url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline">
          <ExternalLink size={12} /> Link de pago
        </a>
      )}
    </div>
  )
}

// ── Card principal: colapsada (rollup) + expandida (pólizas + timeline) ────

interface Props {
  row:       InsuranceSummaryRow
  expanded:  boolean
  onToggle:  () => void
  canAdmin:  boolean
  canEdit:   boolean
}

export const InsuranceCompanyCard = forwardRef<HTMLDivElement, Props>(function InsuranceCompanyCard(
  { row, expanded, onToggle, canAdmin, canEdit }, ref,
) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['insurance', 'transporter', row.transporter_id],
    queryFn: () => insuranceApi.getForTransporter(row.transporter_id!),
    enabled: expanded && !!row.transporter_id,
  })

  function handlePolicyChanged(updated: InsurancePolicy) {
    queryClient.setQueryData(
      ['insurance', 'transporter', row.transporter_id],
      (old: { rut: string; transporter_id: string; policies: InsurancePolicy[] } | undefined) =>
        old ? { ...old, policies: old.policies.map(p => p.id === updated.id ? updated : p) } : old,
    )
  }

  const statusBadge = row.overdue_count > 0
    ? { cls: 'bg-red-100 text-red-600', icon: <ShieldAlert size={11} />, label: `${row.overdue_count} vencida${row.overdue_count > 1 ? 's' : ''}`, avatarCls: 'bg-red-100 text-red-600' }
    : row.policies_count === 0
      ? { cls: 'bg-gray-100 text-gray-500', icon: <ShieldQuestion size={11} />, label: 'Sin información', avatarCls: 'bg-gray-100 text-gray-400' }
      : { cls: 'bg-green-50 text-green-700 border border-green-100', icon: <ShieldCheck size={11} />, label: 'Al día', avatarCls: 'bg-green-50 text-green-600' }

  const displayName = row.business_name ?? row.rut

  return (
    <div ref={ref} className="bg-white rounded-2xl border border-border overflow-hidden hover:shadow-md hover:border-gray-300 transition-all">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-gray-50/60 transition-colors"
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
        <ChevronDown size={18} className={`text-gray-400 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="border-t border-border px-5 py-4 space-y-4 bg-gray-50/50">
          {!row.transporter_id ? (
            <p className="text-sm text-gray-400 flex items-center gap-2">
              <ShieldQuestion size={16} /> Esta empresa no tiene ficha vinculada en Empresas — no es posible mostrar el detalle de pólizas.
            </p>
          ) : query.isPending ? (
            <p className="text-sm text-gray-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Cargando pólizas…</p>
          ) : query.error ? (
            <p className="text-sm text-red-500">{query.error instanceof Error ? query.error.message : 'Error cargando pólizas'}</p>
          ) : (query.data?.policies.length ?? 0) === 0 ? (
            <p className="text-sm text-gray-400 italic">Sin pólizas registradas</p>
          ) : (
            query.data!.policies.map(p => (
              <PolicySection key={p.id} policy={p} canAdmin={canAdmin} canEdit={canEdit} onChanged={handlePolicyChanged} />
            ))
          )}
        </div>
      )}
    </div>
  )
})
