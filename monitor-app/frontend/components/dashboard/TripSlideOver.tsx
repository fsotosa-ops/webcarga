'use client'

import { useState, useEffect, useRef } from 'react'
import {
  X, Loader2, Copy, Check,
  Truck, User, Phone, Hash,
  MapPin, RotateCcw, ClipboardList,
} from 'lucide-react'
import type { Trip, TripsMeta } from '@/lib/types'
import { tripsApi, type TripPatch } from '@/lib/api/trips'
import { getLatestTemp, stopWasVisited, classifyTemperature, getActiveStop, describeStopTiming } from '@/lib/utils/temperature'
import { stopComplianceSummary } from '@/lib/utils/compliance'
import { fmtDT, fmtDate, formatRelativeTime, toDatetimeLocalValue } from '@/lib/utils/datetime'
import { TMS_LOGIN_URLS } from '@/lib/utils/tmsLinks'
import { StopTimeline } from './StopTimeline'
import { IndicatorSwitches } from './IndicatorSwitches'
import { TripNotesFeed } from './TripNotesFeed'
import { useTripNotes } from '@/hooks/useTripNotes'
import { FleetAssignSection, EMPTY_FLEET_ASSIGN_VALUE, type FleetAssignValue } from './FleetAssignSection'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { OperationTypeBadge } from '@/components/ui/OperationTypeBadge'

// ── MetaField helper ──────────────────────────────────────────────────────────

