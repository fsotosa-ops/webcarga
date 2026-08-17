'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Loader2, Check, RotateCcw, ClipboardList, ShieldAlert, Search,
  FileWarning, AlertTriangle, User, MapPin, ChevronLeft, ChevronRight,
} from 'lucide-react'
import type { Trip, TripsMeta } from '@/lib/types'
import { tripsApi, type TripPatch } from '@/lib/api/trips'
import { driversApi } from '@/lib/api/drivers'
import { fmtDT, fmtDate } from '@/lib/utils/datetime'
import { IndicatorSwitches } from './IndicatorSwitches'
import { FleetAssignSection, EMPTY_FLEET_ASSIGN_VALUE, type FleetAssignValue } from './FleetAssignSection'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { OperationTypeBadge } from '@/components/ui/OperationTypeBadge'
import { InsuranceAlertBadge } from '@/components/ui/InsuranceAlertBadge'
import { PendingDocsBadge } from '@/components/ui/PendingDocsBadge'

// Movido de TripSlideOver.tsx — único consumidor.
function MetaField({
  label, value, highlight = false,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div>
      <p className="text-etiqueta font-bold text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
      <p className={`text-dato leading-snug ${highlight ? 'font-semibold text-accent' : 'text-text-primary'}`}>
        {value}
      </p>
    </div>
  )
}

interface Props {
  trip:    Trip
  meta?:   TripsMeta | null
  onSaved: (updated: Trip) => void
}

