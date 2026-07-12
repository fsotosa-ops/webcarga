'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Loader2, ShieldQuestion, ShieldCheck, ShieldAlert, ChevronDown, ChevronUp } from 'lucide-react'
import { insuranceApi } from '@/lib/api/insurance'
import type { InsuranceInstallment, InsurancePolicy, InsuranceSummaryRow, InsuranceTransporterResponse } from '@/lib/types'
import { formatExpiry } from '@/lib/compliance'
import { DocumentChecklist } from './DocumentChecklist'
import { InstallmentRow } from './InstallmentRow'
import { initialsOf } from './InsuranceCompanyCard'

const TODAY = () => new Date().toISOString().slice(0, 10)

function isEffectivelyOverdue(inst: InsuranceInstallment): boolean {
  return inst.status === 'vencida' || (inst.status === 'pendiente' && !!inst.due_date && inst.due_date < TODAY())
}

/** La cuota a destacar: la vencida más antigua si hay alguna, si no la
 *  pendiente que vence antes. null si todas las cuotas están pagadas. */
function nextActionable(installments: InsuranceInstallment[]): InsuranceInstallment | null {
  const unpaid = installments.filter(i => i.status !== 'pagada')
  if (unpaid.length === 0) return null
  const overdue = unpaid.filter(isEffectivelyOverdue)
  const pool = overdue.length > 0 ? overdue : unpaid
  return pool.slice().sort((a, b) => (a.due_date ?? '9999-99-99').localeCompare(b.due_date ?? '9999-99-99'))[0]
}

interface Props {
  row:      InsuranceSummaryRow | null
  onClose:  () => void
  canAdmin: boolean
  canEdit:  boolean
}

/** Modal inmersivo de 2 columnas: lista de pólizas (si hay más de una) +
 *  detalle de la póliza seleccionada (próxima cuota destacada, resto
 *  colapsado detrás de "Ver todas", documentos). Reemplaza el slide-over
 *  angosto anterior (scroll horizontal que se cortaba en el borde). */
