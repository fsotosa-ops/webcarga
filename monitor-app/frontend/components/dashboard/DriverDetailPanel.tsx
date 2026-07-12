'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, X, ArrowRightLeft, Trash2 } from 'lucide-react'
import type { DriverGovernance, TransporterDriver, ComplianceStatus } from '@/lib/types'
import { DocumentChecklist } from './DocumentChecklist'
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
}

/** Panel de detalle de un conductor — se abre al hacer click en su tarjeta
 *  del roster. Mismo contrato de accesibilidad que TransporterSlideOver:
 *  Escape cierra, Tab atrapado, foco inicial y retorno al cerrar. */
export function DriverDetailPanel({ driver, canEdit, canAdmin, onClose, onPatch, onRemove, onTransferClick }: Props) {
  const open = !!driver
  const panelRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState({ rut: '', name: '', id_expiry: '', license_expiry: '' })
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [statusErr, setStatusErr] = useState<string | null>(null)

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

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/50 z-40 animate-backdrop-in" onClick={onClose} aria-hidden="true" />
      )}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={driver ? `Detalle de ${driver.name}` : 'Detalle de conductor'}
        tabIndex={-1}
        className={`fixed inset-y-0 right-0 z-50 w-full sm:w-[440px] bg-white border-l border-border shadow-2xl flex flex-col transition-transform duration-300 focus:outline-none ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {driver && (
          <>
            <div className="px-5 py-4 bg-slate-900 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                  style={{ backgroundColor: getInitialColor(driver.name) }}
                >
                  {getInitials(driver.name)}
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-white truncate">{driver.name}</h3>
                  <p className="text-[11px] text-white/50 font-mono">{driver.rut}</p>
                </div>
              </div>
              <button onClick={onClose} aria-label="Cerrar detalle" className="text-white/50 hover:text-white transition-colors shrink-0">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <section>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Datos y vencimientos</p>
                <div className="space-y-2">
                  <input
                    aria-label="Nombre"
                    value={draft.name}
                    disabled={!canEdit}
                    onChange={e => setDraft(v => ({ ...v, name: e.target.value }))}
                    className="w-full text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white disabled:bg-gray-50"
                  />
                  <input
                    aria-label="RUT"
                    value={draft.rut}
                    disabled={!canEdit}
                    onChange={e => setDraft(v => ({ ...v, rut: e.target.value }))}
                    className="w-full text-sm font-mono border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white disabled:bg-gray-50"
                  />
                  <div className="grid grid-cols-2 gap-2">
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
              </section>

              <section>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Documentación</p>
                <DocumentChecklist
                  items={driverGovernanceToChecklistItems(driver)}
                  canEdit={canEdit}
                  onStatusChange={handleStatusChange}
                />
                {statusErr && <p className="text-xs text-red-500 mt-2">{statusErr}</p>}
              </section>

              {canAdmin && (
                <button
                  type="button"
                  onClick={onTransferClick}
                  className="flex items-center justify-center gap-1.5 w-full text-sm font-semibold text-gray-600 border border-border hover:border-accent hover:text-accent rounded-lg px-4 py-2.5 transition-colors"
                >
                  <ArrowRightLeft size={14} /> Transferir a otra empresa
                </button>
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
          </>
        )}
      </div>
    </>
  )
}