export function GestionPanel({ trip, meta, onSaved }: Props) {
  const [collapsed, setCollapsed]               = useState(false)
  const [estadoDraft, setEstadoDraft]           = useState('')
  const [saving, setSaving]                     = useState(false)
  const [err, setErr]                           = useState<string | null>(null)
  const [showEstadoSelect, setShowEstadoSelect] = useState(false)
  const [clearingOverride, setClearingOverride] = useState(false)
  const [reasonSaving, setReasonSaving]         = useState(false)
  const [unlinkErr, setUnlinkErr]               = useState<string | null>(null)
  const [unlinking, setUnlinking]               = useState(false)
  const [fleetDraft, setFleetDraft]             = useState<FleetAssignValue>(EMPTY_FLEET_ASSIGN_VALUE)
  const [assigningFleet, setAssigningFleet]     = useState(false)
  const [fleetErr, setFleetErr]                 = useState<string | null>(null)

  const fuzzyMatchQuery = useQuery({
    queryKey: ['drivers', 'fuzzy-match', trip.id, trip.driver_name_tms],
    queryFn: () => driversApi.fuzzyMatch(trip.driver_name_tms!),
    enabled: !trip.carrier_id && !!trip.driver_name_tms,
  })

  // Mismo criterio que TripSlideOver.tsx: resetear drafts cuando cambia el
  // viaje, no en cada render.
  useEffect(() => {
    setEstadoDraft('')
    setErr(null)
    setShowEstadoSelect(false)
    setUnlinkErr(null)
    setFleetDraft(EMPTY_FLEET_ASSIGN_VALUE)
    setFleetErr(null)
  }, [trip.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // `collapsed` también resetea a expandido en cada viaje nuevo — decisión
  // explícita (brainstorming 2026-07-29): "expandido por defecto con botón
  // para colapsar", sin persistencia entre viajes (sin localStorage).
  useEffect(() => { setCollapsed(false) }, [trip.id])

  async function handleSetOverride() {
    if (!estadoDraft) return
    setSaving(true)
    setErr(null)
    try {
      const updated = await tripsApi.patch(trip.id, { manual_status: estadoDraft } as TripPatch)
      onSaved(updated)
      setShowEstadoSelect(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleClearOverride() {
    setClearingOverride(true)
    try {
      await tripsApi.resetField(trip.id, 'manual_status')
      onSaved({ ...trip, manual_status: null })
      setEstadoDraft('')
      setShowEstadoSelect(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al revertir')
    } finally {
      setClearingOverride(false)
    }
  }

  async function handleUnlink() {
    setUnlinking(true); setUnlinkErr(null)
    try {
      await tripsApi.removeFleetLink(trip.id)
      onSaved({ ...trip, carrier_id: null, fleet_link_id: null })
      setFleetDraft(EMPTY_FLEET_ASSIGN_VALUE)
    } catch (e) {
      setUnlinkErr(e instanceof Error ? e.message : 'Error al desvincular')
    } finally {
      setUnlinking(false)
    }
  }

  async function handleAssignFleet() {
    if (!fleetDraft.carrier_id) return
    setAssigningFleet(true); setFleetErr(null)
    try {
      const updated = await tripsApi.assignFleetLink(trip.id, {
        carrier_id:       fleetDraft.carrier_id,
        driver_id:        fleetDraft.driver_id ?? undefined,
        tractor_asset_id: fleetDraft.tractor_asset_id ?? undefined,
        driver_name:      fleetDraft.driver_name ?? undefined,
        tractor_plate:    fleetDraft.tractor_plate ?? undefined,
      })
      onSaved(updated)
      setFleetDraft(EMPTY_FLEET_ASSIGN_VALUE)
    } catch (e) {
      setFleetErr(e instanceof Error ? e.message : 'Error al vincular')
    } finally {
      setAssigningFleet(false)
    }
  }

  const driverDiverges  = !!(trip.driver_name_tms && trip.driver_name_tms !== trip.driver_name)
  const tractorDiverges = !!(trip.tractor_plate_tms && trip.tractor_plate_tms !== trip.tractor_plate)
  const carrierDiverges = !!(trip.carrier_name_tms && trip.carrier_name_tms !== trip.carrier_name)
  const hasReconciliationDivergence = !!trip.fleet_link_id && (driverDiverges || tractorDiverges || carrierDiverges)

  const empresasHandoffHref = (() => {
    const params = new URLSearchParams({ create: '1' })
    if (trip.carrier_name_tms)  params.set('business_name', trip.carrier_name_tms)
    if (trip.driver_name_tms)   params.set('driver_name', trip.driver_name_tms)
    const plateTms = trip.tractor_plate_tms ?? trip.tractor_plate
    if (plateTms) params.set('tractor_plate', plateTms)
    return `/dashboard/carriers?${params.toString()}`
  })()

  return (
    <aside
      className={`order-1 md:order-2 shrink-0 md:overflow-y-auto md:border-l border-border bg-accent/[0.03] transition-[width] duration-200 ease-out ${collapsed ? 'md:w-[56px]' : 'md:w-[360px]'}`}
    >
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        title={collapsed ? 'Expandir Gestión' : 'Colapsar Gestión'}
        className="flex items-center justify-center w-full h-10 text-accent hover:bg-accent/10 transition-colors"
      >
        {collapsed ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
      </button>

      {collapsed ? (
        <div className="flex flex-col items-center gap-3 pt-2">
          <ClipboardList size={14} className="text-accent" />
        </div>
      ) : (
      <div className="p-4 md:p-5 space-y-5">
        <h4 className="text-etiqueta font-bold text-accent uppercase tracking-widest flex items-center gap-1.5">
          <ClipboardList size={11} /> Gestión
        </h4>

        {/* Estado operativo */}
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className="text-etiqueta text-gray-400">TMS reporta:</span>
            <StatusBadge status={trip.current_status} meta={meta} />
          </div>

          {trip.manual_status ? (
            <div className="flex items-center gap-2 flex-wrap">
              {(() => {
                const opState = meta?.operational_states.find(s => s.id === trip.manual_status)
                const label = opState?.label ?? trip.manual_status
                return (
                  <span
                    className="inline-flex px-2.5 py-1 rounded-full text-etiqueta font-semibold"
                    style={opState
                      ? { backgroundColor: opState.bg_color, color: opState.text_color }
                      : { backgroundColor: '#f3f4f6', color: '#6b7280' }}
                  >
                    {label}
                  </span>
                )
              })()}
              <span className="text-etiqueta text-gray-400">
                confirmado manualmente {trip.edited_by ? `por ${trip.edited_by} ` : ''}el {fmtDT(trip.edited_at)}
              </span>
              <button
                type="button"
                title="Revertir a valor del TMS"
                onClick={handleClearOverride}
                disabled={clearingOverride}
                className="text-gray-400 hover:text-accent transition-colors disabled:opacity-50"
              >
                {clearingOverride ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
              </button>
            </div>
          ) : showEstadoSelect ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              <select
                autoFocus
                value={estadoDraft}
                onChange={e => setEstadoDraft(e.target.value)}
                className="text-dato border border-border rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/30"
              >
                <option value="">— Seleccionar estado…</option>
                {(meta?.operational_states ?? []).map(s => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
              <button type="button" onClick={handleSetOverride} disabled={saving || !estadoDraft}
                className="p-1.5 text-accent disabled:opacity-40">
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              </button>
              <button type="button" onClick={() => { setShowEstadoSelect(false); setEstadoDraft('') }}
                className="text-etiqueta text-gray-400 hover:text-gray-500">
                Cancelar
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setShowEstadoSelect(true)}
                className="text-dato text-accent hover:text-accent/80 transition-colors"
              >
                + Establecer estado operativo manual
              </button>
              <p className="text-etiqueta text-gray-400 mt-1">
                Es el mismo estado que se muestra en el encabezado — aquí puedes confirmarlo manualmente si hace falta.
              </p>
            </>
          )}

          {err && (
            <p className="text-dato text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mt-2">{err}</p>
          )}
        </div>

        {/* Indicadores — switches con etiqueta completa */}
        <div>
          <p className="text-etiqueta font-bold text-gray-400 uppercase tracking-wide mb-2">Indicadores</p>
          <IndicatorSwitches trip={trip} onSaved={onSaved} />
        </div>

        {/* Motivo de no asignación */}
        {!trip.is_assigned && (meta?.unassigned_reasons?.length ?? 0) > 0 && (
          <div>
            <p className="text-etiqueta font-bold text-gray-400 uppercase tracking-wide mb-1.5">Motivo de no asignación</p>
            <select
              value={trip.unassigned_reason_id ?? ''}
              disabled={reasonSaving}
              onChange={async e => {
                const value = e.target.value
                setReasonSaving(true)
                try {
                  const updated = await tripsApi.patch(trip.id, { unassigned_reason_id: value } as TripPatch)
                  onSaved(updated)
                } catch {
                  // best-effort — el select vuelve al valor real del trip en el próximo render
                } finally {
                  setReasonSaving(false)
                }
              }}
              className="w-full text-dato border border-border rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/30"
            >
              <option value="">— Sin especificar —</option>
              {meta!.unassigned_reasons.map(r => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Conductor y flota — driver-first */}
        <div>
          <p className="text-etiqueta font-bold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1">
            <User size={10} /> Conductor y flota
          </p>
          {trip.carrier_id ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between bg-white rounded-lg px-3 py-2.5 border border-border/80 shadow-sm">
                <div className="min-w-0 flex items-center gap-2 flex-wrap">
                  <p className="text-dato font-semibold text-text-primary truncate">{trip.carrier_name ?? '—'}</p>
                  <InsuranceAlertBadge alert={trip.insurance_alert} />
                  <PendingDocsBadge count={trip.carrier_pending_docs} critical={trip.carrier_pending_docs_critical} label="Empresa" />
                  <PendingDocsBadge count={trip.driver_pending_docs} critical={trip.driver_pending_docs_critical} label="Conductor" />
                  <PendingDocsBadge count={trip.tractor_pending_docs} critical={trip.tractor_pending_docs_critical} label="Tracto" />
                </div>
                <button
                  type="button"
                  disabled={unlinking}
                  onClick={handleUnlink}
                  className="text-etiqueta text-gray-400 hover:text-red-400 transition-colors disabled:opacity-50 shrink-0 ml-2"
                >
                  {unlinking ? <Loader2 size={12} className="animate-spin" /> : 'Desvincular'}
                </button>
              </div>
              {unlinkErr && <p className="text-dato text-red-500 mt-1">{unlinkErr}</p>}
              {(trip.insurance_alert === 'EXPIRED' || trip.insurance_alert === 'OVERDUE_INSTALLMENTS') && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2">
                  <ShieldAlert size={13} className="text-red-600 shrink-0" />
                  <p className="text-etiqueta text-red-700 font-medium">
                    {trip.insurance_alert === 'EXPIRED' ? 'Póliza vencida para esta empresa — ' : 'Cuotas críticas impagas para esta empresa — '}
                    <a href={`/dashboard/carriers/${trip.carrier_id}?tab=seguros`} className="underline hover:text-red-900">
                      revisar en Seguros
                    </a>.
                  </p>
                </div>
              )}
              {trip.driver_pending_docs_critical && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2">
                  <FileWarning size={13} className="text-red-600 shrink-0" />
                  <p className="text-etiqueta text-red-700 font-medium">
                    Falta Licencia de Conducir o Carnet del conductor —{' '}
                    <a href={`/dashboard/carriers/${trip.carrier_id}?tab=conductores`} className="underline hover:text-red-900">
                      revisar en Empresas
                    </a>.
                  </p>
                </div>
              )}
              {trip.fleet_match_status === 'MISMATCH' && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1">
                  <p className="text-etiqueta text-amber-700">
                    El conductor pertenece a <span className="font-semibold">{trip.fleet_match_driver_home_carrier}</span>, distinta de la empresa de este viaje —{' '}
                    <a href={`/dashboard/carriers/${trip.carrier_id}?tab=conductores`} className="underline hover:text-amber-900">
                      revisar en Empresas
                    </a>.
                  </p>
                </div>
              )}
              {hasReconciliationDivergence && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1">
                  {carrierDiverges && (
                    <p className="text-etiqueta text-amber-700">
                      TMS reporta empresa: <span className="font-semibold">{trip.carrier_name_tms}</span>
                    </p>
                  )}
                  {driverDiverges && (
                    <p className="text-etiqueta text-amber-700">
                      TMS reporta conductor: <span className="font-semibold">{trip.driver_name_tms}</span>
                    </p>
                  )}
                  {tractorDiverges && (
                    <p className="text-etiqueta text-amber-700">
                      TMS reporta patente: <span className="font-semibold">{trip.tractor_plate_tms}</span>
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={unlinking}
                    onClick={handleUnlink}
                    className="text-etiqueta font-semibold text-amber-700 hover:text-amber-900 underline disabled:opacity-50"
                  >
                    {unlinking ? 'Revirtiendo…' : 'Usar dato del TMS'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {trip.fleet_match_status === 'UNMATCHED' && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-2">
                  <AlertTriangle size={13} className="text-amber-600 shrink-0" />
                  <p className="text-etiqueta text-amber-700 font-medium">Sin identificar — sin cruce contra ninguna empresa todavía.</p>
                </div>
              )}
              {trip.driver_name_tms && (
                <p className="text-etiqueta text-gray-400">
                  TMS reportó: <span className="font-semibold text-gray-500">{trip.driver_name_tms}</span>
                </p>
              )}
              <FleetAssignSection
                value={fleetDraft}
                onChange={setFleetDraft}
                size="sm"
                suggested={fuzzyMatchQuery.data ?? []}
                suggestedLabel="Posibles coincidencias (nombre TMS)"
                notFoundHint={
                  <p className="text-etiqueta text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-2">
                    Si no aparece en la lista, hay que darlo de alta primero en{' '}
                    <a href={empresasHandoffHref} className="underline font-semibold">Empresas</a>.
                  </p>
                }
              />
              {trip.driver_name_tms && !fuzzyMatchQuery.isLoading && (fuzzyMatchQuery.data?.length ?? 0) === 0 && (
                <a
                  href={empresasHandoffHref}
                  className="flex items-center gap-1.5 text-etiqueta font-semibold text-accent hover:underline"
                >
                  <Search size={11} /> Sin coincidencias — dar de alta empresa/conductor/equipo
                </a>
              )}
              {fleetDraft.driver_id && (
                <button
                  type="button"
                  disabled={assigningFleet || !fleetDraft.carrier_id}
                  onClick={handleAssignFleet}
                  className="w-full text-dato font-semibold bg-accent text-white rounded-lg py-1.5 hover:bg-accent/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {assigningFleet ? <Loader2 size={12} className="animate-spin" /> : 'Vincular'}
                </button>
              )}
              {fleetErr && <p className="text-etiqueta text-red-500">{fleetErr}</p>}
            </div>
          )}
        </div>

        {/* Ubicación de origen — solo operation_type */}
        <div>
          <p className="text-etiqueta font-bold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <MapPin size={10} /> Ubicación de origen
          </p>
          {trip.origin_operation_type ? (
            <OperationTypeBadge operationType={trip.origin_operation_type} meta={meta} size="md" />
          ) : (
            <span className="text-etiqueta text-gray-400">Sin clasificar</span>
          )}
        </div>

        {/* Datos operativos */}
        <div>
          <p className="text-etiqueta font-bold text-gray-400 uppercase tracking-wide mb-2">Datos operativos</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
            <MetaField label="Fecha planificación" value={fmtDate(trip.planning_date)} />
            <MetaField label="Tipo carga" value={trip.cargo_type ?? '—'} />
            {trip.milestone_status && (
              <MetaField label="Estado cumplimiento" value={trip.milestone_status} highlight />
            )}
          </div>
        </div>
      </div>
      )}
    </aside>
  )
}