function MetaField({
  label, value, highlight = false,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div>
      <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
      <p className={`text-xs leading-snug ${highlight ? 'font-semibold text-accent' : 'text-slate-700'}`}>
        {value}
      </p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  trip:    Trip | null
  onClose: () => void
  onSaved: (updated: Trip) => void
  meta?:   TripsMeta | null
}

export function TripSlideOver({ trip, onClose, onSaved, meta }: Props) {
  const [estadoDraft, setEstadoDraft]           = useState('')
  const [saving, setSaving]                     = useState(false)
  const [err, setErr]                           = useState<string | null>(null)
  const [copiedField, setCopiedField]           = useState<'external' | 'internal' | null>(null)
  const [showEstadoSelect, setShowEstadoSelect] = useState(false)
  const [clearingOverride, setClearingOverride] = useState(false)
  const [reasonSaving, setReasonSaving]         = useState(false)
  const [unlinkErr, setUnlinkErr]               = useState<string | null>(null)
  const [unlinking, setUnlinking]               = useState(false)
  // Conductor→empresa/vehículo (FleetAssignSection, driver-first) — solo
  // importa mientras el viaje no tiene carrier_id (rama "vincular"); la rama
  // "ya vinculado" muestra una tarjeta compacta aparte, sin usar este draft.
  const [fleetDraft, setFleetDraft]             = useState<FleetAssignValue>(EMPTY_FLEET_ASSIGN_VALUE)
  const [assigningFleet, setAssigningFleet]     = useState(false)
  const [fleetErr, setFleetErr]                 = useState<string | null>(null)
  const panelRef                                = useRef<HTMLDivElement>(null)
  // Badge de incidentes abiertos en el hero (Fase 2, Plan 5) — mismo hook
  // que ya usa TripNotesFeed internamente; TanStack Query dedupea por
  // queryKey (['trip-notes', tripId]), así que esto no dispara una segunda
  // request, comparte la misma cache/carga.
  const notesQuery = useTripNotes(trip?.id ?? null)

  // Semántica de diálogo: Escape cierra, Tab queda atrapado en el panel, el foco vuelve al origen al cerrar
  useEffect(() => {
    if (!trip) return
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
  }, [trip?.id, onClose]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!trip) return
    setEstadoDraft('')
    setErr(null)
    setCopiedField(null)
    setShowEstadoSelect(false)
    setUnlinkErr(null)
    setFleetDraft(EMPTY_FLEET_ASSIGN_VALUE)
    setFleetErr(null)
  }, [trip?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Desc. Inicio/Fin (esquema de fechas 2026-07-17): override manual de lo
  // que reporta el TMS por parada — incluye el origen desde que se unificó
  // como parada 0 (Fase 1, 2026-07-18; antes vivía aparte como
  // trip.cag_inicio_at/cag_fin_at, "Carga Inicio/Fin"). Guardado directo al
  // cambiar, sin botón aparte — mismo patrón que onExpirationChange en
  // DocumentChecklist.
  const [stopSaving, setStopSaving] = useState<string | null>(null)

  async function handleStopFieldChange(stopId: string, field: 'desc_inicio' | 'desc_fin', value: string) {
    if (!trip) return
    setStopSaving(stopId)
    try {
      const updated = await tripsApi.patchStop(trip.id, stopId, { [field]: value })
      onSaved(updated)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setStopSaving(null)
    }
  }

  async function handleSetOverride() {
    if (!trip || !estadoDraft) return
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
    if (!trip) return
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

  function handleCopy(field: 'external' | 'internal', value: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 2000)
    })
  }

  async function handleUnlink() {
    if (!trip) return
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
    if (!trip || !fleetDraft.carrier_id) return
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

  if (!trip) return null

  const currentStatus = trip.manual_status ?? trip.current_status
  const tmsMeta       = trip.source_system ? meta?.tms_sources.find(t => t.id === trip.source_system.toLowerCase()) : null
  const tmsLabel      = tmsMeta?.label ?? trip.source_system?.toUpperCase().slice(0, 3) ?? '?'
  const tmsLoginUrl   = trip.source_system && trip.source_system !== 'manual' ? TMS_LOGIN_URLS[trip.source_system.toLowerCase()] : undefined
  const temp          = getLatestTemp(trip.stops ?? [])
  const tempStatus    = classifyTemperature(temp, trip.cargo_type, meta?.temperature_ranges ?? [])

  // Hero: la historia del viaje de un vistazo. `stops` incluye el origen
  // (Fase 1, 2026-07-18) — se pasa completo al timeline (ahí SÍ tiene que
  // aparecer como nodo 0), pero el conteo "N/M paradas" usa solo destinos:
  // "parada" en el vocabulario del equipo operativo significa destino de
  // entrega, no el punto de carga.
  const stops            = trip.stops ?? []
  const destinationStops = stops.filter(s => s.stop_type !== 'ORIGIN')
  const openIncidents    = (notesQuery.data ?? []).filter(n => n.note_type === 'incidente' && !n.resolved_at).length
  const activeStop  = getActiveStop(stops)
  const activeTiming = activeStop ? describeStopTiming(activeStop) : null
  const doneCount   = destinationStops.filter(s => s.arrival_date || s.gps_arrival_date || s.on_time_status).length
  const compliance  = stopComplianceSummary(stops)
  const tmsSince    = formatRelativeTime(trip.status_reported_at)
  const syncSince   = formatRelativeTime(trip.pipeline_updated_at)

  // Reconciliación TMS↔manual (Fase 1.5b, extendida a empresa en Fase 2 Plan
  // 4): si hay vínculo manual y el TMS reporta conductor/patente/empresa
  // distinta a lo vinculado, avisar y ofrecer revertir — nunca sobrescribir
  // automáticamente. EETT TMS (antes en "Datos operativos") se retiró porque
  // esta es la única función real que cumplía: detectar cuándo la empresa
  // vinculada diverge de lo que reporta la TMS.
  const driverDiverges  = !!(trip.driver_name_tms && trip.driver_name_tms !== trip.driver_name)
  const tractorDiverges = !!(trip.tractor_plate_tms && trip.tractor_plate_tms !== trip.tractor_plate)
  const carrierDiverges = !!(trip.carrier_name_tms && trip.carrier_name_tms !== trip.carrier_name)
  const hasReconciliationDivergence = !!trip.fleet_link_id && (driverDiverges || tractorDiverges || carrierDiverges)

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40 animate-backdrop-in" onClick={onClose} aria-hidden="true" />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Detalle de viaje ${trip.source_system_trip_id ?? trip.tractor_plate ?? ''}`}
        tabIndex={-1}
        className="fixed inset-0 z-50 flex flex-col bg-white
                      md:inset-4
                      md:rounded-2xl md:shadow-2xl overflow-hidden focus:outline-none animate-modal-in"
      >

        {/* ── Header — 1 fila compacta: identidad del viaje ─────────── */}
        <div className="bg-slate-900 px-4 py-2.5 md:px-6 shrink-0 flex items-center gap-3 flex-wrap">
          {tmsLoginUrl ? (
            <a
              href={tmsLoginUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={`Abrir en ${tmsMeta?.label ?? tmsLabel}`}
              className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 hover:opacity-80 transition-opacity"
              style={tmsMeta
                ? { backgroundColor: tmsMeta.bg_color, color: tmsMeta.text_color }
                : { backgroundColor: '#334155', color: '#94a3b8' }}
            >
              {tmsLabel}
            </a>
          ) : (
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
              style={tmsMeta
                ? { backgroundColor: tmsMeta.bg_color, color: tmsMeta.text_color }
                : { backgroundColor: '#334155', color: '#94a3b8' }}
            >
              {tmsLabel}
            </span>
          )}

          {/* IDs unificados: externo (con copiar, ya existía) + interno
              (con copiar, antes vivía solo — casi invisible — en un footer
              que ya no existe) — un solo lugar para "los IDs de este viaje". */}
          {trip.source_system_trip_id && (
            <span className="flex items-center gap-1.5 min-w-0">
              <Hash size={11} className="text-white/40 shrink-0" />
              <span className="font-mono text-xs text-white/60 truncate">{trip.source_system_trip_id}</span>
              <button
                type="button"
                onClick={() => handleCopy('external', trip.source_system_trip_id!)}
                title="Copiar ID externo"
                className="text-white/40 hover:text-white/80 transition-colors shrink-0"
              >
                {copiedField === 'external' ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
              </button>
            </span>
          )}
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="font-mono text-[10px] text-white/30 truncate">{trip.id}</span>
            <button
              type="button"
              onClick={() => handleCopy('internal', trip.id)}
              title="Copiar ID interno"
              className="text-white/40 hover:text-white/80 transition-colors shrink-0"
            >
              {copiedField === 'internal' ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
            </button>
          </span>

          <span className="flex items-center gap-1.5 shrink-0">
            <Truck size={13} className="text-white/40" />
            <span className="font-mono text-sm font-bold text-white">
              {trip.tractor_plate ?? trip.trailer_plate ?? 'Sin patente'}
            </span>
            {trip.tractor_plate && trip.trailer_plate && (
              <span className="font-mono text-[11px] text-white/40">/ {trip.trailer_plate}</span>
            )}
          </span>

          <span className="flex items-center gap-1.5 min-w-0">
            <User size={11} className="text-white/40 shrink-0" />
            <span className="text-xs text-white/80 truncate">{trip.driver_name ?? '—'}</span>
          </span>

          {trip.driver_phone && (
            <a
              href={`tel:${trip.driver_phone}`}
              className="flex items-center gap-1 text-[11px] font-mono text-accent/80 hover:text-accent shrink-0"
              onClick={e => e.stopPropagation()}
            >
              <Phone size={10} />
              {trip.driver_phone}
            </a>
          )}

          {trip.client_name && (
            <span className="text-[11px] text-white/35 truncate hidden sm:inline">· {trip.client_name}</span>
          )}

          <button
            onClick={onClose}
            className="text-white/50 hover:text-white transition-colors shrink-0 p-1 rounded-lg hover:bg-white/10 ml-auto"
            aria-label="Cerrar detalle"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Hero — la historia del viaje ──────────────────────────── */}
        <div data-testid="hero" className="px-4 py-3 md:px-6 border-b border-border bg-gray-50/80 shrink-0 space-y-2">
          <div className="flex items-center gap-2.5 flex-wrap">
            <StatusBadge status={currentStatus} meta={meta} size="md" fallbackLabel="Sin estado" />
            {trip.manual_status && (
              <span className="text-[9px] font-semibold text-accent bg-accent/10 px-1.5 py-0.5 rounded-full">manual</span>
            )}
            {activeStop && (
              <span className="text-sm text-slate-700 min-w-0">
                <span className="text-gray-400">→</span>{' '}
                <span className="font-semibold">{activeStop.local ?? activeStop.destination_city ?? 'próxima parada'}</span>
                {activeTiming && <span className="text-gray-500"> · {activeTiming}</span>}
              </span>
            )}
            {!activeStop && stops.length === 0 && (
              <span className="text-sm text-gray-400">Sin paradas registradas</span>
            )}
          </div>

          {/* Gestión por excepción: solo se badgea lo que está mal (OFF TIME,
              temp fuera de rango) — lo demás es texto plano discreto. La
              barra de puntos RouteProgress se retiró (Fase 2, Plan 4) — era
              la 3ª representación de la misma secuencia de paradas junto a
              StopTimeline (Ruta) y la tabla técnica; este texto ya comunica
              el vistazo rápido sin un gráfico aparte. */}
          <div className="flex items-center gap-2.5 flex-wrap text-[11px] text-gray-500">
            {destinationStops.length > 0 && (
              <span>{doneCount}/{destinationStops.length} paradas</span>
            )}
            {compliance === 'warn' && (
              <span className="font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full text-[10px]">OFF TIME</span>
            )}
            {openIncidents > 0 && (
              <span className="font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full text-[10px]">
                {openIncidents} incidente{openIncidents === 1 ? '' : 's'} abierto{openIncidents === 1 ? '' : 's'}
              </span>
            )}
            {temp != null && (
              tempStatus === 'out_of_range'
                ? <span className="font-semibold px-1.5 py-0.5 rounded-full text-[10px] bg-red-50 text-red-700">{temp}°C</span>
                : <span>{temp}°C</span>
            )}
            <span className="text-gray-400">
              TMS reportó {tmsSince}{syncSince !== '—' ? ` · sync ${syncSince}` : ''}
            </span>
            {trip.created_at && (
              <span className="text-gray-400">· en el Diario desde {fmtDT(trip.created_at)}</span>
            )}
          </div>
        </div>

        {/* ── Body — 2 columnas en desktop, apilado en mobile (Gestión primero) ── */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden">

          {/* Columna derecha en desktop / primera en mobile: GESTIÓN */}
          <aside className="order-1 md:order-2 md:w-[360px] md:shrink-0 md:overflow-y-auto md:border-l border-border bg-accent/[0.03] p-4 md:p-5 space-y-5">
            <h4 className="text-[10px] font-bold text-accent uppercase tracking-widest flex items-center gap-1.5">
              <ClipboardList size={11} /> Gestión
            </h4>

            {/* Estado operativo */}
            <div>
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                <span className="text-[9px] text-gray-400">TMS reporta:</span>
                <StatusBadge status={trip.current_status} meta={meta} />
              </div>

              {trip.manual_status ? (
                <div className="flex items-center gap-2 flex-wrap">
                  {(() => {
                    const opState = meta?.operational_states.find(s => s.id === trip.manual_status)
                    const label = opState?.label ?? trip.manual_status
                    return (
                      <span
                        className="inline-flex px-2.5 py-1 rounded-full text-[11px] font-semibold"
                        style={opState
                          ? { backgroundColor: opState.bg_color, color: opState.text_color }
                          : { backgroundColor: '#f3f4f6', color: '#6b7280' }}
                      >
                        {label}
                      </span>
                    )
                  })()}
                  <span className="text-[10px] text-gray-400">
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
                    className="text-xs border border-border rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/30"
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
                    className="text-[10px] text-gray-400 hover:text-gray-600">
                    Cancelar
                  </button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setShowEstadoSelect(true)}
                    className="text-xs text-accent hover:text-accent/80 transition-colors"
                  >
                    + Establecer estado operativo manual
                  </button>
                  {/* Microcopy (Fase 2, Plan 4): sin override, este badge y el
                      del hero muestran el mismo dato — antes no había nada
                      que lo explicara. */}
                  <p className="text-[9px] text-gray-400 mt-1">
                    Es el mismo estado que se muestra en el encabezado — acá podés confirmarlo manualmente si hace falta.
                  </p>
                </>
              )}

              {err && (
                <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mt-2">{err}</p>
              )}
            </div>

            {/* Indicadores — switches con etiqueta completa (Fase 2, Plan 5) */}
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Indicadores</p>
              <IndicatorSwitches trip={trip} onSaved={onSaved} />
            </div>

            {/* Motivo de no asignación — movido después de Indicadores (Fase
                2, Plan 4): es el mismo concepto causal que el switch
                "Asignado" de arriba, antes vivían en bloques sin relación
                visual. Catálogo editable en app.unassigned_reasons. */}
            {!trip.is_assigned && (meta?.unassigned_reasons?.length ?? 0) > 0 && (
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Motivo de no asignación</p>
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
                  className="w-full text-xs border border-border rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/30"
                >
                  <option value="">— Sin especificar —</option>
                  {meta!.unassigned_reasons.map(r => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Conductor y flota — driver-first (Fase 2, Plan 4). Antes
                "Empresa transportista" con CarrierAssignSection (búsqueda
                de empresa primero, roster de conductor/tracto en
                dropdowns) — mismo bug de fondo que motivó toda esta Fase:
                una superficie de búsqueda propia en vez de reusar
                DriverSearchPicker. Ahora FleetAssignSection (compartido con
                TripAssignDialog, Plan 3) cubre la búsqueda + autocompletado
                editable; "Vincular" solo llama a la API cuando el operador
                confirma. */}
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1">
                <User size={10} /> Conductor y flota
              </p>
              {trip.carrier_id ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between bg-white rounded-lg px-3 py-2.5 border border-border/80 shadow-sm">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-800 truncate">{trip.carrier_name ?? '—'}</p>
                    </div>
                    <button
                      type="button"
                      disabled={unlinking}
                      onClick={handleUnlink}
                      className="text-[11px] text-gray-400 hover:text-red-400 transition-colors disabled:opacity-50 shrink-0 ml-2"
                    >
                      {unlinking ? <Loader2 size={12} className="animate-spin" /> : 'Desvincular'}
                    </button>
                  </div>
                  {unlinkErr && <p className="text-xs text-red-500 mt-1">{unlinkErr}</p>}
                  {/* HU-04 (Fase 0): conductor y tracto calzan cada uno por su
                      lado pero bajo empresas distintas — regla de Pablo
                      (reunión 20/07): ambos deben pertenecer a la misma
                      empresa. Solo informativo acá; la resolución (transferir
                      conductor o tracto) se hace en el módulo Empresas. */}
                  {trip.fleet_match_status === 'MISMATCH' && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1">
                      <p className="text-[10px] text-amber-700">
                        El conductor pertenece a <span className="font-semibold">{trip.fleet_match_driver_home_carrier}</span>, distinta de la empresa de este viaje — revisar en Empresas.
                      </p>
                    </div>
                  )}
                  {hasReconciliationDivergence && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1">
                      {carrierDiverges && (
                        <p className="text-[10px] text-amber-700">
                          TMS reporta empresa: <span className="font-semibold">{trip.carrier_name_tms}</span>
                        </p>
                      )}
                      {driverDiverges && (
                        <p className="text-[10px] text-amber-700">
                          TMS reporta conductor: <span className="font-semibold">{trip.driver_name_tms}</span>
                        </p>
                      )}
                      {tractorDiverges && (
                        <p className="text-[10px] text-amber-700">
                          TMS reporta patente: <span className="font-semibold">{trip.tractor_plate_tms}</span>
                        </p>
                      )}
                      <button
                        type="button"
                        disabled={unlinking}
                        onClick={handleUnlink}
                        className="text-[10px] font-semibold text-amber-700 hover:text-amber-900 underline disabled:opacity-50"
                      >
                        {unlinking ? 'Revirtiendo…' : 'Usar dato del TMS'}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <FleetAssignSection
                    value={fleetDraft}
                    onChange={setFleetDraft}
                    size="sm"
                    notFoundHint={
                      <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-2">
                        Si no aparece en la lista, hay que darlo de alta primero en{' '}
                        <a href="/dashboard/transportistas" className="underline font-semibold">Empresas</a>.
                      </p>
                    }
                  />
                  {fleetDraft.driver_id && (
                    <button
                      type="button"
                      disabled={assigningFleet || !fleetDraft.carrier_id}
                      onClick={handleAssignFleet}
                      className="w-full text-xs font-semibold bg-accent text-white rounded-lg py-1.5 hover:bg-accent/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      {assigningFleet ? <Loader2 size={12} className="animate-spin" /> : 'Vincular'}
                    </button>
                  )}
                  {fleetErr && <p className="text-[11px] text-red-500">{fleetErr}</p>}
                </div>
              )}
            </div>

            {/* Ubicación de origen — solo operation_type (Fase 2, Plan 4).
                Región/ciudad (RegionCityPicker) se retiró por completo:
                origin_operation_type es el dato real/automático, la
                asignación manual de respaldo competía visualmente con él
                sin aportar. "Sin clasificar" explícito en vez de una
                sección vacía cuando OperationTypeBadge no tiene nada que
                mostrar (retorna null si operationType es falsy). */}
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <MapPin size={10} /> Ubicación de origen
              </p>
              {trip.origin_operation_type ? (
                <OperationTypeBadge operationType={trip.origin_operation_type} meta={meta} size="md" />
              ) : (
                <span className="text-[11px] text-gray-400">Sin clasificar</span>
              )}
            </div>

            {/* Datos operativos — antes acordeón colapsado en la columna
                principal (Fase 2, Plan 4): se aplana y se muda acá, es la
                sección que menos ancho horizontal necesita. EETT TMS se
                retira — su única función real (divergencia de empresa) la
                cubre ahora el banner de reconciliación de arriba. */}
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Datos operativos</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                <MetaField label="Fecha planificación" value={fmtDate(trip.planning_date)} />
                <MetaField label="Tipo carga" value={trip.cargo_type ?? '—'} />
                {trip.milestone_status && (
                  <MetaField label="Estado cumplimiento" value={trip.milestone_status} highlight />
                )}
              </div>
            </div>
          </aside>

          {/* Columna izquierda en desktop / segunda en mobile: RUTA + BITÁCORA */}
          <div className="order-2 md:order-1 flex-1 min-w-0 md:overflow-y-auto p-4 md:p-6 space-y-5">
            {stops.length > 0 && (
              <section>
                <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <MapPin size={11} /> Ruta ({stops.length} parada{stops.length === 1 ? '' : 's'})
                </h4>
                <StopTimeline stops={stops} />

                {/* Tabla técnica — siempre visible (Fase 2, Plan 4: acordeón
                    "Ver detalle técnico" retirado). No se reemplaza por
                    RouteEditor (el de creación): no existe endpoint para
                    agregar/quitar/renombrar paradas de un viaje ya
                    existente, y el timeline GPS/SAP es exclusivo del
                    detalle por diseño (decisión #2 del spec). */}
                <div className="overflow-x-auto mt-3 -mx-4 md:-mx-6">
                  <div className="min-w-[860px] px-4 md:px-6">
                    <table className="w-full text-xs border border-border/80 rounded-lg overflow-hidden">
                      <thead>
                        <tr className="bg-slate-800 text-[9px] font-bold text-slate-300 uppercase tracking-wide">
                          <th className="px-3 py-2 text-left sticky left-0 bg-slate-800 z-10 min-w-[120px]">Local</th>
                          <th className="px-3 py-2 text-left min-w-[82px]">Plan.</th>
                          <th className="px-3 py-2 text-left min-w-[82px]">Llegada</th>
                          <th className="px-3 py-2 text-left min-w-[82px]">Salida</th>
                          <th className="px-3 py-2 text-left min-w-[82px]">GPS Arr.</th>
                          <th className="px-3 py-2 text-left min-w-[82px]">GPS Sal.</th>
                          <th className="px-3 py-2 text-left min-w-[82px]">Desc. inicio</th>
                          <th className="px-3 py-2 text-left min-w-[82px]">Desc. fin</th>
                          <th className="px-3 py-2 text-center min-w-[52px]">S2S</th>
                          <th className="px-3 py-2 text-center min-w-[52px]">°C</th>
                          <th className="px-3 py-2 text-center min-w-[68px]">On Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {stops.map((stop, i) => {
                          const isOrigin = stop.stop_type === 'ORIGIN'
                          const rowBg =
                            isOrigin ? 'bg-slate-50' :
                            stop.on_time_status === 'ON TIME'  ? 'bg-green-50/40' :
                            stop.on_time_status === 'OFF TIME' ? 'bg-amber-50/40' :
                            i % 2 === 1 ? 'bg-gray-50/40' : 'bg-white'
                          const opLabel = isOrigin ? 'Carga' : 'Desc.'
                          return (
                            <tr key={stop.stop_id ?? i} className={rowBg}>
                              <td className={`px-3 py-2 sticky left-0 z-10 ${rowBg}`}>
                                <p className="font-medium text-slate-700 leading-snug flex items-center gap-1">
                                  {isOrigin && (
                                    <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-slate-700 text-white shrink-0">ORIGEN</span>
                                  )}
                                  {stop.local ?? '—'}
                                  <OperationTypeBadge operationType={stop.operation_type} meta={meta} />
                                </p>
                                {stop.destination_city && (
                                  <p className="text-[9px] text-gray-400 mt-0.5">
                                    {stop.destination_city}{stop.destination_region ? `, ${stop.destination_region}` : ''}
                                  </p>
                                )}
                              </td>
                              <td className="px-3 py-2 font-mono text-[10px] text-gray-500 whitespace-nowrap">{fmtDT(stop.planning_date)}</td>
                              <td className="px-3 py-2 font-mono text-[10px] text-gray-500 whitespace-nowrap">{fmtDT(stop.arrival_date)}</td>
                              <td className="px-3 py-2 font-mono text-[10px] text-gray-500 whitespace-nowrap">{fmtDT(stop.departure_date)}</td>
                              <td className="px-3 py-2 font-mono text-[10px] text-gray-500 whitespace-nowrap">{fmtDT(stop.gps_arrival_date)}</td>
                              <td className="px-3 py-2 font-mono text-[10px] text-gray-500 whitespace-nowrap">{fmtDT(stop.gps_departure_date)}</td>
                              <td className="px-2 py-1">
                                <input
                                  key={`${stop.stop_id}-desc_inicio-${stop.unload_start ?? ''}`}
                                  type="datetime-local"
                                  aria-label={`${opLabel} inicio de ${stop.local ?? 'parada'}`}
                                  defaultValue={toDatetimeLocalValue(stop.unload_start)}
                                  onBlur={e => e.target.value && stop.stop_id && handleStopFieldChange(stop.stop_id, 'desc_inicio', e.target.value)}
                                  disabled={stopSaving === stop.stop_id}
                                  className={`w-full text-[10px] font-mono border rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-accent/30 bg-white disabled:opacity-50 ${stop.desc_manual ? 'border-accent/40 text-accent' : 'border-border text-gray-500'}`}
                                />
                              </td>
                              <td className="px-2 py-1">
                                <input
                                  key={`${stop.stop_id}-desc_fin-${stop.unload_end ?? ''}`}
                                  type="datetime-local"
                                  aria-label={`${opLabel} fin de ${stop.local ?? 'parada'}`}
                                  defaultValue={toDatetimeLocalValue(stop.unload_end)}
                                  onBlur={e => e.target.value && stop.stop_id && handleStopFieldChange(stop.stop_id, 'desc_fin', e.target.value)}
                                  disabled={stopSaving === stop.stop_id}
                                  className={`w-full text-[10px] font-mono border rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-accent/30 bg-white disabled:opacity-50 ${stop.desc_manual ? 'border-accent/40 text-accent' : 'border-border text-gray-500'}`}
                                />
                              </td>
                              <td className="px-3 py-2 text-center">
                                {stop.s2s ? <span className="text-[9px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{stop.s2s}</span> : <span className="text-gray-200">—</span>}
                              </td>
                              <td className="px-3 py-2 text-center">
                                {stopWasVisited(stop) && stop.temperature != null ? <span className="text-sm font-mono text-blue-600 font-semibold">{stop.temperature}°C</span> : <span className="text-gray-200">—</span>}
                              </td>
                              <td className="px-3 py-2 text-center">
                                {stop.on_time_status === 'ON TIME' ? (
                                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-green-50 text-green-600 border border-green-100">ON TIME</span>
                                ) : stop.on_time_status === 'OFF TIME' ? (
                                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-100">OFF TIME</span>
                                ) : (
                                  <span className="text-gray-200">—</span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {/* Bitácora — full width (Fase 2, Plan 4: se muda desde el aside
                de Gestión de 360px). TripNotesFeed en sí no se toca acá —
                su max-h-80 interno y el retiro del texto legacy son del
                Plan 5. */}
            <section>
              <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Bitácora</h4>
              <TripNotesFeed trip={trip} />
            </section>
          </div>
        </div>
      </div>
    </>
  )
}
