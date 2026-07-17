'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Check, Loader2, ShieldQuestion, ShieldCheck, ShieldAlert, ChevronDown, ChevronUp, Plus } from 'lucide-react'
import { carriersApi } from '@/lib/api/carriers'
import { policiesApi, coverageTypesApi } from '@/lib/api/policies'
import type { CoverageType, InsuranceInstallment, InsurancePolicy, PolicyHealth } from '@/lib/types'
import { formatExpiry } from '@/lib/compliance'
import { InstallmentRow } from './InstallmentRow'

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

const TODAY = () => new Date().toISOString().slice(0, 10)

function isEffectivelyOverdue(inst: InsuranceInstallment): boolean {
  return inst.payment_status === 'OVERDUE' || (inst.payment_status === 'PENDING' && !!inst.due_date && inst.due_date < TODAY())
}

/** La cuota a destacar: la vencida más antigua si hay alguna, si no la
 *  pendiente que vence antes. null si todas las cuotas están pagadas. */
function nextActionable(installments: InsuranceInstallment[]): InsuranceInstallment | null {
  const unpaid = installments.filter(i => i.payment_status !== 'PAID')
  if (unpaid.length === 0) return null
  const overdue = unpaid.filter(isEffectivelyOverdue)
  const pool = overdue.length > 0 ? overdue : unpaid
  return pool.slice().sort((a, b) => (a.due_date ?? '9999-99-99').localeCompare(b.due_date ?? '9999-99-99'))[0]
}

const HEALTH_BADGE: Record<PolicyHealth, { cls: string; icon: React.ReactNode; label: string }> = {
  VALID:          { cls: 'bg-green-50 text-green-600', icon: <ShieldCheck size={11} />, label: 'Al día' },
  EXPIRING_SOON:  { cls: 'bg-amber-50 text-amber-600', icon: <ShieldAlert size={11} />, label: 'Vence pronto' },
  EXPIRED:        { cls: 'bg-red-50 text-red-600',     icon: <ShieldAlert size={11} />, label: 'Vencida' },
  CANCELLED:      { cls: 'bg-gray-100 text-gray-500',  icon: <ShieldQuestion size={11} />, label: 'Cancelada' },
}

interface Props {
  carrierId: string | null
  displayName: string
  /** Póliza a preseleccionar al abrir (ej. se clickeó una fila específica
   *  en la sección Pólizas de la ficha) — si no matchea ninguna de la lista,
   *  cae al comportamiento normal (primera póliza). */
  initialPolicyId?: string | null
  onClose:  () => void
  canAdmin: boolean
  canEdit:  boolean
}

/** Modal inmersivo de 2 columnas: lista de pólizas de la empresa (si hay más
 *  de una) + detalle de la seleccionada (próxima cuota destacada, resto
 *  colapsado, coberturas/activos M:N). A diferencia del modelo viejo, no hay
 *  un checklist de "documentos" por póliza (public.insurance_policies no es
 *  parte del motor de compliance polimórfico) — solo dos archivos posibles
 *  (documento de la póliza + endoso opcional), subidos vía POST .../file. */
