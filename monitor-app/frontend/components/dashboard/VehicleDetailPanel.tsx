'use client'

import { documentIngestApi } from '@/lib/api/documentIngest'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { Check, Loader2, X, ArrowRightLeft, Truck, Trash2, User, UserX, ExternalLink } from 'lucide-react'
import type { Asset } from '@/lib/types'
import { assetsApi, type AssetPatchBody, type AssetType } from '@/lib/api/assets'
import { DocumentChecklist, checklistCompletion } from './DocumentChecklist'
import { CompletionRing } from './CompletionRing'
import { BajaReasonModal } from './BajaReasonModal'
import { complianceRecordsToChecklistItems } from '@/lib/utils/complianceChecklist'

const ASSET_TYPE_OPTIONS: { value: AssetType; label: string }[] = [
  { value: 'TRACTOCAMION', label: 'Tracto' }, { value: 'RAMPLA', label: 'Rampla' },
  { value: 'CAMION', label: 'Camión' }, { value: 'FURGON', label: 'Furgón' }, { value: 'OTRO', label: 'Otro' },
]

interface Props {
  asset:           Asset | null
  carrierId:       string
  canEdit:         boolean
  canAdmin:        boolean
  onClose:         () => void
  onPatch:         (id: string, body: AssetPatchBody) => Promise<void>
  onRemove:        () => Promise<void>
  onTransferClick: () => void
  /** Roster de conductores de la misma empresa — para el picker de
   *  "conductor habitual" (Fase 1 del hardening del Diario, 2026-07-18).
   *  Forma mínima a propósito: acepta tanto Driver[] como
   *  CarrierDriverRosterItem[] (la lista ya cargada en la página de
   *  detalle de empresa), sin forzar un tipo más ancho del que hace falta. */
  drivers?:        { id: string; full_name: string }[]
}

/** Modal de detalle de un equipo — mismo lenguaje inmersivo que
 *  DriverDetailPanel. La patente es inmutable (no está en AssetPatchBody);
 *  lo único editable acá es el tipo de equipo + estado operativo. Documentos
 *  solo lectura desde Ronda 88 — subir/editar se hace en Certificación. */