export function InsurancePolicyModal({ row, onClose, canAdmin, canEdit }: Props) {
  const open = !!row
  const queryClient = useQueryClient()
  const panelRef = useRef<HTMLDivElement>(null)
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [docUploadErr, setDocUploadErr] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['insurance', 'transporter', row?.transporter_id],
    queryFn: () => insuranceApi.getForTransporter(row!.transporter_id!),
    enabled: open && !!row?.transporter_id,
  })

  const policies = query.data?.policies ?? []

  useEffect(() => {
    if (policies.length === 0) { setSelectedPolicyId(null); return }
    if (!selectedPolicyId || !policies.some(p => p.id === selectedPolicyId)) {
      setSelectedPolicyId(policies[0].id)
    }
  }, [policies, selectedPolicyId])

  // Única fuente de verdad para colapsar "ver todas las cuotas": se dispara
  // ante CUALQUIER cambio de póliza seleccionada, ya sea por click directo
  // en el switcher o por el auto-select de arriba al abrir/reabrir el modal.
  useEffect(() => {
    setShowAll(false)
  }, [selectedPolicyId])

  const docsQuery = useQuery({
    queryKey: ['insurance', 'policy-documents', selectedPolicyId],
    queryFn: () => insuranceApi.listPolicyDocuments(selectedPolicyId!),
    enabled: open && !!selectedPolicyId,
  })

  // Semántica de diálogo: Escape cierra, Tab atrapado, foco inicial y retorno
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

  function handleInstallmentChanged(policyId: string, updated: InsuranceInstallment) {
    queryClient.setQueryData(
      ['insurance', 'transporter', row?.transporter_id],
      (old: InsuranceTransporterResponse | undefined) =>
        old ? {
          ...old,
          policies: old.policies.map(p => p.id === policyId
            ? { ...p, installments: (p.installments ?? []).map(i => i.id === updated.id ? updated : i) }
            : p),
        } : old,
    )
  }

  async function handleDocUpload(docCode: string, file: File) {
    if (!selectedPolicyId) return
    try {
      await insuranceApi.uploadDocumentFile(selectedPolicyId, docCode, file)
      setDocUploadErr(null)
      queryClient.invalidateQueries({ queryKey: ['insurance', 'policy-documents', selectedPolicyId] })
    } catch (e) {
      setDocUploadErr(e instanceof Error ? e.message : 'Error al subir el documento')
    }
  }

  if (!open || !row) return null

  const displayName = row.business_name ?? row.rut
  const selectedPolicy = policies.find(p => p.id === selectedPolicyId) ?? null
  const installments = selectedPolicy?.installments ?? []
  const spotlight = nextActionable(installments)
  const sortedInstallments = installments.slice().sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))

  const statusBadge = row.overdue_count > 0
    ? { cls: 'bg-red-50 text-red-600', icon: <ShieldAlert size={11} />, label: `${row.overdue_count} vencida${row.overdue_count > 1 ? 's' : ''}` }
    : row.policies_count === 0
      ? { cls: 'bg-gray-100 text-gray-500', icon: <ShieldQuestion size={11} />, label: 'Sin información' }
      : { cls: 'bg-green-50 text-green-600', icon: <ShieldCheck size={11} />, label: 'Al día' }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={`Pólizas de ${displayName}`}
          tabIndex={-1}
          className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col sm:flex-row focus:outline-none"
        >
          <button onClick={onClose} aria-label="Cerrar detalle de pólizas" className="absolute top-4 right-4 z-10 text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>

          {policies.length > 1 && (
            <div className="sm:w-[34%] shrink-0 bg-gray-50 border-b sm:border-b-0 sm:border-r border-border overflow-y-auto p-4">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-9 h-9 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-xs font-bold shrink-0">
                  {initialsOf(displayName)}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-text-primary truncate">{displayName}</p>
                  <p className="text-[10px] text-gray-400">{row.rut}</p>
                </div>
              </div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Pólizas ({policies.length})</p>
              <div className="flex sm:flex-col gap-2 overflow-x-auto sm:overflow-visible">
                {policies.map(p => {
                  const active = p.id === selectedPolicyId
                  const overdueCount = (p.installments ?? []).filter(isEffectivelyOverdue).length
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedPolicyId(p.id)}
                      className={`text-left px-3 py-2 rounded-lg shrink-0 transition-colors ${
                        active ? 'bg-white shadow-sm border-l-2 border-accent' : 'hover:bg-white/60'
                      }`}
                    >
                      <p className={`text-xs font-bold ${active ? 'text-text-primary' : 'text-gray-500'}`}>{p.company}</p>
                      <p className={`text-[10px] ${overdueCount > 0 ? 'text-red-500 font-semibold' : 'text-green-600'}`}>
                        {overdueCount > 0 ? `${overdueCount} vencida${overdueCount > 1 ? 's' : ''}` : 'al día'}
                      </p>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="flex-1 min-w-0 overflow-y-auto p-5 sm:p-6">
            {!row.transporter_id ? (
              <p className="text-sm text-gray-400 flex items-center gap-2 pt-2">
                <ShieldQuestion size={16} /> Esta empresa no tiene ficha vinculada en Empresas — no es posible mostrar el detalle de pólizas.
              </p>
            ) : query.isPending ? (
              <p className="text-sm text-gray-400 flex items-center gap-2 pt-2"><Loader2 size={14} className="animate-spin" /> Cargando pólizas…</p>
            ) : query.error ? (
              <p className="text-sm text-red-500 pt-2">{query.error instanceof Error ? query.error.message : 'Error cargando pólizas'}</p>
            ) : policies.length === 0 ? (
              <p className="text-sm text-gray-400 italic pt-2">Sin pólizas registradas</p>
            ) : !selectedPolicy ? null : (
              <>
                {policies.length === 1 && (
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className="w-9 h-9 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-xs font-bold shrink-0">
                      {initialsOf(displayName)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-text-primary truncate">{displayName}</p>
                      <p className="text-[10px] text-gray-400">{row.rut}</p>
                    </div>
                    <span className={`ml-auto inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${statusBadge.cls}`}>
                      {statusBadge.icon} {statusBadge.label}
                    </span>
                  </div>
                )}

                <div className="flex items-start justify-between gap-3 mb-5 pr-6">
                  <div>
                    <p className="text-[15px] font-bold text-text-primary">{selectedPolicy.company}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Póliza {selectedPolicy.policy_number}
                      {selectedPolicy.endorsement ? ` · Endoso ${selectedPolicy.endorsement}` : ''}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      Vigencia <span className="font-semibold text-gray-700">{formatExpiry(selectedPolicy.valid_from)} – {formatExpiry(selectedPolicy.valid_to)}</span>
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xl font-bold text-accent leading-none">
                      {installments.length === 0 ? '—' : `${Math.round(100 * installments.filter(i => i.status === 'pagada').length / installments.length)}%`}
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1">cuotas pagadas</p>
                  </div>
                </div>

                {spotlight && (
                  <div className="mb-2">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Próxima cuota</p>
                    <InstallmentRow
                      installment={spotlight}
                      canAdmin={canAdmin}
                      onChanged={updated => handleInstallmentChanged(selectedPolicy.id, updated)}
                    />
                  </div>
                )}

                {installments.length > 0 && (
                  <button
                    onClick={() => setShowAll(v => !v)}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 mb-5 mt-1"
                  >
                    {showAll ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    Ver todas las cuotas ({installments.length})
                  </button>
                )}

                {showAll && (
                  <div className="flex flex-col gap-1.5 mb-6">
                    {sortedInstallments.map(inst => (
                      <div key={inst.id} className={spotlight?.id === inst.id ? 'ring-2 ring-accent/30 rounded-lg' : ''}>
                        <InstallmentRow
                          installment={inst}
                          canAdmin={canAdmin}
                          onChanged={updated => handleInstallmentChanged(selectedPolicy.id, updated)}
                        />
                      </div>
                    ))}
                  </div>
                )}

                <div className="pt-4 border-t border-border/60">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Documentos</p>
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
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
