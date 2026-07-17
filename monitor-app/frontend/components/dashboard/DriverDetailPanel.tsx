'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, X, ArrowRightLeft, Trash2 } from 'lucide-react'
import type { Driver } from '@/lib/types'
import { driversApi, type DriverPatchBody } from '@/lib/api/drivers'
import { complianceApi } from '@/lib/api/compliance'
import { DocumentChecklist, checklistCompletion } from './DocumentChecklist'
import { CompletionRing } from './CompletionRing'
import { BajaReasonModal } from './BajaReasonModal'
import { complianceRecordsToChecklistItems } from '@/lib/utils/complianceChecklist'
import { getInitials, getInitialColor } from '@/lib/utils/avatar'

interface Props {
  driver:          Driver | null
  canEdit:         boolean
  canAdmin:        boolean
  onClose:         () => void
  onPatch:         (id: string, body: DriverPatchBody) => Promise<void>
  onRemove:        () => Promise<void>
  onTransferClick: () => void
}

/** Modal de detalle de un conductor — se abre al hacer click en su tarjeta
 *  del roster. El checklist de documentación se carga acá mismo (no lo trae
 *  el roster, que solo expone el agregado) vía GET /drivers/{id}/compliance-records. */
export function DriverDetailPanel({ driver, canEdit, canAdmin, onClose, onPatch, onRemove, onTransferClick }: Props) {
  const open = !!driver
  const panelRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState({ full_name: '' })
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [statusErr, setStatusErr] = useState<string | null>(null)
  const [bajaModalOpen, setBajaModalOpen] = useState(false)

  const complianceQuery = useQuery({
    queryKey: ['driver-compliance-records', driver?.id],
    queryFn: () => driversApi.listComplianceRecords(driver!.id),
    enabled: !!driver,
  })

  useEffect(() => {
    if (!driver) return
    setDraft({ full_name: driver.full_name })
    setErr(null); setStatusErr(null)
  }, [driver])

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

  function invalidateCompliance() {
    if (driver) queryClient.invalidateQueries({ queryKey: ['driver-compliance-records', driver.id] })
  }

  async function handleSaveDatos() {
    if (!driver) return
    setSaving(true); setErr(null)
    try {
      await onPatch(driver.id, { full_name: draft.full_name })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleStatusChange(recordId: string, status: Parameters<typeof complianceApi.patch>[1]['status']) {
    setStatusErr(null)
    try {
      await complianceApi.patch(recordId, { status })
      invalidateCompliance()
    } catch (e) {
      setStatusErr(e instanceof Error ? e.message : 'Error al guardar')
    }
  }

  async function handleUpload(recordId: string, file: File) {
    setStatusErr(null)
    try {
      await complianceApi.uploadFile(recordId, file)
      invalidateCompliance()
    } catch (e) {
      setStatusErr(e instanceof Error ? e.message : 'Error al subir el archivo')
    }
  }

  async function handleRemove() {
    setRemoving(true); setErr(null)
    try {
      await onRemove()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al quitar')
    } finally {
      setRemoving(false)
    }
  }

  async function handleDeactivate() {
    await onPatch(driver!.id, { operational_status: 'INACTIVE' })
  }

  async function handleReactivate() {
    await onPatch(driver!.id, { operational_status: 'ACTIVE' })
  }

  const items = complianceRecordsToChecklistItems(complianceQuery.data ?? [])
  const { ok, total } = checklistCompletion(items)

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/50 z-40 animate-backdrop-in" onClick={onClose} aria-hidden="true" />
      )}

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={driver ? `Detalle de ${driver.full_name}` : 'Detalle de conductor'}
        tabIndex={-1}
        className={`fixed inset-y-0 right-0 z-50 w-full sm:w-[640px] bg-white border-l border-border shadow-2xl flex flex-col transition-transform duration-300 focus:outline-none ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {driver && (
          <>
            <div className="flex items-start justify-between gap-3 p-5 border-b border-border shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                  style={{ backgroundColor: getInitialColor(driver.full_name) }}
                >
                  {getInitials(driver.full_name)}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-text-primary truncate">{driver.full_name}</p>
                  <p className="text-[11px] text-gray-400 font-mono">{driver.tax_id}</p>
                </div>
              </div>
              <button onClick={onClose} aria-label="Cerrar detalle" className="text-gray-400 hover:text-gray-600 shrink-0">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <div className="flex items-center gap-3">
                <CompletionRing ok={ok} total={total} />
                <p className="text-[11px] text-gray-500">{ok} de {total}<br />documentos al día</p>
              </div>

              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Nombre</label>
                  <input
                    aria-label="Nombre"
                    value={draft.full_name}
                    disabled={!canEdit}
                    onChange={e => setDraft({ full_name: e.target.value })}
                    className="w-full text-xs border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white disabled:bg-gray-50"
                  />
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={handleSaveDatos}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/90 disabled:opacity-50 shrink-0"
                  >
                    {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                    Guardar
                  </button>
                )}
              </div>
              {err && <p className="text-xs text-red-500">{err}</p>}

              <div className="flex flex-wrap gap-2">
                {canAdmin && (
                  <button
                    type="button"
                    onClick={onTransferClick}
                    className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 border border-border hover:border-accent hover:text-accent rounded-lg px-3 py-2 transition-colors"
                  >
                    <ArrowRightLeft size={13} /> Transferir a otra empresa
                  </button>
                )}
                {canAdmin && (
                  driver.operational_status === 'INACTIVE' ? (
                    <button
                      type="button"
                      onClick={handleReactivate}
                      className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 border border-border hover:border-accent hover:text-accent rounded-lg px-3 py-2 transition-colors"
                    >
                      Reactivar
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setBajaModalOpen(true)}
                      className="flex items-center gap-1.5 text-xs font-semibold text-red-500 border border-red-200 hover:bg-red-50 rounded-lg px-3 py-2 transition-colors"
                    >
                      Dar de baja
                    </button>
                  )
                )}
                {canEdit && (
                  <button
                    type="button"
                    onClick={handleRemove}
                    disabled={removing}
                    className="flex items-center gap-1.5 text-xs font-semibold text-red-500 border border-red-200 hover:bg-red-50 rounded-lg px-3 py-2 transition-colors disabled:opacity-50"
                  >
                    {removing ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    Quitar del roster
                  </button>
                )}
              </div>

              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Documentación</p>
                {complianceQuery.isPending ? (
                  <p className="text-xs text-gray-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Cargando…</p>
                ) : (
                  <DocumentChecklist
                    items={items}
                    canEdit={canEdit}
                    onStatusChange={handleStatusChange}
                    onUpload={handleUpload}
                    hideCounter
                  />
                )}
                {statusErr && <p className="text-xs text-red-500 mt-2">{statusErr}</p>}
              </div>
            </div>
          </>
        )}
      </div>

      {bajaModalOpen && driver && (
        <BajaReasonModal
          label={`conductor ${driver.full_name}`}
          onClose={() => setBajaModalOpen(false)}
          onConfirm={handleDeactivate}
        />
      )}
    </>
  )
}