export function VehicleDetailPanel({ asset, carrierId, canEdit, canAdmin, onClose, onPatch, onRemove, onTransferClick, drivers = [] }: Props) {
  const open = !!asset
  const panelRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const [removing, setRemoving] = useState(false)
  const [bajaModalOpen, setBajaModalOpen] = useState(false)
  const [draft, setDraft] = useState<{ asset_type: AssetType; manufacture_year: string }>({ asset_type: 'OTRO', manufacture_year: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [driverPick, setDriverPick] = useState('')
  const [assigningDriver, setAssigningDriver] = useState(false)
  const [driverErr, setDriverErr] = useState<string | null>(null)

  const complianceQuery = useQuery({
    queryKey: ['asset-compliance-records', asset?.id],
    queryFn: () => assetsApi.listComplianceRecords(asset!.id),
    enabled: !!asset,
  })

  const driverAssignmentQuery = useQuery({
    queryKey: ['asset-driver-assignment', asset?.id],
    queryFn: () => assetsApi.getDriverAssignment(asset!.id),
    enabled: !!asset,
  })

  useEffect(() => {
    if (!asset) return
    setDraft({ asset_type: asset.asset_type as AssetType, manufacture_year: asset.manufacture_year ? String(asset.manufacture_year) : '' })
    setErr(null)
    setDriverPick(''); setDriverErr(null)
  }, [asset])

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
    if (!asset) return
    setSaving(true); setErr(null)
    try {
      await onPatch(asset.id, {
        asset_type: draft.asset_type,
        manufacture_year: draft.manufacture_year ? Number(draft.manufacture_year) : undefined,
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
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
    await onPatch(asset!.id, { operational_status: 'INACTIVE' })
  }

  async function handleReactivate() {
    await onPatch(asset!.id, { operational_status: 'ACTIVE' })
  }

  async function handleAssignDriver() {
    if (!asset || !driverPick) return
    setAssigningDriver(true); setDriverErr(null)
    try {
      await assetsApi.assignDriver(asset.id, driverPick)
      await queryClient.invalidateQueries({ queryKey: ['asset-driver-assignment', asset.id] })
      setDriverPick('')
    } catch (e) {
      setDriverErr(e instanceof Error ? e.message : 'Error al asignar')
    } finally {
      setAssigningDriver(false)
    }
  }

  async function handleUnassignDriver() {
    if (!asset) return
    setAssigningDriver(true); setDriverErr(null)
    try {
      await assetsApi.unassignDriver(asset.id)
      await queryClient.invalidateQueries({ queryKey: ['asset-driver-assignment', asset.id] })
    } catch (e) {
      setDriverErr(e instanceof Error ? e.message : 'Error al quitar')
    } finally {
      setAssigningDriver(false)
    }
  }

  if (!open) return null

  const items = complianceRecordsToChecklistItems(complianceQuery.data ?? [])
  const { ok, total } = checklistCompletion(items)

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40 animate-backdrop-in" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={`Detalle de ${asset.license_plate}`}
          tabIndex={-1}
          className="relative bg-white rounded-2xl shadow-2xl w-[92vw] max-w-6xl h-[85vh] overflow-hidden flex flex-col sm:flex-row focus:outline-none animate-modal-in"
        >
          <button onClick={onClose} aria-label="Cerrar detalle" className="absolute top-4 right-4 z-10 text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>

          <div className="sm:w-[320px] shrink-0 bg-gray-50 border-b sm:border-b-0 sm:border-r border-border overflow-y-auto p-5">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-11 h-11 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center shrink-0">
                <Truck size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-text-primary font-mono truncate">{asset.license_plate}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 mb-5">
              <CompletionRing ok={ok} total={total} />
              <p className="text-[11px] text-gray-500">{ok} de {total}<br />documentos al día</p>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-2">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Tipo de equipo</label>
                <select
                  aria-label="Tipo de equipo"
                  value={draft.asset_type}
                  disabled={!canEdit}
                  onChange={e => setDraft(d => ({ ...d, asset_type: e.target.value as AssetType }))}
                  className="w-full text-xs border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white disabled:bg-gray-50"
                >
                  {ASSET_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Año</label>
                <input
                  type="number"
                  aria-label="Año del vehículo"
                  min={1950}
                  max={2100}
                  placeholder="—"
                  value={draft.manufacture_year}
                  disabled={!canEdit}
                  onChange={e => setDraft(d => ({ ...d, manufacture_year: e.target.value }))}
                  className="w-full text-xs border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white disabled:bg-gray-50"
                />
              </div>
              <div className="space-y-1 col-span-2">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Tipo Vehículo</label>
                {asset.fleet_service_type_label ? (
                  <span
                    className="inline-block text-xs font-semibold px-2 py-1 rounded-full"
                    style={{
                      backgroundColor: asset.fleet_service_type_bg_color ?? undefined,
                      color: asset.fleet_service_type_text_color ?? undefined,
                    }}
                  >
                    {asset.fleet_service_type_label}
                  </span>
                ) : (
                  <p className="text-xs text-gray-400 italic">Sin clasificar</p>
                )}
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
            {err && <p className="text-xs text-red-500 mt-1">{err}</p>}

            {/* Conductor habitual — Fase 1 del hardening del Diario
                (2026-07-18). El Diario resuelve driver_id automáticamente
                para cualquier viaje nuevo que reporte esta patente, sin
                depender del bootstrap histórico de raw_bd_ot — acá se
                asigna UNA vez por vehículo, no viaje por viaje. */}
            <div className="mt-5 pt-4 border-t border-border/60">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Conductor habitual</label>
              {driverAssignmentQuery.isPending ? (
                <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1.5">
                  <Loader2 size={12} className="animate-spin" /> Cargando…
                </p>
              ) : driverAssignmentQuery.data ? (
                <div className="flex items-center justify-between gap-2 mt-1.5">
                  <span className="flex items-center gap-1.5 text-xs text-text-primary min-w-0">
                    <User size={13} className="text-gray-400 shrink-0" />
                    <span className="truncate">{driverAssignmentQuery.data.driver_name}</span>
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      aria-label="Quitar conductor habitual"
                      onClick={handleUnassignDriver}
                      disabled={assigningDriver}
                      className="text-gray-400 hover:text-red-500 shrink-0 disabled:opacity-50"
                    >
                      {assigningDriver ? <Loader2 size={13} className="animate-spin" /> : <UserX size={13} />}
                    </button>
                  )}
                </div>
              ) : canEdit ? (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <select
                    aria-label="Asignar conductor habitual"
                    value={driverPick}
                    onChange={e => setDriverPick(e.target.value)}
                    className="flex-1 min-w-0 text-xs border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white"
                  >
                    <option value="">Sin asignar</option>
                    {drivers.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                  </select>
                  <button
                    type="button"
                    aria-label="Confirmar conductor habitual"
                    onClick={handleAssignDriver}
                    disabled={!driverPick || assigningDriver}
                    className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/90 disabled:opacity-40"
                  >
                    {assigningDriver ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                  </button>
                </div>
              ) : (
                <p className="text-xs text-gray-400 mt-1.5">Sin asignar</p>
              )}
              {driverErr && <p className="text-xs text-red-500 mt-1">{driverErr}</p>}
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
                asset.operational_status === 'INACTIVE' ? (
                  <button
                    type="button"
                    onClick={handleReactivate}
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
                  Quitar del roster
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 min-w-0 overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Documentación</p>
            </div>
            {complianceQuery.isPending ? (
              <p className="text-xs text-gray-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Cargando…</p>
            ) : (
              /* HU-04: la ficha vuelve a poder cargar. La capacidad ya estaba
                 en DocumentChecklist — quedó apagada en la Ronda 88, cuando la
                 carga se centralizó en Certificación. */
              <DocumentChecklist
                items={items}
                canEdit={canEdit}
                hideCounter
                onUpload={async (recordId, file) => {
                  const item = items.find(i => i.id === recordId)
                  if (!item) return
                  await documentIngestApi.uploadAndClassify({
                    carrierId,
                    entityType:    'ASSET',
                    entityId:      asset.id,
                    requirementId: item.requirement_id,
                    file,
                  })
                  await complianceQuery.refetch()
                }}
              />
            )}
          </div>
        </div>
      </div>
      {bajaModalOpen && (
        <BajaReasonModal
          label={`equipo ${asset.license_plate}`}
          onClose={() => setBajaModalOpen(false)}
          onConfirm={handleDeactivate}
        />
      )}
    </>
  )
}
