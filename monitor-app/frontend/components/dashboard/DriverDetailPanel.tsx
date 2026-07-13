'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, X, ArrowRightLeft, Trash2 } from 'lucide-react'
import type { DriverGovernance, TransporterDriver, ComplianceStatus } from '@/lib/types'
import type { BajaBody } from '@/lib/api/transporters'
import { DocumentChecklist, checklistCompletion } from './DocumentChecklist'
import { CompletionRing } from './CompletionRing'
import { BajaReasonModal } from './BajaReasonModal'
import { driverGovernanceToChecklistItems, withDriverGovernanceField } from '@/lib/utils/transporterDocs'
import { getInitials, getInitialColor } from '@/lib/utils/avatar'

interface Props {
  driver:          TransporterDriver | null
  canEdit:         boolean
  canAdmin:        boolean
  onClose:         () => void
  onPatch:         (did: string, body: { rut?: string; name?: string; governance?: DriverGovernance }) => Promise<void>
  onRemove:        () => Promise<void>
  onTransferClick: () => void
  onDeactivate:    (body: BajaBody) => Promise<void>
  onReactivate:    () => Promise<void>
}

/** Modal de detalle de un conductor — se abre al hacer click en su tarjeta
 *  del roster. Mismo lenguaje inmersivo que InsurancePolicyModal: modal
 *  centrado de 2 columnas (identidad + progreso a la izquierda,
 *  documentación a la derecha), mismo contrato de accesibilidad: Escape
 *  cierra, Tab atrapado, foco inicial y retorno al cerrar. */
export function DriverDetailPanel({ driver, canEdit, canAdmin, onClose, onPatch, onRemove, onTransferClick, onDeactivate, onReactivate }: Props) {
  const open = !!driver
  const panelRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState({ rut: '', name: '', id_expiry: '', license_expiry: '' })
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [statusErr, setStatusErr] = useState<string | null>(null)
  const [bajaModalOpen, setBajaModalOpen] = useState(false)

  useEffect(() => {
    if (!driver) return
    setDraft({
      rut: driver.rut, name: driver.name,
      id_expiry: driver.governance?.id_expiry ?? '',
      license_expiry: driver.governance?.license_expiry ?? '',
    })
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

  async function handleSaveDatos() {
    if (!driver) return
    setSaving(true); setErr(null)
    try {
      await onPatch(driver.id, {
        rut: draft.rut, name: draft.name,
        governance: {
          ...(driver.governance ?? {}),
          id_expiry: draft.id_expiry || null,
          license_expiry: draft.license_expiry || null,
        } as DriverGovernance,
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleStatusChange(docCode: string, status: ComplianceStatus) {
    if (!driver) return
    setStatusErr(null)
    try {
      await onPatch(driver.id, { governance: withDriverGovernanceField(driver.governance, docCode, status) })
    } catch (e) {
      setStatusErr(e instanceof Error ? e.message : 'Error al guardar')
    }
  }

  async function handleRemove() {
    setRemoving(true); setErr(null)
    try {
      await onRemove()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al eliminar')
    } finally {
      setRemoving(false)
    }
  }

  if (!open) return null

  const items = driverGovernanceToChecklistItems(driver)
  const { ok, total } = checklistCompletion(items)

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40 animate-backdrop-in" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={`Detalle de ${driver.name}`}
          tabIndex={-1}
          className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col sm:flex-row focus:outline-none"
        >
          <button onClick={onClose} aria-label="Cerrar detalle" className="absolute top-4 right-4 z-10 text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>

          <div className="sm:w-[34%] shrink-0 bg-gray-50 border-b sm:border-b-0 sm:border-r border-border overflow-y-auto p-4">
            <div className="flex items-center gap-2.5 mb-4">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                style={{ backgroundColor: getInitialColor(driver.name) }}
              >
                {getInitials(driver.name)}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-text-primary truncate">{driver.name}</p>
                <p className="text-[10px] text-gray-400 font-mono">{driver.rut}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 mb-4">
              <CompletionRing ok={ok} total={total} />
              <p className="text-[11px] text-gray-500">{ok} de {total}<br />documentos al día</p>
            </div>

            <div className="space-y-2">
              <input
                aria-label="Nombre"
                value={draft.name}
                disabled={!canEdit}
                onChange={e => setDraft(v => ({ ...v, name: e.target.value }))}
                className="w-full text-xs border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white disabled:bg-gray-50"
              />
              <input
                aria-label="RUT"
                value={draft.rut}
                disabled={!canEdit}
                onChange={e => setDraft(v => ({ ...v, rut: e.target.value }))}
                className="w-full text-xs font-mono border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white disabled:bg-gray-50"
              />
              <div>
                <label className="text-[10px] text-gray-400 block mb-0.5">Vencimiento cédula de identidad</label>
                <input
                  aria-label="Vencimiento cédula de identidad"
                  type="date"
                  value={draft.id_expiry}
                  disabled={!canEdit}
                  onChange={e => setDraft(v => ({ ...v, id_expiry: e.target.value }))}
                  className="w-full text-xs border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white disabled:bg-gray-50"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-400 block mb-0.5">Vencimiento licencia</label>
                <input
                  aria-label="Vencimiento licencia"
                  type="date"
                  value={draft.license_expiry}
                  disabled={!canEdit}
                  onChange={e => setDraft(v => ({ ...v, license_expiry: e.target.value }))}
                  className="w-full text-xs border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white disabled:bg-gray-50"
                />
              </div>
              {canEdit && (
                <button
                  type="button"
                  onClick={handleSaveDatos}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/90 disabled:opacity-50"
                >
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                  Guardar
                </button>
              )}
              {err && <p className="text-xs text-red-500">{err}</p>}
            </div>

            <div className="mt-5 space-y-2">
              {canAdmin && (
                <button
                  type="button"
                  onClick={onTransferClick}
                  className="flex items-center justify-center gap-1.5 w-full text-sm font-semibold text-gray-600 border border-border hover:border-accent hover:text-accent rounded-lg px-4 py-2.5 transition-colors"
                >
                  <ArrowRightLeft size={14} /> Transferir a otra empresa
                </button>
              )}
              {canAdmin && (
                driver.baja_override ? (
                  <button
                    type="button"
                    onClick={onReactivate}
                    className="flex items-center justify-center gap-1.5 w-full text-sm font-semibold text-gray-600 border border-border hover:border-accent hover:text-accent rounded-lg px-4 py-2.5 transition-colors"
                  >
                    Reactivar
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setBajaModalOpen(true)}
                    className="flex items-center justify-center gap-1.5 w-full text-sm font-semibold text-red-500 border border-red-200 hover:bg-red-50 rounded-lg px-4 py-2.5 transition-colors"
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
                  className="flex items-center justify-center gap-1.5 w-full text-sm font-semibold text-red-500 border border-red-200 hover:bg-red-50 rounded-lg px-4 py-2.5 transition-colors disabled:opacity-50"
                >
                  {removing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  Eliminar conductor
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 min-w-0 overflow-y-auto p-5 sm:p-6">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Documentación</p>
            <DocumentChecklist
              items={items}
              canEdit={canEdit}
              onStatusChange={handleStatusChange}
              hideCounter
            />
            {statusErr && <p className="text-xs text-red-500 mt-2">{statusErr}</p>}
          </div>
        </div>
      </div>
      {bajaModalOpen && (
        <BajaReasonModal
          label={`conductor ${driver.name}`}
          onClose={() => setBajaModalOpen(false)}
          onConfirm={onDeactivate}
        />
      )}
    </>
  )
}
