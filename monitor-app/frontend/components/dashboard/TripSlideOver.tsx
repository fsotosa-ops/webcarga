'use client'

import { useState, useEffect, useRef } from 'react'
import {
  X, Loader2, Building2, Copy, Check,
  Truck, User, Phone, Hash, Search,
  MapPin, ChevronDown, RotateCcw, ClipboardList,
} from 'lucide-react'
import type { Trip, TripsMeta } from '@/lib/types'
import { tripsApi, type TripPatch } from '@/lib/api/trips'
import { carriersApi } from '@/lib/api/carriers'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useQuery } from '@tanstack/react-query'
import { getLatestTemp, stopWasVisited, classifyTemperature, getActiveStop, describeStopTiming } from '@/lib/utils/temperature'
import { stopComplianceSummary } from '@/lib/utils/compliance'
import { fmtDT, fmtDate, formatRelativeTime, toDatetimeLocalValue } from '@/lib/utils/datetime'
import { StopTimeline } from './StopTimeline'
import { RouteProgress } from './RouteProgress'
import { IndicatorDots } from './IndicatorDots'
import { TripNotesFeed } from './TripNotesFeed'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { OperationTypeBadge } from '@/components/ui/OperationTypeBadge'
import { RegionCityPicker } from '@/components/ui/RegionCityPicker'

// ── CarrierAssignSection ──────────────────────────────────────────────────────
//
// Búsqueda debounced de empresa (public.carriers) — mismo patrón que
// TransferModal.tsx. Reactivado 2026-07-17: trip_fleet_links.carrier_id
// ya resuelve contra public.carriers.id (repuntado desde la tabla legacy
// app.transporter_profiles, ver migración migrate_trip_fleet_links_to_carriers;
// columna renombrada transporter_id→carrier_id en Fase 1.5).

type PendingCarrier = { id: string; business_name: string | null }

