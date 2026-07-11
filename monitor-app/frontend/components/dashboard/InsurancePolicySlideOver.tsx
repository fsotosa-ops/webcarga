'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  X, Check, Circle, AlertTriangle, Loader2, ExternalLink,
  ShieldQuestion, ShieldCheck, ShieldAlert,
} from 'lucide-react'
import { insuranceApi } from '@/lib/api/insurance'
import type { InsuranceInstallment, InsurancePolicy, InsuranceSummaryRow } from '@/lib/types'
import { formatExpiry } from '@/lib/compliance'
import { DocumentChecklist } from './DocumentChecklist'
import { initialsOf, PaidProgressBar } from './InsuranceCompanyCard'

const TODAY = () => new Date().toISOString().slice(0, 10)

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

// ── Sección de una póliza: header + timeline + documentos ───────────────────

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
    <div className="border border-border rounded-2xl p-5 space-y-5 bg-white">
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

// ── Panel lateral: detalle completo de la empresa (pólizas + cuotas + docs) ──

interface Props {
  row:      InsuranceSummaryRow | null
  onClose:  () => void
  canAdmin: boolean
  canEdit:  boolean
}

export function InsurancePolicySlideOver({ row, onClose, canAdmin, canEdit }: Props) {
  const open = !!row
  const panelRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['insurance', 'transporter', row?.transporter_id],
    queryFn: () => insuranceApi.getForTransporter(row!.transporter_id!),
    enabled: open && !!row?.transporter_id,
  })

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    panelRef.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'Tab' && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        if (!focusables.length) return
        const first = focusables[0]
        const last  = focusables[focusables.length - 1]
        const active = document.activeElement
        if (e.shiftKey && (active === first || active === panelRef.current)) {
          e.preventDefault(); last.focus()
        } else if (!e.shiftKey && active === last) {
          e.preventDefault(); first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.()
    }
  }, [open, onClose])

  function handlePolicyChanged(updated: InsurancePolicy) {
    queryClient.setQueryData(
      ['insurance', 'transporter', row?.transporter_id],
      (old: { rut: string; transporter_id: string; policies: InsurancePolicy[] } | undefined) =>
        old ? { ...old, policies: old.policies.map(p => p.id === updated.id ? updated : p) } : old,
    )
  }

  const statusBadge = row && row.overdue_count > 0
    ? { cls: 'bg-red-500/20 text-red-200', icon: <ShieldAlert size={11} />, label: `${row.overdue_count} vencida${row.overdue_count > 1 ? 's' : ''}` }
    : row && row.policies_count === 0
      ? { cls: 'bg-white/10 text-white/60', icon: <ShieldQuestion size={11} />, label: 'Sin información' }
      : { cls: 'bg-green-500/20 text-green-200', icon: <ShieldCheck size={11} />, label: 'Al día' }

  const displayName = row ? (row.business_name ?? row.rut) : ''

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/50 z-40 animate-backdrop-in" onClick={onClose} aria-hidden="true" />
      )}

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={row ? `Pólizas de ${displayName}` : 'Pólizas'}
        tabIndex={-1}
        className={`fixed inset-y-0 right-0 z-50 w-full sm:w-[560px] bg-gray-50/80 border-l border-border shadow-2xl flex flex-col transition-transform duration-300 focus:outline-none ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {row && (
          <>
            <div className="px-5 py-4 bg-slate-900 flex items-start justify-between gap-3 shrink-0">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center shrink-0 text-sm font-bold text-white">
                  {initialsOf(displayName)}
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-white truncate">{displayName}</h3>
                  <p className="text-[11px] text-white/50 font-mono">{row.rut}</p>
                  <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full mt-1.5 ${statusBadge.cls}`}>
                    {statusBadge.icon} {statusBadge.label}
                  </span>
                </div>
              </div>
              <button onClick={onClose} aria-label="Cerrar detalle de pólizas" className="text-white/50 hover:text-white transition-colors shrink-0">
                <X size={18} />
              </button>
            </div>

            <div className="px-5 py-3 bg-white border-b border-border shrink-0">
              <p className="text-[11px] text-gray-400 mb-1">Cuotas pagadas</p>
              <PaidProgressBar pct={row.paid_pct} />
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
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
          </>
        )}
      </div>
    </>
  )
}
