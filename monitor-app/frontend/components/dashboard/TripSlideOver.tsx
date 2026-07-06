'use client'

import { useState, useEffect, useRef } from 'react'
import {
  X, Loader2, Building2, Copy, Check,
  Truck, User, Phone, Hash,
  MapPin, ChevronDown, RotateCcw, ClipboardList,
} from 'lucide-react'
import type { Trip, TransporterListItem, TripsMeta } from '@/lib/types'
import { tripsApi, type TripPatch, type FleetLinkPayload } from '@/lib/api/trips'
import { transportersApi } from '@/lib/api/transporters'
import { getLatestTemp, stopWasVisited, classifyTemperature, getActiveStop, describeStopTiming } from '@/lib/utils/temperature'
import { stopComplianceSummary } from '@/lib/utils/compliance'
import { fmtDT, fmtDate, formatRelativeTime } from '@/lib/utils/datetime'
import { StopTimeline } from './StopTimeline'
import { RouteProgress } from './RouteProgress'
import { IndicatorDots } from './IndicatorDots'
import { TripNotesFeed } from './TripNotesFeed'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { RegionCityPicker } from '@/components/ui/RegionCityPicker'

// ── TransporterAssignSection ──────────────────────────────────────────────────

function TransporterAssignSection({
  tripId,
  currentTransporter,
  onAssigned,
}: {
  tripId: string
  currentTransporter: string | null
  onAssigned: (t: Trip) => void
}) {
  const [query, setQuery]         = useState('')
  const [results, setResults]     = useState<TransporterListItem[]>([])
  const [searching, setSearching] = useState(false)
  const [searchErr, setSearchErr] = useState<string | null>(null)
  const [saving, setSaving]       = useState(false)

  useEffect(() => {
    if (query.length < 2) { setResults([]); setSearchErr(null); setSearching(false); return }
    setSearching(true)
    setSearchErr(null)
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const res = await transportersApi.list({ q: query, page: 1, limit: 12 })
        if (!ctrl.signal.aborted) setResults(res.data)
      } catch (e) {
        if (!ctrl.signal.aborted) {
          setSearchErr(e instanceof Error ? e.message : 'Error al buscar')
          setResults([])
        }
      } finally {
        if (!ctrl.signal.aborted) setSearching(false)
      }
    }, 300)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [query])

  const assign = async (profileId: string) => {
    setSaving(true)
    try {
      const payload: FleetLinkPayload = { transporter_id: profileId }
      const updated = await tripsApi.assignFleetLink(tripId, payload)
      onAssigned(updated)
      setResults([])
      setQuery('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      {currentTransporter && (
        <p className="text-[10px] text-gray-400 bg-gray-50 px-2 py-1 rounded border border-border/60">
          TMS reporta: <span className="font-medium text-gray-600">{currentTransporter}</span>
        </p>
      )}
      <div className="relative">
        <input
          type="text"
          placeholder="Buscar empresa por nombre o RUT…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="w-full text-xs border border-border rounded-lg px-3 py-2 pr-7 focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        {searching && (
          <Loader2 size={12} className="animate-spin text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2" />
        )}
      </div>
      {searchErr && <p className="text-[10px] text-red-500 px-1">{searchErr}</p>}
      {results.length > 0 && (
        <ul className="border border-border rounded-lg divide-y divide-border overflow-y-auto max-h-52 bg-white shadow-md">
          {results.map(tp => (
            <li key={tp.id}>
              <button
                type="button"
                onClick={() => assign(tp.id)}
                disabled={saving}
                className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center justify-between"
              >
                <div>
                  <p className="font-medium text-slate-700">{tp.business_name ?? '—'}</p>
                  <p className="text-gray-400 font-mono text-[10px]">{tp.rut ?? ''}</p>
                </div>
                {saving && <Loader2 size={12} className="animate-spin text-accent" />}
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.length >= 2 && !searching && results.length === 0 && !searchErr && (
        <p className="text-[10px] text-gray-400 px-1">Sin resultados para "{query}"</p>
      )}
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
  const [techDetailOpen, setTechDetailOpen]     = useState(false)
  const [datosOpen, setDatosOpen]               = useState(false)
  const [unlinkErr, setUnlinkErr]               = useState<string | null>(null)
  const [unlinking, setUnlinking]               = useState(false)
  // Ubicación de origen (región/ciudad) — draft local, se guarda vía PATCH
  const [locRegion, setLocRegion]               = useState<string | null>(null)
  const [locCity, setLocCity]                   = useState<string | null>(null)
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
  }, [trip?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const locDirty =
    !!trip && ((locRegion ?? null) !== (trip.origin_region ?? null) || (locCity ?? null) !== (trip.origin_city ?? null))

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
      const updated = await tripsApi.patch(trip.id, { estado_manual: estadoDraft } as TripPatch)
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
      await tripsApi.resetField(trip.id, 'estado_manual')
      onSaved({ ...trip, estado_manual: null })
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

  const currentStatus = trip.estado_manual ?? trip.current_status
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
            {trip.estado_manual && (
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

              {trip.estado_manual ? (
                <div className="flex items-center gap-2 flex-wrap">
                  {(() => {
                    const opState = meta?.operational_states.find(s => s.id === trip.estado_manual)
                    const label = opState?.label ?? trip.estado_manual
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
              {trip.transporter_profile_id ? (
                <div className="flex items-center justify-between bg-white rounded-lg px-3 py-2.5 border border-border/80 shadow-sm">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-800 truncate">{trip.transporter ?? '—'}</p>
                    {trip.transporter_tms && (
                      <p className="text-[9px] text-gray-400 mt-0.5 truncate">TMS: {trip.transporter_tms}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={unlinking}
                    onClick={async () => {
                      setUnlinking(true); setUnlinkErr(null)
                      try {
                        await tripsApi.removeFleetLink(trip.id)
                        onSaved({ ...trip, transporter_profile_id: null, fleet_link_id: null })
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
                <TransporterAssignSection
                  tripId={trip.id}
                  currentTransporter={trip.transporter_tms}
                  onAssigned={onSaved}
                />
              )}
              {unlinkErr && <p className="text-xs text-red-500 mt-1">{unlinkErr}</p>}
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
                            <th className="px-3 py-2 text-left min-w-[100px]">Estado SAP</th>
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
                                  <p className="font-medium text-slate-700 leading-snug">{stop.local ?? '—'}</p>
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
                                <td className="px-3 py-2 font-mono text-[10px] text-gray-500 whitespace-nowrap">{fmtDT(stop.unload_start)}</td>
                                <td className="px-3 py-2 font-mono text-[10px] text-gray-500 whitespace-nowrap">{fmtDT(stop.unload_end)}</td>
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
                                <td className="px-3 py-2">
                                  {stop.milestone_status ? <span className="text-[9px] text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded leading-snug block">{stop.milestone_status}</span> : <span className="text-gray-200">—</span>}
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
                  <MetaField label="EETT TMS" value={trip.transporter_tms ?? '—'} />
                  {trip.milestone_status && (
                    <MetaField label="Estado cumplimiento" value={trip.milestone_status} highlight />
                  )}
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
