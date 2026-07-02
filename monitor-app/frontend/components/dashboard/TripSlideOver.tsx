'use client'

import { useState, useEffect } from 'react'
import {
  X, Loader2, Building2, Copy, Check,
  Truck, User, Phone, Hash, RefreshCw,
  Thermometer, MapPin,
} from 'lucide-react'
import type { Trip, TransporterListItem, TripsMeta } from '@/lib/types'
import { tripsApi, type TripPatch, type FleetLinkPayload } from '@/lib/api/trips'
import { transportersApi } from '@/lib/api/transporters'
import { getLatestTemp, getActiveStop, stopWasVisited } from '@/lib/utils/temperature'


// ── Date formatters ───────────────────────────────────────────────────────────

function fmtDT(iso: string | null | undefined): string {
  if (!iso) return '—'
  // Timestamps sin offset (ej. pipeline_updated_at: "2026-05-28 20:07:03") son UTC — agregar Z
  const normalized = /[Z+\-]\d{2}:?\d{2}$/.test(iso) || iso.endsWith('Z') ? iso : iso.replace(' ', 'T') + 'Z'
  const d = new Date(normalized)
  if (isNaN(d.getTime())) return '—'
  const parts = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const p = Object.fromEntries(parts.filter(x => x.type !== 'literal').map(x => [x.type, x.value]))
  return `${p.day}/${p.month} ${p.hour}:${p.minute}:${p.second}`
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso + 'T12:00:00').toLocaleDateString('es-CL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

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
  label, value, icon, highlight = false,
}: {
  label: string
  value: string
  icon?: React.ReactNode
  highlight?: boolean
}) {
  return (
    <div>
      <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
      <div className="flex items-center gap-1">
        {icon}
        <p className={`text-xs leading-snug ${highlight ? 'font-semibold text-accent' : 'text-slate-700'}`}>
          {value}
        </p>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

type ActiveTab = 'viaje' | 'empresa' | 'bitacora'

interface Props {
  trip:    Trip | null
  onClose: () => void
  onSaved: (updated: Trip) => void
  meta?:   TripsMeta | null
}

export function TripSlideOver({ trip, onClose, onSaved, meta }: Props) {
  const [activeTab, setActiveTab]           = useState<ActiveTab>('viaje')
  const [form, setForm]                     = useState<TripPatch>({})
  const [saving, setSaving]                 = useState(false)
  const [err, setErr]                       = useState<string | null>(null)
  const [copied, setCopied]                 = useState(false)
  const [showEstadoSelect, setShowEstadoSelect] = useState(false)
  const [clearingOverride, setClearingOverride] = useState(false)

  useEffect(() => {
    if (!trip) return
    setActiveTab('viaje')
    setForm({
      estado_manual:  trip.estado_manual  ?? '',
      observaciones:  trip.observaciones  ?? '',
      comentarios:    trip.comentarios    ?? '',
      activo:         trip.activo,
      trabajando:     trip.trabajando,
      asignado:       trip.asignado,
      primera_vuelta: trip.primera_vuelta,
    })
    setErr(null)
    setCopied(false)
    setShowEstadoSelect(false)
  }, [trip?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    if (!trip) return
    setSaving(true)
    setErr(null)
    try {
      const payload: TripPatch = {
        // Only send estado_manual when a new override was actively selected
        ...(showEstadoSelect && form.estado_manual
          ? { estado_manual: form.estado_manual }
          : {}),
        observaciones:  form.observaciones  || undefined,
        comentarios:    form.comentarios    || undefined,
        activo:         form.activo,
        trabajando:     form.trabajando,
        asignado:       form.asignado,
        primera_vuelta: form.primera_vuelta,
      }
      const updated = await tripsApi.patch(trip.id, payload)
      onSaved(updated)
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
      setForm(f => ({ ...f, estado_manual: '' }))
      setShowEstadoSelect(false)
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
  const statusMeta    = currentStatus ? meta?.statuses.find(s => s.id === currentStatus) : null
  const tmsMeta       = trip.source_system ? meta?.tms_sources.find(t => t.id === trip.source_system.toLowerCase()) : null
  const tmsLabel      = tmsMeta?.label ?? trip.source_system?.toUpperCase().slice(0, 3) ?? '?'

  const TABS: { key: ActiveTab; label: string }[] = [
    { key: 'viaje',    label: 'Viaje'    },
    { key: 'empresa',  label: 'Empresa'  },
    { key: 'bitacora', label: 'Bitácora' },
  ]

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-0 z-50 flex flex-col bg-white
                      md:inset-4
                      md:rounded-2xl md:shadow-2xl overflow-hidden">

        {/* ── Header ────────────────────────────────────────────────── */}
        <div className="bg-slate-900 px-4 py-3 md:px-6 md:py-4 shrink-0 space-y-2.5">

          {/* Row 1: TMS + ID + cerrar */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              {tmsMeta || trip.source_system ? (
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
                  style={tmsMeta
                    ? { backgroundColor: tmsMeta.bg_color, color: tmsMeta.text_color }
                    : { backgroundColor: '#334155', color: '#94a3b8' }}
                >
                  {tmsLabel}
                </span>
              ) : null}
              {trip.source_system_trip_id && (
                <div className="flex items-center gap-1.5 min-w-0">
                  <Hash size={11} className="text-white/40 shrink-0" />
                  <span className="font-mono text-xs text-white/60 truncate">
                    {trip.source_system_trip_id}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyId}
                    title="Copiar ID de viaje"
                    className="text-white/40 hover:text-white/80 transition-colors shrink-0"
                  >
                    {copied
                      ? <Check size={12} className="text-green-400" />
                      : <Copy size={12} />}
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-white/50 hover:text-white transition-colors shrink-0 p-1 rounded-lg hover:bg-white/10"
            >
              <X size={20} />
            </button>
          </div>

          {/* Row 2: Patente + Estado + Flags */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Truck size={14} className="text-white/40 shrink-0" />
              <span className="font-mono text-base font-bold text-white">
                {trip.tractor_plate ?? trip.trailer_plate ?? 'Sin patente'}
              </span>
              {trip.tractor_plate && trip.trailer_plate && (
                <span className="font-mono text-xs text-white/40">/ {trip.trailer_plate}</span>
              )}
            </div>
            <span
              className="text-[11px] font-bold px-2.5 py-1 rounded-full shrink-0"
              style={statusMeta
                ? { backgroundColor: statusMeta.bg_color, color: statusMeta.text_color }
                : { backgroundColor: '#334155', color: '#94a3b8' }}
            >
              {currentStatus ?? 'Sin estado'}
            </span>
            {/* Flags readonly */}
            <div className="flex items-center gap-1 ml-auto flex-wrap">
              {[
                { key: 'activo',         label: 'Activo', val: trip.activo,         color: 'bg-blue-400/80'   },
                { key: 'trabajando',     label: 'Trab.',  val: trip.trabajando,     color: 'bg-green-400/80'  },
                { key: 'asignado',       label: 'Asig.',  val: trip.asignado,       color: 'bg-violet-400/80' },
                { key: 'primera_vuelta', label: '1V',     val: trip.primera_vuelta, color: 'bg-amber-400/80'  },
              ].map(f => f.val ? (
                <span
                  key={f.key}
                  title={f.key}
                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded text-white ${f.color}`}
                >
                  {f.label}
                </span>
              ) : null)}
            </div>
          </div>

          {/* Row 3: Conductor + Cliente */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 min-w-0">
              <User size={11} className="text-white/40 shrink-0" />
              <span className="text-xs text-white/80 truncate">{trip.driver_name ?? '—'}</span>
              {trip.driver_rut && (
                <span className="font-mono text-[11px] text-white/40 shrink-0">{trip.driver_rut}</span>
              )}
            </div>
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
              <span className="text-[11px] text-white/35 hidden md:inline truncate">
                · {trip.client_name}
              </span>
            )}
          </div>
        </div>

        {/* ── KPI strip ─────────────────────────────────────────────── */}
        {(trip.stops?.length ?? 0) > 0 && (() => {
          const temp       = getLatestTemp(trip.stops)
          const activeStop = getActiveStop(trip.stops)
          return (
            <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-border/60 border-b border-border/80 bg-gradient-to-r from-slate-50 to-blue-50/30 shrink-0">
              <div className="px-4 py-3 flex flex-col justify-center">
                <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest mb-1">Temperatura</p>
                {temp != null
                  ? <p className="text-2xl font-black text-blue-600 leading-none">{temp}°C</p>
                  : <p className="text-sm text-gray-300">—</p>}
              </div>
              <div className="px-4 py-3 flex flex-col justify-center">
                <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest mb-1">Parada activa</p>
                <p className="text-sm font-bold text-accent leading-tight truncate">{activeStop?.local ?? '—'}</p>
                {activeStop?.arrival_date && (
                  <p className="text-[10px] text-gray-400 font-mono mt-0.5">{fmtDT(activeStop.arrival_date)}</p>
                )}
              </div>
              <div className="px-4 py-3 flex flex-col justify-center">
                <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest mb-1">Planificación</p>
                <p className="text-sm font-semibold text-slate-700">{fmtDate(trip.planning_date)}</p>
                {trip.status_reported_at && (
                  <p className="text-[10px] text-gray-400 font-mono mt-0.5">Rep. {fmtDT(trip.status_reported_at)}</p>
                )}
              </div>
              <div className="px-4 py-3 flex flex-col justify-center">
                <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest mb-1">Teléfono</p>
                {trip.driver_phone
                  ? <a
                      href={`tel:${trip.driver_phone}`}
                      className="text-sm font-mono text-green-600 hover:text-green-500 leading-tight"
                      onClick={e => e.stopPropagation()}
                    >
                      {trip.driver_phone}
                    </a>
                  : <p className="text-sm text-gray-300">—</p>}
              </div>
            </div>
          )
        })()}

        {/* ── Tab bar ───────────────────────────────────────────────── */}
        <div className="flex shrink-0 bg-white border-b border-border">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex-1 text-xs font-semibold py-2.5 transition-colors border-b-2 ${
                activeTab === t.key
                  ? 'text-accent border-accent'
                  : 'text-gray-400 border-transparent hover:text-gray-600'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Tab body ──────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto min-h-0">

          {/* ── TAB: VIAJE ──────────────────────────────────────────── */}
          {activeTab === 'viaje' && (
            <div className="p-4 md:p-6 space-y-6">

              {/* Resumen */}
              <section>
                <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">
                  Resumen
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3">
                  <MetaField label="Fecha planificación" value={fmtDate(trip.planning_date)} />
                  <MetaField label="Origen" value={trip.origin ?? '—'} />
                  <MetaField label="Tipo carga" value={trip.cargo_type ?? '—'} />
                  <MetaField label="EETT TMS" value={trip.transporter_tms ?? '—'} />
                  <MetaField
                    label="Último reporte TMS"
                    value={fmtDT(trip.status_reported_at)}
                    icon={<RefreshCw size={9} className="text-gray-400 shrink-0" />}
                  />
                  {trip.milestone_status && (
                    <MetaField
                      label="Estado cumplimiento"
                      value={trip.milestone_status}
                      highlight
                    />
                  )}
                  {trip.pipeline_updated_at && (
                    <MetaField
                      label="Sincronización pipeline"
                      value={fmtDT(trip.pipeline_updated_at)}
                      icon={<RefreshCw size={9} className="text-gray-400 shrink-0" />}
                    />
                  )}
                </div>
              </section>

              {/* Indicadores (flags readonly) */}
              <section>
                <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                  Indicadores
                </h4>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: 'Activo',     val: trip.activo,         on: 'bg-blue-50   text-blue-700   border-blue-200',   off: 'bg-gray-50 text-gray-300 border-gray-100' },
                    { label: 'Trabajando', val: trip.trabajando,     on: 'bg-green-50  text-green-700  border-green-200',  off: 'bg-gray-50 text-gray-300 border-gray-100' },
                    { label: 'Asignado',   val: trip.asignado,       on: 'bg-violet-50 text-violet-700 border-violet-200', off: 'bg-gray-50 text-gray-300 border-gray-100' },
                    { label: '1ra Vuelta', val: trip.primera_vuelta, on: 'bg-amber-50  text-amber-700  border-amber-200',  off: 'bg-gray-50 text-gray-300 border-gray-100' },
                  ].map(f => (
                    <span
                      key={f.label}
                      className={`text-[11px] font-semibold px-3 py-1 rounded-full border ${f.val ? f.on : f.off}`}
                    >
                      {f.label}
                    </span>
                  ))}
                </div>
              </section>

              {/* Paradas */}
              {(trip.stops?.length ?? 0) > 0 && (
                <section>
                  <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                    <MapPin size={11} /> Paradas ({trip.stops.length})
                  </h4>
                  <div className="overflow-x-auto -mx-4 md:-mx-6">
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
                            <th className="px-3 py-2 text-center min-w-[52px]">
                              <Thermometer size={10} className="inline" />
                            </th>
                            <th className="px-3 py-2 text-center min-w-[68px]">On Time</th>
                            <th className="px-3 py-2 text-left min-w-[100px]">Estado SAP</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                          {trip.stops.map((stop, i) => {
                            const rowBg =
                              stop.on_time_status === 'ON TIME'  ? 'bg-green-50/40' :
                              stop.on_time_status === 'OFF TIME' ? 'bg-amber-50/40' :
                              i % 2 === 1 ? 'bg-gray-50/40' : 'bg-white'

                            return (
                              <tr key={stop.stop_id ?? i} className={rowBg}>
                                <td className={`px-3 py-2 sticky left-0 z-10 ${rowBg}`}>
                                  <p className="font-medium text-slate-700 leading-snug">
                                    {stop.local ?? '—'}
                                  </p>
                                  {stop.destination_city && (
                                    <p className="text-[9px] text-gray-400 mt-0.5">
                                      {stop.destination_city}
                                      {stop.destination_region ? `, ${stop.destination_region}` : ''}
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
                                  {stop.s2s
                                    ? <span className="text-[9px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{stop.s2s}</span>
                                    : <span className="text-gray-200">—</span>}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  {stopWasVisited(stop) && stop.temperature != null
                                    ? <span className="text-sm font-mono text-blue-600 font-semibold">{stop.temperature}°C</span>
                                    : <span className="text-gray-200">—</span>}
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
                                  {stop.milestone_status
                                    ? <span className="text-[9px] text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded leading-snug block">{stop.milestone_status}</span>
                                    : <span className="text-gray-200">—</span>}
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
            </div>
          )}

          {/* ── TAB: EMPRESA ────────────────────────────────────────── */}
          {activeTab === 'empresa' && (
            <div className="p-4 md:p-6 space-y-5">
              <section>
                <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <Building2 size={11} /> Empresa de Transporte
                </h4>
                {trip.transporter_profile_id ? (
                  <div className="flex items-center justify-between bg-accent/5 rounded-xl px-4 py-3 border border-accent/15">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{trip.transporter ?? '—'}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5 font-mono">{trip.tractor_plate ?? ''}</p>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        await tripsApi.removeFleetLink(trip.id)
                        onSaved({ ...trip, transporter_profile_id: null, fleet_link_id: null })
                      }}
                      className="text-xs text-gray-400 hover:text-red-400 transition-colors"
                    >
                      Desvincular
                    </button>
                  </div>
                ) : (
                  <TransporterAssignSection
                    tripId={trip.id}
                    currentTransporter={trip.transporter}
                    onAssigned={onSaved}
                  />
                )}
              </section>

              {trip.transporter_tms && (
                <section>
                  <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                    Empresa reportada por TMS
                  </h4>
                  <p className="text-sm text-slate-600">{trip.transporter_tms}</p>
                </section>
              )}
            </div>
          )}

          {/* ── TAB: BITÁCORA ───────────────────────────────────────── */}
          {activeTab === 'bitacora' && (
            <div className="p-4 md:p-6 space-y-4">

              <div className="flex items-center justify-between pb-3 border-b border-border/60">
                <h4 className="text-xs font-bold text-accent uppercase tracking-wider">
                  Bitácora Operativa
                </h4>
                <span className="flex h-2.5 w-2.5 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent/60 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-accent" />
                </span>
              </div>

              {/* Flags editables */}
              <div>
                <p className="text-[10px] font-bold text-gray-500 uppercase mb-2">Indicadores</p>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { field: 'activo'         as const, label: 'Activo'     },
                    { field: 'trabajando'     as const, label: 'Trabajando' },
                    { field: 'asignado'       as const, label: 'Asignado'   },
                    { field: 'primera_vuelta' as const, label: '1ra Vuelta' },
                  ]).map(({ field, label }) => (
                    <label
                      key={field}
                      className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none"
                    >
                      <input
                        type="checkbox"
                        checked={!!form[field]}
                        onChange={e => setForm(f => ({ ...f, [field]: e.target.checked }))}
                        className="w-3.5 h-3.5 rounded border-border text-accent focus:ring-accent/30 accent-[var(--accent)]"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Estado TMS (readonly) */}
              <div>
                <p className="text-[10px] font-bold text-gray-500 uppercase mb-1.5">Estado TMS</p>
                {(() => {
                  const sm = trip.current_status ? meta?.statuses.find(s => s.id === trip.current_status) : null
                  return (
                    <span
                      className="inline-flex px-2.5 py-1 rounded-full text-[11px] font-semibold"
                      style={sm
                        ? { backgroundColor: sm.bg_color, color: sm.text_color }
                        : { backgroundColor: '#f3f4f6', color: '#6b7280' }}
                    >
                      {trip.current_status ?? '—'}
                    </span>
                  )
                })()}
              </div>

              {/* Override manual */}
              <div>
                <p className="text-[10px] font-bold text-gray-500 uppercase mb-1.5">Override manual</p>

                {trip.estado_manual ? (
                  /* Override activo — mostrar badge + quitar */
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
                    <button
                      type="button"
                      onClick={handleClearOverride}
                      disabled={clearingOverride}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-400 transition-colors disabled:opacity-50"
                    >
                      {clearingOverride
                        ? <Loader2 size={11} className="animate-spin" />
                        : <X size={11} />}
                      Quitar override
                    </button>
                  </div>
                ) : showEstadoSelect ? (
                  /* Seleccionando nuevo override */
                  <div className="space-y-1.5">
                    <select
                      autoFocus
                      value={form.estado_manual ?? ''}
                      onChange={e => setForm(f => ({ ...f, estado_manual: e.target.value }))}
                      className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent/30"
                    >
                      <option value="">— Seleccionar estado…</option>
                      {(meta?.operational_states ?? []).map(s => (
                        <option key={s.id} value={s.id}>{s.label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => { setShowEstadoSelect(false); setForm(f => ({ ...f, estado_manual: '' })) }}
                      className="text-[10px] text-gray-400 hover:text-gray-600"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  /* Sin override */
                  <button
                    type="button"
                    onClick={() => setShowEstadoSelect(true)}
                    className="text-xs text-accent hover:text-accent/80 transition-colors flex items-center gap-1"
                  >
                    + Establecer override
                  </button>
                )}
              </div>

              {/* Observaciones */}
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1.5">Observaciones</label>
                <textarea
                  rows={3}
                  value={form.observaciones ?? ''}
                  onChange={e => setForm(f => ({ ...f, observaciones: e.target.value }))}
                  placeholder="Novedad operativa…"
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent/30 resize-none"
                />
              </div>

              {/* Comentarios */}
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1.5">Comentarios</label>
                <textarea
                  rows={3}
                  value={form.comentarios ?? ''}
                  onChange={e => setForm(f => ({ ...f, comentarios: e.target.value }))}
                  placeholder="Comentario adicional…"
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent/30 resize-none"
                />
              </div>

              {err && (
                <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</p>
              )}

              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="w-full flex items-center justify-center gap-2 bg-accent text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-accent/90 disabled:opacity-60 transition-colors"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                Guardar Bitácora
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
