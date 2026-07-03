'use client'

import { useState, useEffect } from 'react'
import {
  X, Loader2, Building2, Copy, Check,
  Truck, User, Phone, Hash,
  MapPin, ChevronDown, RotateCcw,
} from 'lucide-react'
import type { Trip, TransporterListItem, TripsMeta } from '@/lib/types'
import { tripsApi, type TripPatch, type FleetLinkPayload } from '@/lib/api/trips'
import { transportersApi } from '@/lib/api/transporters'
import { getLatestTemp, stopWasVisited, classifyTemperature } from '@/lib/utils/temperature'
import { fmtDT, fmtDate, formatRelativeTime } from '@/lib/utils/datetime'
import { StopTimeline } from './StopTimeline'
import { IndicatorDots } from './IndicatorDots'

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

interface Props {
  trip:    Trip | null
  onClose: () => void
  onSaved: (updated: Trip) => void
  meta?:   TripsMeta | null
}

export function TripSlideOver({ trip, onClose, onSaved, meta }: Props) {
  const [form, setForm]                         = useState<TripPatch>({})
  const [saving, setSaving]                     = useState(false)
  const [err, setErr]                           = useState<string | null>(null)
  const [saveErr, setSaveErr]                   = useState<string | null>(null)
  const [copied, setCopied]                     = useState(false)
  const [showEstadoSelect, setShowEstadoSelect] = useState(false)
  const [clearingOverride, setClearingOverride] = useState(false)
  const [empresaOpen, setEmpresaOpen]           = useState(false)
  const [techDetailOpen, setTechDetailOpen]     = useState(false)
  const [unlinkErr, setUnlinkErr]               = useState<string | null>(null)
  const [unlinking, setUnlinking]               = useState(false)

  useEffect(() => {
    if (!trip) return
    setForm({
      observaciones: trip.observaciones ?? '',
      comentarios:   trip.comentarios   ?? '',
    })
    setErr(null)
    setSaveErr(null)
    setCopied(false)
    setShowEstadoSelect(false)
    setEmpresaOpen(false)
    setTechDetailOpen(false)
    setUnlinkErr(null)
  }, [trip?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    if (!trip) return
    setSaving(true)
    setSaveErr(null)
    try {
      const payload: TripPatch = {
        observaciones: form.observaciones || undefined,
        comentarios:   form.comentarios   || undefined,
      }
      const updated = await tripsApi.patch(trip.id, payload)
      onSaved(updated)
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleSetOverride() {
    if (!trip || !form.estado_manual) return
    setSaving(true)
    setErr(null)
    try {
      const updated = await tripsApi.patch(trip.id, { estado_manual: form.estado_manual })
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
      setForm(f => ({ ...f, estado_manual: '' }))
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
  const statusMeta    = currentStatus ? meta?.statuses.find(s => s.id === currentStatus) : null
  const tmsMeta       = trip.source_system ? meta?.tms_sources.find(t => t.id === trip.source_system.toLowerCase()) : null
  const tmsLabel      = tmsMeta?.label ?? trip.source_system?.toUpperCase().slice(0, 3) ?? '?'
  const temp          = getLatestTemp(trip.stops ?? [])
  const tempStatus    = classifyTemperature(temp, trip.cargo_type, meta?.temperature_ranges ?? [])
  const isManualTrip  = trip.source_system === 'manual'

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

          {/* Row 2: Patente + Estado + Temp */}
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
            {temp != null && (
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${tempStatus === 'out_of_range' ? 'bg-red-500/20 text-red-300' : 'bg-blue-500/20 text-blue-300'}`}>
                {temp}°C
              </span>
            )}
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

        {/* ── Sincronización ────────────────────────────────────────── */}
        <div className="px-4 py-2 md:px-6 border-b border-border/80 bg-gray-50/60 shrink-0 flex items-center gap-1.5 text-[10.5px] text-gray-500">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
          <span>TMS reportó {formatRelativeTime(trip.status_reported_at)}</span>
          <span className="text-gray-300">·</span>
          <span>Pipeline sincronizó {formatRelativeTime(trip.pipeline_updated_at)}</span>
        </div>

        {/* ── Body — una sola vista, sin tabs ──────────────────────── */}
        <div className="flex-1 overflow-y-auto min-h-0 p-4 md:p-6 space-y-6">

          {/* Ruta — promovida, primer bloque del cuerpo */}
          {(trip.stops?.length ?? 0) > 0 && (
            <section>
              <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <MapPin size={11} /> Ruta ({trip.stops.length} parada{trip.stops.length === 1 ? '' : 's'})
              </h4>
              <StopTimeline stops={trip.stops} />

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
                        {trip.stops.map((stop, i) => {
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

          {/* Datos operativos — solo lectura */}
          <section className="bg-gray-50/60 rounded-xl p-4 md:p-5">
            <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">
              Datos operativos
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3">
              <MetaField label="Fecha planificación" value={fmtDate(trip.planning_date)} />
              <MetaField label="Origen" value={trip.origin ?? '—'} />
              <MetaField label="Tipo carga" value={trip.cargo_type ?? '—'} />
              <MetaField label="EETT TMS" value={trip.transporter_tms ?? '—'} />
              {trip.milestone_status && (
                <MetaField label="Estado cumplimiento" value={trip.milestone_status} highlight />
              )}
            </div>
          </section>

          {/* Gestión — editable */}
          <section className="bg-accent/5 border-l-[3px] border-l-accent rounded-xl p-4 md:p-5 space-y-5">
            <h4 className="text-[10px] font-bold text-accent uppercase tracking-widest">
              Gestión
            </h4>

            {/* Estado operativo */}
            <div>
              <h5 className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-2">Estado operativo</h5>
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                <span className="text-[9px] text-gray-400">TMS reporta:</span>
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
                    value={form.estado_manual ?? ''}
                    onChange={e => setForm(f => ({ ...f, estado_manual: e.target.value }))}
                    className="text-xs border border-border rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/30"
                  >
                    <option value="">— Seleccionar estado…</option>
                    {(meta?.operational_states ?? []).map(s => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </select>
                  <button type="button" onClick={handleSetOverride} disabled={saving || !form.estado_manual}
                    className="p-1.5 text-accent disabled:opacity-40">
                    {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  </button>
                  <button type="button" onClick={() => { setShowEstadoSelect(false); setForm(f => ({ ...f, estado_manual: '' })) }}
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
                <h5 className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-2">Indicadores</h5>
                <IndicatorDots trip={trip} onSaved={onSaved} size="md" />
              </div>
            )}

            {/* Empresa transportista — acordeón */}
            <div className="border border-border/60 rounded-lg overflow-hidden bg-white">
              <button
                type="button"
                onClick={() => setEmpresaOpen(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-50/60 transition-colors"
              >
                <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <Building2 size={12} /> Empresa transportista
                </span>
                <ChevronDown size={13} className={`text-gray-400 transition-transform ${empresaOpen ? 'rotate-180' : ''}`} />
              </button>
              {empresaOpen && (
                <div className="px-3 pb-3 space-y-4 border-t border-border/60 pt-3">
                  {trip.transporter_profile_id ? (
                    <div className="flex items-center justify-between bg-accent/5 rounded-xl px-4 py-3 border border-accent/15">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{trip.transporter ?? '—'}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5 font-mono">{trip.tractor_plate ?? ''}</p>
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
                        className="text-xs text-gray-400 hover:text-red-400 transition-colors disabled:opacity-50"
                      >
                        {unlinking ? <Loader2 size={12} className="animate-spin" /> : 'Desvincular'}
                      </button>
                    </div>
                  ) : (
                    <TransporterAssignSection
                      tripId={trip.id}
                      currentTransporter={trip.transporter}
                      onAssigned={onSaved}
                    />
                  )}
                  {unlinkErr && <p className="text-xs text-red-500">{unlinkErr}</p>}
                  {trip.transporter_tms && (
                    <div>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Empresa reportada por TMS</p>
                      <p className="text-sm text-slate-600">{trip.transporter_tms}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Bitácora — siempre visible, ya no es un acordeón independiente */}
            <div>
              <h5 className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-2">Bitácora — Observaciones y comentarios</h5>
              <div className="space-y-4">
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
                {saveErr && (
                  <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{saveErr}</p>
                )}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="w-full flex items-center justify-center gap-2 bg-accent text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-accent/90 disabled:opacity-60 transition-colors"
                >
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  Guardar notas
                </button>
              </div>
            </div>
          </section>

          {/* Footer secundario — auditoría, no compite por atención */}
          {(trip.created_at || trip.id) && (
            <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/40">
              {trip.created_at && <MetaField label="Ingresó al sistema" value={fmtDT(trip.created_at)} />}
              <p className="font-mono text-[9px] text-gray-300 shrink-0">{trip.id}</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
