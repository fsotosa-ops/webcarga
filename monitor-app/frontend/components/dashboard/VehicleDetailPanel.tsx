'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, X, ArrowRightLeft, Truck, Trash2 } from 'lucide-react'
import type { VehicleGovernance, TransporterVehicle, ComplianceStatus } from '@/lib/types'
import type { BajaBody } from '@/lib/api/transporters'
import { DocumentChecklist, checklistCompletion } from './DocumentChecklist'
import { CompletionRing } from './CompletionRing'
import { BajaReasonModal } from './BajaReasonModal'
import { vehicleGovernanceToChecklistItems, withVehicleGovernanceField } from '@/lib/utils/transporterDocs'

interface Props {
  vehicle:         TransporterVehicle | null
  canEdit:         boolean
  canAdmin:        boolean
  onClose:         () => void
  onPatch:         (vid: string, body: { type?: string; plate?: string; governance?: VehicleGovernance }) => Promise<void>
  onRemove:        () => Promise<void>
  onTransferClick?: () => void
  /** undefined para ramplas: no existe endpoint .../trailers/{id}/deactivate en el backend */
  onDeactivate?:   (body: BajaBody) => Promise<void>
  onReactivate?:   () => Promise<void>
}

const EXPIRY_FIELDS = [
  { key: 'circ_permit_expiry' as const,     label: 'Vencimiento permiso de circulación' },
  { key: 'tech_inspection_expiry' as const, label: 'Vencimiento revisión técnica' },
  { key: 'gas_emissions_expiry' as const,   label: 'Vencimiento gases' },
  { key: 'soap_insurance_expiry' as const,  label: 'Vencimiento SOAP' },
]

/** Modal de detalle de un equipo — mismo lenguaje inmersivo que
 *  DriverDetailPanel/InsurancePolicyModal: modal centrado de 2 columnas,
 *  mismo contrato de accesibilidad. */
export function VehicleDetailPanel({ vehicle, canEdit, canAdmin, onClose, onPatch, onRemove, onTransferClick, onDeactivate, onReactivate }: Props) {
  const open = !!vehicle
  const panelRef = useRef<HTMLDivElement>(null)
  const [removing, setRemoving] = useState(false)
  const [bajaModalOpen, setBajaModalOpen] = useState(false)
  const [draft, setDraft] = useState({
    type: '', plate: '',
    circ_permit_expiry: '', tech_inspection_expiry: '', gas_emissions_expiry: '', soap_insurance_expiry: '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [statusErr, setStatusErr] = useState<string | null>(null)

  useEffect(() => {
    if (!vehicle) return
    setDraft({
      type: vehicle.type, plate: vehicle.plate,
      circ_permit_expiry: vehicle.governance?.circ_permit_expiry ?? '',
      tech_inspection_expiry: vehicle.governance?.tech_inspection_expiry ?? '',
      gas_emissions_expiry: vehicle.governance?.gas_emissions_expiry ?? '',
      soap_insurance_expiry: vehicle.governance?.soap_insurance_expiry ?? '',
    })
    setErr(null); setStatusErr(null)
  }, [vehicle])

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
    if (!vehicle) return
    setSaving(true); setErr(null)
    try {
      await onPatch(vehicle.id, {
        type: draft.type, plate: draft.plate,
        governance: {
          ...(vehicle.governance ?? {}),
          circ_permit_expiry: draft.circ_permit_expiry || null,
          tech_inspection_expiry: draft.tech_inspection_expiry || null,
          gas_emissions_expiry: draft.gas_emissions_expiry || null,
          soap_insurance_expiry: draft.soap_insurance_expiry || null,
        } as VehicleGovernance,
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleStatusChange(docCode: string, status: ComplianceStatus) {
    if (!vehicle) return
    setStatusErr(null)
    try {
      await onPatch(vehicle.id, { governance: withVehicleGovernanceField(vehicle.governance, docCode, status) })
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

  const items = vehicleGovernanceToChecklistItems(vehicle)
  const { ok, total } = checklistCompletion(items)

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40 animate-backdrop-in" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={`Detalle de ${vehicle.plate}`}
          tabIndex={-1}
          className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col sm:flex-row focus:outline-none"
        >
          <button onClick={onClose} aria-label="Cerrar detalle" className="absolute top-4 right-4 z-10 text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>

          <div className="sm:w-[34%] shrink-0 bg-gray-50 border-b sm:border-b-0 sm:border-r border-border overflow-y-auto p-4">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-9 h-9 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center shrink-0">
                <Truck size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-text-primary font-mono truncate">{vehicle.plate}</p>
                <p className="text-[10px] text-gray-400 truncate">{vehicle.type}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 mb-4">
              <CompletionRing ok={ok} total={total} />
              <p className="text-[11px] text-gray-500">{ok} de {total}<br />documentos al día</p>
            </div>

            <div className="space-y-2">
              <input
                aria-label="Tipo de equipo"
                value={draft.type}
                disabled={!canEdit}
                onChange={e => setDraft(v => ({ ...v, type: e.target.value }))}
                className="w-full text-xs border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white disabled:bg-gray-50"
              />
              <input
                aria-label="Patente"
                value={draft.plate}
                disabled={!canEdit}
                onChange={e => setDraft(v => ({ ...v, plate: e.target.value }))}
                className="w-full text-xs font-mono border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white disabled:bg-gray-50"
              />
              {EXPIRY_FIELDS.map(({ key, label }) => (
                <div key={key}>
                  <label className="text-[10px] text-gray-400 block mb-0.5">{label.replace('Vencimiento ', '')}</label>
                  <input
                    aria-label={label}
                    type="date"
                    value={draft[key]}
                    disabled={!canEdit}
                    onChange={e => setDraft(v => ({ ...v, [key]: e.target.value }))}
                    className="w-full text-xs border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white disabled:bg-gray-50"
                  />
                </div>
              ))}
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
              {canAdmin && onTransferClick && (
                <button
                  type="button"
                  onClick={onTransferClick}
                  className="flex items-center justify-center gap-1.5 w-full text-sm font-semibold text-gray-600 border border-border hover:border-accent hover:text-accent rounded-lg px-4 py-2.5 transition-colors"
                >
                  <ArrowRightLeft size={14} /> Transferir a otra empresa
                </button>
              )}
              {canAdmin && onDeactivate && onReactivate && (
                vehicle.baja_override ? (
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
                  Eliminar equipo
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
      {bajaModalOpen && onDeactivate && (
        <BajaReasonModal
          label={`equipo ${vehicle.plate}`}
          onClose={() => setBajaModalOpen(false)}
          onConfirm={onDeactivate}
        />
      )}
    </>
  )
}