export function InsurancePolicyModal({ carrierId, displayName, initialPolicyId, onClose, canAdmin, canEdit }: Props) {
  const open = !!carrierId
  const queryClient = useQueryClient()
  const panelRef = useRef<HTMLDivElement>(null)
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [fileErr, setFileErr] = useState<string | null>(null)

  const listQuery = useQuery({
    queryKey: ['carrier-policies', carrierId],
    queryFn: () => carriersApi.listPolicies(carrierId!),
    enabled: open,
  })
  const policies = listQuery.data ?? []

  const assetsQuery = useQuery({
    queryKey: ['carrier-assets', carrierId],
    queryFn: () => carriersApi.listAssets(carrierId!),
    enabled: open,
  })

  const coverageTypesQuery = useQuery({
    queryKey: ['coverage-types'],
    queryFn: () => coverageTypesApi.list(),
    enabled: open,
  })

  useEffect(() => {
    if (policies.length === 0) { setSelectedPolicyId(null); return }
    if (!selectedPolicyId || !policies.some(p => p.id === selectedPolicyId)) {
      const preferred = initialPolicyId && policies.some(p => p.id === initialPolicyId) ? initialPolicyId : policies[0].id
      setSelectedPolicyId(preferred)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policies])

  useEffect(() => {
    setShowAll(false)
  }, [selectedPolicyId])

  const detailQuery = useQuery({
    queryKey: ['policy-detail', selectedPolicyId],
    queryFn: () => policiesApi.get(selectedPolicyId!),
    enabled: open && !!selectedPolicyId,
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

  function invalidateDetail() {
    queryClient.invalidateQueries({ queryKey: ['policy-detail', selectedPolicyId] })
    queryClient.invalidateQueries({ queryKey: ['carrier-policies', carrierId] })
  }

  function handleInstallmentChanged(updated: InsuranceInstallment) {
    queryClient.setQueryData(
      ['policy-detail', selectedPolicyId],
      (old: InsurancePolicy | undefined) =>
        old ? { ...old, installments: old.installments.map(i => i.id === updated.id ? updated : i) } : old,
    )
  }

  async function handleLinkCoverage(coverageTypeId: string) {
    if (!selectedPolicyId) return
    await policiesApi.linkCoverage(selectedPolicyId, coverageTypeId)
    invalidateDetail()
  }
  async function handleUnlinkCoverage(coverageTypeId: string) {
    if (!selectedPolicyId) return
    await policiesApi.unlinkCoverage(selectedPolicyId, coverageTypeId)
    invalidateDetail()
  }
  async function handleLinkAsset(assetId: string) {
    if (!selectedPolicyId) return
    await policiesApi.linkAsset(selectedPolicyId, assetId)
    invalidateDetail()
  }
  async function handleUnlinkAsset(assetId: string) {
    if (!selectedPolicyId) return
    await policiesApi.unlinkAsset(selectedPolicyId, assetId)
    invalidateDetail()
  }

  function handlePortalUrlSaved(patch: Partial<InsurancePolicy>) {
    queryClient.setQueryData(
      ['policy-detail', selectedPolicyId],
      (old: InsurancePolicy | undefined) => old ? { ...old, ...patch } : old,
    )
  }

  async function handleUploadPolicyFile(kind: 'document' | 'endorsement', file: File) {
    if (!selectedPolicyId) return
    setFileErr(null)
    try {
      await policiesApi.uploadFile(selectedPolicyId, file, kind)
      invalidateDetail()
    } catch (e) {
      setFileErr(e instanceof Error ? e.message : 'Error al subir el archivo')
    }
  }

  if (!open) return null

  const selectedListItem = policies.find(p => p.id === selectedPolicyId) ?? null
  const policy = detailQuery.data ?? null
  const installments = policy?.installments ?? []
  const spotlight = nextActionable(installments)
  const sortedInstallments = installments.slice().sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))

  const linkedCoverageIds = new Set((policy?.coverages ?? []).map(c => c.coverage_type_id))
  const availableCoverages = (coverageTypesQuery.data ?? []).filter(c => !linkedCoverageIds.has(c.id))

  const linkedAssetIds = new Set((policy?.assets ?? []).map(a => a.asset_id))
  const availableAssets = (assetsQuery.data ?? []).filter(a => !linkedAssetIds.has(a.id))

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
                <p className="text-xs font-bold text-text-primary truncate">{displayName}</p>
              </div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Pólizas ({policies.length})</p>
              <div className="flex sm:flex-col gap-2 overflow-x-auto sm:overflow-visible">
                {policies.map(p => {
                  const active = p.id === selectedPolicyId
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedPolicyId(p.id)}
                      className={`text-left px-3 py-2 rounded-lg shrink-0 transition-colors ${
                        active ? 'bg-white shadow-sm border-l-2 border-accent' : 'hover:bg-white/60'
                      }`}
                    >
                      <p className={`text-xs font-bold ${active ? 'text-text-primary' : 'text-gray-500'}`}>{p.insurance_company}</p>
                      <p className={`text-[10px] ${p.overdue_installments > 0 ? 'text-red-500 font-semibold' : 'text-green-600'}`}>
                        {p.overdue_installments > 0 ? `${p.overdue_installments} vencida${p.overdue_installments > 1 ? 's' : ''}` : 'al día'}
                      </p>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="flex-1 min-w-0 overflow-y-auto p-5 sm:p-6">
            {listQuery.isPending ? (
              <p className="text-sm text-gray-400 flex items-center gap-2 pt-2"><Loader2 size={14} className="animate-spin" /> Cargando pólizas…</p>
            ) : listQuery.error ? (
              <p className="text-sm text-red-500 pt-2">{listQuery.error instanceof Error ? listQuery.error.message : 'Error cargando pólizas'}</p>
            ) : policies.length === 0 ? (
              <p className="text-sm text-gray-400 italic pt-2">Sin pólizas registradas</p>
            ) : !selectedListItem || detailQuery.isPending || !policy ? (
              <p className="text-sm text-gray-400 flex items-center gap-2 pt-2"><Loader2 size={14} className="animate-spin" /> Cargando detalle…</p>
            ) : (
              <>
                {policies.length === 1 && (
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className="w-9 h-9 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-xs font-bold shrink-0">
                      {initialsOf(displayName)}
                    </div>
                    <p className="text-xs font-bold text-text-primary truncate">{displayName}</p>
                    <span className={`ml-auto inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${HEALTH_BADGE[selectedListItem.policy_health].cls}`}>
                      {HEALTH_BADGE[selectedListItem.policy_health].icon} {HEALTH_BADGE[selectedListItem.policy_health].label}
                    </span>
                  </div>
                )}

                <div className="flex items-start justify-between gap-3 mb-5 pr-6">
                  <div>
                    <p className="text-[15px] font-bold text-text-primary">{policy.insurance_company}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Póliza {policy.policy_number}
                      {policy.has_endorsement ? ' · con endoso' : ''}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      Vigencia <span className="font-semibold text-gray-700">{formatExpiry(policy.valid_from)} – {formatExpiry(policy.valid_to)}</span>
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xl font-bold text-accent leading-none">
                      {installments.length === 0 ? '—' : `${Math.round(100 * installments.filter(i => i.payment_status === 'PAID').length / installments.length)}%`}
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1">cuotas pagadas</p>
                  </div>
                </div>

                {/* Documentos+Enlaces / Coberturas+Activos lado a lado — menos
                    stack vertical que 4 secciones apiladas una tras otra. */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-4 mb-5">
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Documentos</p>
                      <PolicyFileRow label="Póliza" url={policy.policy_document_url} onUpload={file => handleUploadPolicyFile('document', file)} canEdit={canEdit} />
                      {policy.has_endorsement && (
                        <PolicyFileRow label="Endoso" url={policy.endorsement_document_url} onUpload={file => handleUploadPolicyFile('endorsement', file)} canEdit={canEdit} />
                      )}
                      {fileErr && <p className="text-xs text-red-500">{fileErr}</p>}
                    </div>

                    <div className="space-y-1.5">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Enlaces</p>
                      <PolicyLinkRow value={policy.external_portal_url} policyId={policy.id} canEdit={canEdit} onSaved={handlePortalUrlSaved} />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Coberturas</p>
                      <div className="flex flex-wrap gap-1.5">
                        {(policy.coverages ?? []).map(c => (
                          <span key={c.coverage_type_id} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full bg-slate-100 text-slate-600">
                            {c.name}
                            {canEdit && (
                              <button aria-label={`Quitar cobertura ${c.name}`} onClick={() => handleUnlinkCoverage(c.coverage_type_id)} className="text-slate-400 hover:text-red-500">
                                <X size={10} />
                              </button>
                            )}
                          </span>
                        ))}
                        {(policy.coverages ?? []).length === 0 && <span className="text-[11px] text-gray-300 italic">Sin coberturas</span>}
                      </div>
                      {canEdit && availableCoverages.length > 0 && (
                        <select
                          aria-label="Agregar cobertura"
                          value=""
                          onChange={e => { if (e.target.value) handleLinkCoverage(e.target.value) }}
                          className="text-[11px] border border-border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-accent/20"
                        >
                          <option value="">+ Agregar cobertura…</option>
                          {availableCoverages.map((c: CoverageType) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      )}
                    </div>

                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Activos cubiertos</p>
                      <div className="flex flex-wrap gap-1.5">
                        {(policy.assets ?? []).map(a => (
                          <span key={a.asset_id} className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold px-2 py-1 rounded-full bg-slate-100 text-slate-600">
                            {a.license_plate}
                            {canEdit && (
                              <button aria-label={`Quitar activo ${a.license_plate}`} onClick={() => handleUnlinkAsset(a.asset_id)} className="text-slate-400 hover:text-red-500">
                                <X size={10} />
                              </button>
                            )}
                          </span>
                        ))}
                        {(policy.assets ?? []).length === 0 && <span className="text-[11px] text-gray-300 italic">Sin activos cubiertos</span>}
                      </div>
                      {canEdit && availableAssets.length > 0 && (
                        <select
                          aria-label="Agregar activo cubierto"
                          value=""
                          onChange={e => { if (e.target.value) handleLinkAsset(e.target.value) }}
                          className="text-[11px] border border-border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-accent/20"
                        >
                          <option value="">+ Agregar activo…</option>
                          {availableAssets.map(a => <option key={a.id} value={a.id}>{a.license_plate}</option>)}
                        </select>
                      )}
                    </div>
                  </div>
                </div>

                {spotlight && (
                  <div className="mb-2">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Próxima cuota</p>
                    <InstallmentRow installment={spotlight} canAdmin={canAdmin} onChanged={handleInstallmentChanged} />
                  </div>
                )}

                {installments.length > 0 && (
                  <button
                    onClick={() => setShowAll(v => !v)}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 mb-2 mt-1"
                  >
                    {showAll ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    Ver todas las cuotas ({installments.length})
                  </button>
                )}

                {showAll && (
                  <div className="flex flex-col gap-1.5 mb-6">
                    {sortedInstallments.map(inst => (
                      <div key={inst.id} className={spotlight?.id === inst.id ? 'ring-2 ring-accent/30 rounded-lg' : ''}>
                        <InstallmentRow installment={inst} canAdmin={canAdmin} onChanged={handleInstallmentChanged} />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

/** Fila de archivo (documento de póliza / endoso) — sube vía POST
 *  .../file?kind=document|endorsement. `url` ya viene firmada por el
 *  backend (resolve_signed_url), lista para abrir directo. */
function PolicyFileRow({ label, url, canEdit, onUpload }: {
  label: string; url: string | null; canEdit: boolean; onUpload: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-gray-400 w-16 shrink-0">{label}</span>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="text-[11px] text-accent hover:underline truncate flex-1 min-w-0">Ver archivo</a>
      ) : (
        <span className="text-[11px] text-gray-300 italic flex-1">Falta subir</span>
      )}
      {canEdit && (
        <>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            aria-label={`Subir ${label}`}
            className="text-[10px] text-gray-400 hover:text-accent shrink-0"
          >
            {url ? 'Reemplazar' : 'Subir'}
          </button>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f) }}
          />
        </>
      )}
    </div>
  )
}

/** Enlace editable inline (portal externo de la aseguradora) — único campo
 *  de URL con escritura soportada por PATCH /policies/{id} (policy_document_url/
 *  endorsement_document_url tienen su propio flujo de subida, ver
 *  PolicyFileRow — no son texto libre). El draft NUNCA se resincroniza
 *  implícitamente al reabrir edición — se resetea explícitamente desde
 *  `value` en el propio handler del botón "Editar" (mismo patrón que
 *  ContactCard, ver commit d445c56). */
function PolicyLinkRow({ value, policyId, canEdit, onSaved }: {
  value: string | null; policyId: string; canEdit: boolean; onSaved: (patch: Partial<InsurancePolicy>) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [busy, setBusy] = useState(false)

  function openEdit() {
    setDraft(value ?? '')
    setEditing(true)
  }

  async function save() {
    setBusy(true)
    try {
      const res = await policiesApi.patch(policyId, { external_portal_url: draft })
      onSaved({ external_portal_url: res.external_portal_url })
      setEditing(false)
    } finally { setBusy(false) }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-gray-400 w-16 shrink-0">Portal</span>
        <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="https://…" autoFocus
          aria-label="Enlace de Portal"
          className="flex-1 min-w-0 text-[11px] border border-border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-accent/30" />
        <button onClick={save} disabled={busy} aria-label="Guardar enlace de Portal" className="p-1 rounded bg-accent text-white disabled:opacity-50">
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
        </button>
        <button onClick={() => setEditing(false)} aria-label="Cancelar edición de Portal" className="p-1 rounded text-gray-400 hover:text-gray-600"><X size={11} /></button>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-gray-400 w-16 shrink-0">Portal</span>
      {value ? (
        <a href={value} target="_blank" rel="noreferrer" className="text-[11px] text-accent hover:underline truncate flex-1 min-w-0">{value}</a>
      ) : (
        <span className="text-[11px] text-gray-300 italic flex-1">Sin datos</span>
      )}
      {canEdit && <button onClick={openEdit} aria-label="Editar enlace de Portal" className="text-[10px] text-gray-400 hover:text-accent shrink-0"><Plus size={10} className="inline -mt-0.5" /> Editar</button>}
    </div>
  )
}
