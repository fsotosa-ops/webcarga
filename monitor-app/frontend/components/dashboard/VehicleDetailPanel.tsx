'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, X, ArrowRightLeft, Truck, Trash2 } from 'lucide-react'
import type { VehicleGovernance, TransporterVehicle, ComplianceStatus } from '@/lib/types'
import { DocumentChecklist } from './DocumentChecklist'
import { vehicleGovernanceToChecklistItems, withVehicleGovernanceField } from '@/lib/utils/transporterDocs'

interface Props {
  vehicle:         TransporterVehicle | null
  canEdit:         boolean
  canAdmin:        boolean
  onClose:         () => void
  onPatch:         (vid: string, body: { type?: string; plate?: string; governance?: VehicleGovernance }) => Promise<void>
  onRemove:        () => Promise<void>
  onTransferClick?: () => void
}

const EXPIRY_FIELDS = [
  { key: 'circ_permit_expiry' as const,     label: 'Vencimiento permiso de circulación' },
  { key: 'tech_inspection_expiry' as const, label: 'Vencimiento revisión técnica' },
  { key: 'gas_emissions_expiry' as const,   label: 'Vencimiento gases' },
  { key: 'soap_insurance_expiry' as const,  label: 'Vencimiento SOAP' },
]

/** Panel de detalle de un equipo — mismo contrato de accesibilidad que
 *  DriverDetailPanel/TransporterSlideOver. */
export function VehicleDetailPanel({ vehicle, canEdit, canAdmin, onClose, onPatch, onRemove, onTransferClick }: Props) {
  const open = !!vehicle
  const panelRef = useRef<HTMLDivElement>(null)
  const [removing, setRemoving] = useState(false)
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

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/50 z-40 animate-backdrop-in" onClick={onClose} aria-hidden="true" />
      )}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={vehicle ? `Detalle de ${vehicle.plate}` : 'Detalle de equipo'}
        tabIndex={-1}
        className={`fixed inset-y-0 right-0 z-50 w-full sm:w-[440px] bg-white border-l border-border shadow-2xl flex flex-col transition-transform duration-300 focus:outline-none ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {vehicle && (
          <>
            <div className="px-5 py-4 bg-slate-900 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white shrink-0">
                  <Truck size={16} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-white font-mono truncate">{vehicle.plate}</h3>
                  <p className="text-[11px] text-white/50 truncate">{vehicle.type}</p>
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
                    aria-label="Tipo de equipo"
                    value={draft.type}
                    disabled={!canEdit}
                    onChange={e => setDraft(v => ({ ...v, type: e.target.value }))}
                    className="w-full text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white disabled:bg-gray-50"
                  />
                  <input
                    aria-label="Patente"
                    value={draft.plate}
                    disabled={!canEdit}
                    onChange={e => setDraft(v => ({ ...v, plate: e.target.value }))}
                    className="w-full text-sm font-mono border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white disabled:bg-gray-50"
                  />
                  <div className="grid grid-cols-2 gap-2">
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
                  items={vehicleGovernanceToChecklistItems(vehicle)}
                  canEdit={canEdit}
                  onStatusChange={handleStatusChange}
                />
                {statusErr && <p className="text-xs text-red-500 mt-2">{statusErr}</p>}
              </section>

              {canAdmin && onTransferClick && (
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
                  Eliminar equipo
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