function CarrierAssignSection({
  tripId, currentCarrierName, onAssigned,
}: {
  tripId: string
  currentCarrierName: string | null
  onAssigned: (t: Trip) => void
}) {
  const [q, setQ]                             = useState('')
  const [pending, setPending]                 = useState<PendingCarrier | null>(null)
  const [driverId, setDriverId]                = useState('')
  const [tractorAssetId, setTractorAssetId]    = useState('')
  const [assigning, setAssigning]             = useState(false)
  const [err, setErr]                         = useState<string | null>(null)
  const qDebounced = useDebouncedValue(q, 250)

  const searchQuery = useQuery({
    queryKey: ['carriers', 'fleet-link-search', qDebounced],
    queryFn: () => carriersApi.list({ q: qDebounced, limit: 10 }),
    enabled: qDebounced.length >= 2 && !pending,
  })
  const results = searchQuery.data?.data ?? []

  // Roster de la empresa preseleccionada — mismo patrón que EmpresaSelector
  // en TripCreateSlideOver.tsx, para poder vincular driver_id/tractor_asset_id
  // reales en vez de solo el nombre en texto libre.
  const rosterQuery = useQuery({
    queryKey: ['carriers', pending?.id, 'roster'],
    queryFn: async () => {
      const [drivers, assets] = await Promise.all([
        carriersApi.listDrivers(pending!.id),
        carriersApi.listAssets(pending!.id),
      ])
      return { drivers, assets }
    },
    enabled: !!pending,
  })
  const drivers  = rosterQuery.data?.drivers ?? []
  const vehicles = rosterQuery.data?.assets ?? []

  function handlePick(c: { id: string; business_name: string; tax_id: string }) {
    setPending({ id: c.id, business_name: c.business_name })
    setDriverId('')
    setTractorAssetId('')
    setErr(null)
  }

  async function handleConfirm() {
    if (!pending) return
    setAssigning(true); setErr(null)
    const driver  = drivers.find(d => d.id === driverId)
    const tractor = vehicles.find(v => v.id === tractorAssetId)
    try {
      const updated = await tripsApi.assignFleetLink(tripId, {
        carrier_id:        pending.id,
        driver_id:         driverId || undefined,
        tractor_asset_id:  tractorAssetId || undefined,
        driver_name:       driver?.full_name ?? undefined,
        tractor_plate:     tractor?.license_plate ?? undefined,
      })
      onAssigned(updated)
      setQ(''); setPending(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al vincular')
    } finally {
      setAssigning(false)
    }
  }

  if (pending) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between bg-accent/5 border border-accent/20 rounded-lg px-3 py-2">
          <p className="text-[11px] font-semibold text-slate-800 truncate">{pending.business_name ?? '—'}</p>
          <button type="button" onClick={() => setPending(null)} className="text-[10px] text-gray-400 hover:text-gray-600 shrink-0 ml-2">
            Cambiar
          </button>
        </div>
        {rosterQuery.isFetching ? (
          <p className="text-[11px] text-gray-400 flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Cargando roster…</p>
        ) : (
          <>
            {drivers.length > 0 && (
              <select
                value={driverId}
                onChange={e => setDriverId(e.target.value)}
                aria-label="Conductor (opcional)"
                className="w-full text-xs border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/20"
              >
                <option value="">Conductor (opcional)</option>
                {drivers.map(d => (
                  <option key={d.id} value={d.id}>{d.full_name ?? '—'} · {d.tax_id ?? ''}</option>
                ))}
              </select>
            )}
            {vehicles.length > 0 && (
              <select
                value={tractorAssetId}
                onChange={e => setTractorAssetId(e.target.value)}
                aria-label="Tracto (opcional)"
                className="w-full text-xs border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/20"
              >
                <option value="">Tracto (opcional)</option>
                {vehicles.map(v => (
                  <option key={v.id} value={v.id}>{v.license_plate ?? '—'} · {v.asset_type ?? ''}</option>
                ))}
              </select>
            )}
          </>
        )}
        <button
          type="button"
          disabled={assigning}
          onClick={handleConfirm}
          className="w-full text-xs font-semibold bg-accent text-white rounded-lg py-1.5 hover:bg-accent/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          {assigning ? <Loader2 size={12} className="animate-spin" /> : 'Vincular'}
        </button>
        {err && <p className="text-[11px] text-red-500">{err}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {currentCarrierName && (
        <p className="text-[10px] text-gray-400 bg-gray-50 px-2 py-1 rounded border border-border/60">
          TMS reporta: <span className="font-medium text-gray-600">{currentCarrierName}</span>
        </p>
      )}
      <div className="relative">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Buscar empresa (nombre o RUT)…"
          aria-label="Buscar empresa transportista"
          className="w-full text-xs border border-border rounded-lg pl-7 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      </div>
      {q.length >= 2 && (
        <div className="max-h-40 overflow-y-auto border border-border rounded-lg divide-y divide-border/60">
          {searchQuery.isFetching && (
            <p className="px-3 py-2 text-center text-[11px] text-gray-400 flex items-center justify-center gap-1.5">
              <Loader2 size={11} className="animate-spin" /> Buscando…
            </p>
          )}
          {!searchQuery.isFetching && results.length === 0 && (
            <p className="px-3 py-2 text-center text-[11px] text-gray-400">Sin resultados</p>
          )}
          {results.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => handlePick(c)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
            >
              <Building2 size={12} className="text-gray-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold text-text-primary truncate">{c.business_name}</p>
                <p className="text-[10px] text-gray-400 font-mono">{c.tax_id}</p>
              </div>
            </button>
          ))}
        </div>
      )}
      {err && <p className="text-[11px] text-red-500">{err}</p>}
    </div>
  )
}

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
  const [copied, setCopied]                     = useState(false)
  const [showEstadoSelect, setShowEstadoSelect] = useState(false)
  const [clearingOverride, setClearingOverride] = useState(false)
  const [reasonSaving, setReasonSaving]         = useState(false)
  const [techDetailOpen, setTechDetailOpen]     = useState(false)
  const [datosOpen, setDatosOpen]               = useState(false)
  const [unlinkErr, setUnlinkErr]               = useState<string | null>(null)
  const [unlinking, setUnlinking]               = useState(false)
  // Ubicación de origen (región/ciudad) — draft local, se guarda vía PATCH
  const [locRegion, setLocRegion]               = useState<string | null>(null)
  const [locCity, setLocCity]                   = useState<string | null>(null)
  // Carga Inicio/Fin (origen) — draft local, mismo motivo que locRegion/locCity
  const [cagInicioDraft, setCagInicioDraft]     = useState('')
  const [cagFinDraft, setCagFinDraft]           = useState('')
  const [locSaving, setLocSaving]               = useState(false)
  const [locErr, setLocErr]                     = useState<string | null>(null)
  const panelRef                                = useRef<HTMLDivElement>(null)

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
    setCopied(false)
    setShowEstadoSelect(false)
    setTechDetailOpen(false)
    setDatosOpen(false)
    setUnlinkErr(null)
    setLocRegion(trip.origin_region ?? null)
    setLocCity(trip.origin_city ?? null)
    setLocErr(null)
    setCagInicioDraft(toDatetimeLocalValue(trip.cag_inicio_at))
    setCagFinDraft(toDatetimeLocalValue(trip.cag_fin_at))
  }, [trip?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const locDirty =
    !!trip && ((locRegion ?? null) !== (trip.origin_region ?? null) || (locCity ?? null) !== (trip.origin_city ?? null))

  // Campos híbridos (esquema de fechas 2026-07-17): Carga Inicio/Fin (origen,
  // sin equivalente TMS) y Desc. Inicio/Fin (por parada, override manual de
  // lo que reporta el TMS). Guardado directo al cambiar, sin botón aparte —
  // mismo patrón que onExpirationChange en DocumentChecklist.
  const [cagSaving, setCagSaving] = useState<'cag_inicio_at' | 'cag_fin_at' | null>(null)
  const [stopSaving, setStopSaving] = useState<string | null>(null)

  async function handleCagChange(field: 'cag_inicio_at' | 'cag_fin_at', value: string) {
    if (!trip) return
    setCagSaving(field)
    try {
      const updated = await tripsApi.patch(trip.id, { [field]: value } as TripPatch)
      onSaved(updated)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setCagSaving(null)
    }
  }

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

  async function handleSaveLocation() {
    if (!trip) return
    setLocSaving(true)
    setLocErr(null)
    try {
      const updated = await tripsApi.patch(trip.id, {
        origin_region: locRegion ?? '',
        origin_city:   locCity ?? '',
      })
      onSaved(updated)
    } catch (e) {
      setLocErr(e instanceof Error ? e.message : 'Error al guardar la ubicación')
    } finally {
      setLocSaving(false)
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

  function handleCopyId() {
    if (!trip?.source_system_trip_id) return
    navigator.clipboard.writeText(trip.source_system_trip_id).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (!trip) return null

  const currentStatus = trip.manual_status ?? trip.current_status
  const tmsMeta       = trip.source_system ? meta?.tms_sources.find(t => t.id === trip.source_system.toLowerCase()) : null
  const tmsLabel      = tmsMeta?.label ?? trip.source_system?.toUpperCase().slice(0, 3) ?? '?'
  const temp          = getLatestTemp(trip.stops ?? [])
  const tempStatus    = classifyTemperature(temp, trip.cargo_type, meta?.temperature_ranges ?? [])
  const isManualTrip  = trip.source_system === 'manual'

  // Hero: la historia del viaje de un vistazo
  const stops       = trip.stops ?? []
  const activeStop  = getActiveStop(stops)
  const activeTiming = activeStop ? describeStopTiming(activeStop) : null
  const doneCount   = stops.filter(s => s.arrival_date || s.gps_arrival_date || s.on_time_status).length
  const compliance  = stopComplianceSummary(stops)
  const tmsSince    = formatRelativeTime(trip.status_reported_at)
  const syncSince   = formatRelativeTime(trip.pipeline_updated_at)

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
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
            style={tmsMeta
              ? { backgroundColor: tmsMeta.bg_color, color: tmsMeta.text_color }
              : { backgroundColor: '#334155', color: '#94a3b8' }}
          >
            {tmsLabel}
          </span>

          {trip.source_system_trip_id && (
            <span className="flex items-center gap-1.5 min-w-0">
              <Hash size={11} className="text-white/40 shrink-0" />
              <span className="font-mono text-xs text-white/60 truncate">{trip.source_system_trip_id}</span>
              <button
                type="button"
                onClick={handleCopyId}
                title="Copiar ID de viaje"
                className="text-white/40 hover:text-white/80 transition-colors shrink-0"
              >
                {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
              </button>
            </span>
          )}

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
        <div className="px-4 py-3 md:px-6 border-b border-border bg-gray-50/80 shrink-0 space-y-2">
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

          {/* Barra de progreso de ruta — sin nombres (viven en el timeline; tooltip en el nodo) */}
          {stops.length > 0 && (
            <div className="pt-1 pb-0.5">
              <RouteProgress stops={stops} />
            </div>
          )}

          {/* Gestión por excepción: solo se badgea lo que está mal (OFF TIME,
              temp fuera de rango) — lo demás es texto plano discreto */}
          <div className="flex items-center gap-2.5 flex-wrap text-[11px] text-gray-500">
            {stops.length > 0 && (
              <span>{doneCount}/{stops.length} paradas</span>
            )}
            {compliance === 'warn' && (
              <span className="font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full text-[10px]">OFF TIME</span>
            )}
            {temp != null && (
              tempStatus === 'out_of_range'
                ? <span className="font-semibold px-1.5 py-0.5 rounded-full text-[10px] bg-red-50 text-red-700">{temp}°C</span>
                : <span>{temp}°C</span>
            )}
            <span className="text-gray-400">
              TMS reportó {tmsSince}{syncSince !== '—' ? ` · sync ${syncSince}` : ''}
            </span>
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
                <button
                  type="button"
                  onClick={() => setShowEstadoSelect(true)}
                  className="text-xs text-accent hover:text-accent/80 transition-colors"
                >
                  + Establecer estado operativo manual
                </button>
              )}

              {err && (
                <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mt-2">{err}</p>
              )}
            </div>

            {/* Motivo de no asignación — solo visible mientras el viaje no está
                asignado (Fase 1.5d); catálogo editable en app.unassigned_reasons */}
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

            {/* Indicadores — solo para viajes manuales */}
            {isManualTrip && (
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Indicadores</p>
                <IndicatorDots trip={trip} onSaved={onSaved} size="md" />
              </div>
            )}

            {/* Ubicación de origen — región/ciudad asignable desde el Monitor */}
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1">
                <MapPin size={10} /> Ubicación de origen
              </p>
              <RegionCityPicker
                size="sm"
                region={locRegion}
                city={locCity}
                onChange={(region, city) => { setLocRegion(region); setLocCity(city) }}
                labelSuffix="de origen"
              />
              {locDirty && (
                <div className="flex items-center gap-2 mt-1.5">
                  <button
                    type="button"
                    onClick={handleSaveLocation}
                    disabled={locSaving}
                    className="flex items-center gap-1 text-[11px] font-semibold text-white bg-accent hover:bg-accent/90 rounded-lg px-2.5 py-1 transition-colors disabled:opacity-50"
                  >
                    {locSaving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                    Guardar ubicación
                  </button>
                  <button
                    type="button"
                    onClick={() => { setLocRegion(trip.origin_region ?? null); setLocCity(trip.origin_city ?? null); setLocErr(null) }}
                    className="text-[10px] text-gray-400 hover:text-gray-600"
                  >
                    Cancelar
                  </button>
                </div>
              )}
              {locErr && (
                <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mt-2">{locErr}</p>
              )}
            </div>

            {/* Empresa transportista — card compacta, sin acordeón */}
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1">
                <Building2 size={10} /> Empresa transportista
              </p>
              {trip.carrier_id ? (
                <div className="flex items-center justify-between bg-white rounded-lg px-3 py-2.5 border border-border/80 shadow-sm">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-800 truncate">{trip.carrier_name ?? '—'}</p>
                    {trip.carrier_name_tms && (
                      <p className="text-[9px] text-gray-400 mt-0.5 truncate">TMS: {trip.carrier_name_tms}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={unlinking}
                    onClick={async () => {
                      setUnlinking(true); setUnlinkErr(null)
                      try {
                        await tripsApi.removeFleetLink(trip.id)
                        onSaved({ ...trip, carrier_id: null, fleet_link_id: null })
                      } catch (e) {
                        setUnlinkErr(e instanceof Error ? e.message : 'Error al desvincular')
                      } finally {
                        setUnlinking(false)
                      }
                    }}
                    className="text-[11px] text-gray-400 hover:text-red-400 transition-colors disabled:opacity-50 shrink-0 ml-2"
                  >
                    {unlinking ? <Loader2 size={12} className="animate-spin" /> : 'Desvincular'}
                  </button>
                </div>
              ) : (
                <CarrierAssignSection
                  tripId={trip.id}
                  currentCarrierName={trip.carrier_name_tms}
                  onAssigned={onSaved}
                />
              )}
              {unlinkErr && <p className="text-xs text-red-500 mt-1">{unlinkErr}</p>}
              {/* Reconciliación TMS↔manual (Fase 1.5b): si hay vínculo manual y el
                  TMS reporta un conductor/patente distinto al vinculado, avisar y
                  ofrecer revertir — nunca sobrescribir automáticamente. */}
              {!!trip.fleet_link_id && (
                (trip.driver_name_tms && trip.driver_name_tms !== trip.driver_name) ||
                (trip.tractor_plate_tms && trip.tractor_plate_tms !== trip.tractor_plate)
              ) && (
                <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1">
                  {trip.driver_name_tms && trip.driver_name_tms !== trip.driver_name && (
                    <p className="text-[10px] text-amber-700">
                      TMS reporta conductor: <span className="font-semibold">{trip.driver_name_tms}</span>
                    </p>
                  )}
                  {trip.tractor_plate_tms && trip.tractor_plate_tms !== trip.tractor_plate && (
                    <p className="text-[10px] text-amber-700">
                      TMS reporta patente: <span className="font-semibold">{trip.tractor_plate_tms}</span>
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={unlinking}
                    onClick={async () => {
                      setUnlinking(true); setUnlinkErr(null)
                      try {
                        await tripsApi.removeFleetLink(trip.id)
                        onSaved({ ...trip, carrier_id: null, fleet_link_id: null })
                      } catch (e) {
                        setUnlinkErr(e instanceof Error ? e.message : 'Error al desvincular')
                      } finally {
                        setUnlinking(false)
                      }
                    }}
                    className="text-[10px] font-semibold text-amber-700 hover:text-amber-900 underline disabled:opacity-50"
                  >
                    {unlinking ? 'Revirtiendo…' : 'Usar dato del TMS'}
                  </button>
                </div>
              )}
            </div>

            {/* Bitácora — feed cronológico con historial */}
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Bitácora</p>
              <TripNotesFeed trip={trip} />
            </div>
          </aside>

          {/* Columna izquierda en desktop / segunda en mobile: RUTA + secundario */}
          <div className="order-2 md:order-1 flex-1 min-w-0 md:overflow-y-auto p-4 md:p-6 space-y-5">
            {stops.length > 0 && (
              <section>
                <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <MapPin size={11} /> Ruta ({stops.length} parada{stops.length === 1 ? '' : 's'})
                </h4>
                <StopTimeline stops={stops} />

                <button
                  type="button"
                  onClick={() => setTechDetailOpen(v => !v)}
                  className="mt-3 flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <ChevronDown size={11} className={`transition-transform ${techDetailOpen ? 'rotate-180' : ''}`} />
                  Ver detalle técnico (GPS, SAP)
                </button>

                {techDetailOpen && (
                  <div className="overflow-x-auto mt-2 -mx-4 md:-mx-6">
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
                            const rowBg =
                              stop.on_time_status === 'ON TIME'  ? 'bg-green-50/40' :
                              stop.on_time_status === 'OFF TIME' ? 'bg-amber-50/40' :
                              i % 2 === 1 ? 'bg-gray-50/40' : 'bg-white'
                            return (
                              <tr key={stop.stop_id ?? i} className={rowBg}>
                                <td className={`px-3 py-2 sticky left-0 z-10 ${rowBg}`}>
                                  <p className="font-medium text-slate-700 leading-snug flex items-center gap-1">
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
                                    aria-label={`Desc. inicio de ${stop.local ?? 'parada'}`}
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
                                    aria-label={`Desc. fin de ${stop.local ?? 'parada'}`}
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
                )}
              </section>
            )}

            {/* Datos operativos — acordeón colapsado (secundario) */}
            <section className="border border-border/60 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setDatosOpen(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-50/60 transition-colors"
              >
                <span className="text-xs font-semibold text-slate-700">Datos operativos</span>
                <ChevronDown size={13} className={`text-gray-400 transition-transform ${datosOpen ? 'rotate-180' : ''}`} />
              </button>
              {datosOpen && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3 px-3 pb-3 pt-2 border-t border-border/60 bg-gray-50/40">
                  <MetaField label="Fecha planificación" value={fmtDate(trip.planning_date)} />
                  <MetaField label="Origen" value={trip.origin ?? '—'} />
                  <MetaField label="Tipo carga" value={trip.cargo_type ?? '—'} />
                  <MetaField label="EETT TMS" value={trip.carrier_name_tms ?? '—'} />
                  {trip.milestone_status && (
                    <MetaField label="Estado cumplimiento" value={trip.milestone_status} highlight />
                  )}
                  <div>
                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-0.5">Carga inicio</p>
                    <input
                      type="datetime-local"
                      aria-label="Carga inicio"
                      value={cagInicioDraft}
                      onChange={e => setCagInicioDraft(e.target.value)}
                      onBlur={e => e.target.value && handleCagChange('cag_inicio_at', e.target.value)}
                      disabled={cagSaving === 'cag_inicio_at'}
                      className="text-[11px] text-slate-700 border border-border rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-accent/30 bg-white w-full disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-0.5">Carga fin</p>
                    <input
                      type="datetime-local"
                      aria-label="Carga fin"
                      value={cagFinDraft}
                      onChange={e => setCagFinDraft(e.target.value)}
                      onBlur={e => e.target.value && handleCagChange('cag_fin_at', e.target.value)}
                      disabled={cagSaving === 'cag_fin_at'}
                      className="text-[11px] text-slate-700 border border-border rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-accent/30 bg-white w-full disabled:opacity-50"
                    />
                  </div>
                </div>
              )}
            </section>

            {/* Footer secundario — auditoría */}
            <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/40">
              {trip.created_at && <MetaField label="Ingresó al sistema" value={fmtDT(trip.created_at)} />}
              <p className="font-mono text-[9px] text-gray-300 shrink-0">{trip.id}</p>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
