'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, Clock, Loader2, Building2 } from 'lucide-react'
import type { Trip, TransporterListItem } from '@/lib/types'
import { tripsApi, type TripPatch, type FleetLinkPayload } from '@/lib/api/trips'
import { transportersApi } from '@/lib/api/transporters'

const STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  'ASIGNADO':              { bg: '#e8eeff', text: '#053bfa' },
  'ORIGEN':                { bg: '#f3e8ff', text: '#8a00dd' },
  'RUTA':                  { bg: '#eef6e6', text: '#62a420' },
  'EN LOCAL':              { bg: '#fef0e6', text: '#ea6b25' },
  'RETORNANDO':            { bg: '#e6f8fd', text: '#0e8db5' },
  'RETORNADO CD':          { bg: '#f3f4f6', text: '#6b7280' },
  'VIAJE EN PREDIO':       { bg: '#f3f4f6', text: '#6b7280' },
  'CANCELADO':             { bg: '#fee2e2', text: '#b00020' },
  'CERRADO FINALIZADO':    { bg: '#f3f4f6', text: '#9ca3af' },
  'CERRADO INCOMPLETO':    { bg: '#fef3c7', text: '#d97706' },
  'CERRADO MANUAL':        { bg: '#f3f4f6', text: '#9ca3af' },
  'CERRADO SIN GPS':       { bg: '#f3f4f6', text: '#9ca3af' },
  'CERRADO POR OTRO VIAJE': { bg: '#f3f4f6', text: '#9ca3af' },
  'CERRADO FINALIZADO CC':  { bg: '#f3f4f6', text: '#9ca3af' },
  'EN PANA':                { bg: '#fee2e2', text: '#b00020' },
  'DEVUELTO':               { bg: '#fee2e2', text: '#b00020' },
}

const ESTADO_OPTIONS = [
  '', 'ASIGNADO', 'ORIGEN', 'RUTA', 'EN LOCAL', 'RETORNANDO',
  'RETORNADO CD', 'EN PANA', 'CANCELADO', 'CERRADO FINALIZADO',
]

const TMS_LABELS: Record<string, string> = {
  qanalytics: 'QA',
  wingsuite:  'WS',
  sodimac:    'SDM',
}


function TransporterAssignSection({
  tripId,
  currentTransporter,
  onAssigned,
}: {
  tripId: string
  currentTransporter: string | null
  onAssigned: (t: Trip) => void
}) {
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState<TransporterListItem[]>([])
  const [searching, setSearching] = useState(false)
  const [searchErr, setSearchErr] = useState<string | null>(null)
  const [saving, setSaving]   = useState(false)

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); setSearchErr(null); return }
    setSearching(true)
    setSearchErr(null)
    try {
      const res = await transportersApi.list({ q, page: 1, limit: 8 })
      setResults(res.data)
    } catch (e) {
      setSearchErr(e instanceof Error ? e.message : 'Error al buscar')
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [])

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
          onChange={e => { setQuery(e.target.value); search(e.target.value) }}
          className="w-full text-xs border border-border rounded-lg px-3 py-2 pr-7 focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        {searching && (
          <Loader2 size={12} className="animate-spin text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2" />
        )}
      </div>
      {searchErr && (
        <p className="text-[10px] text-red-500 px-1">{searchErr}</p>
      )}
      {results.length > 0 && (
        <ul className="border border-border rounded-lg divide-y divide-border overflow-hidden bg-white shadow-sm">
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

interface Props {
  trip:    Trip | null
  onClose: () => void
  onSaved: (updated: Trip) => void
}

export function TripSlideOver({ trip, onClose, onSaved }: Props) {
  const [form, setForm]     = useState<TripPatch>({})
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState<string | null>(null)

  useEffect(() => {
    if (!trip) return
    setForm({
      estado_manual:  trip.estado_manual  ?? '',
      observaciones:  trip.observaciones  ?? '',
      comentarios:    trip.comentarios    ?? '',
    })
    setErr(null)
  }, [trip?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    if (!trip) return
    setSaving(true)
    setErr(null)
    try {
      const payload: TripPatch = {
        estado_manual: form.estado_manual || undefined,
        observaciones: form.observaciones || undefined,
        comentarios:   form.comentarios   || undefined,
      }
      const updated = await tripsApi.patch(trip.id, payload)
      onSaved(updated)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const isOpen = !!trip
  const tmsLabel = trip?.tms_name ? (TMS_LABELS[trip.tms_name] ?? trip.tms_name) : null
  const currentStatus = trip?.estado_manual ?? trip?.current_status
  const statusColor = currentStatus ? STATUS_COLOR[currentStatus] : null

  if (!isOpen || !trip) return null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />

      {/* Full-screen modal */}
      <div className="fixed inset-0 z-50 flex flex-col bg-white md:inset-6 md:rounded-2xl md:shadow-2xl overflow-hidden">

        {/* ── Header ──────────────────────────────────────────────── */}
        <div className="bg-slate-900 px-6 py-4 flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 mb-1.5 flex-wrap">
              <h2 className="text-lg font-bold text-white font-mono tracking-wide">
                {trip.tractor_plate ?? 'Sin patente'}
              </h2>
              {statusColor && (
                <span
                  className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full shrink-0"
                  style={{ backgroundColor: statusColor.bg, color: statusColor.text }}
                >
                  {currentStatus}
                </span>
              )}
              {tmsLabel && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-white/10 text-white/60">
                  {tmsLabel}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-sm text-white/70">
                {trip.driver_name ?? '—'}
                {trip.driver_rut && (
                  <span className="font-mono ml-1.5 text-white/40 text-[11px]">{trip.driver_rut}</span>
                )}
              </p>
              {trip.driver_phone && (
                <a
                  href={`tel:${trip.driver_phone}`}
                  className="text-[11px] font-mono text-accent/80 hover:text-accent"
                  onClick={e => e.stopPropagation()}
                >
                  {trip.driver_phone}
                </a>
              )}
              {trip.client_name && (
                <span className="text-[11px] text-white/35">{trip.client_name}</span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white transition-colors shrink-0 mt-1 p-1"
          >
            <X size={20} />
          </button>
        </div>

        {/* ── Body — 2-column on md+ ──────────────────────────────── */}
        <div className="flex-1 overflow-hidden flex flex-col md:flex-row min-h-0">

          {/* LEFT — info + stops + empresa */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 border-b md:border-b-0 md:border-r border-border/60">

            {/* Trip metadata */}
            <section className="grid grid-cols-2 gap-3">
              {[
                { label: 'Fecha',  value: trip.planning_date
                    ? new Date(trip.planning_date + 'T12:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })
                    : '—' },
                { label: 'Origen', value: trip.origin ?? '—' },
                { label: 'Tipo carga', value: trip.cargo_type ?? '—' },
                { label: 'EETT TMS',   value: trip.transporter_tms ?? '—' },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
                  <p className="text-sm text-slate-700">{value}</p>
                </div>
              ))}
            </section>

            {/* Paradas */}
            {(trip.stops?.length ?? 0) > 0 && (
              <section>
                <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">
                  Paradas ({trip.stops.length})
                </h4>
                <div className="space-y-2.5">
                  {trip.stops.map((stop, i) => (
                    <div key={stop.stop_id ?? i} className="flex items-start gap-3">
                      <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                        stop.on_time_status === 'ON TIME' ? 'bg-green-400' : 'bg-amber-400'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700">
                          {stop.local ?? stop.destination_city ?? '—'}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {stop.on_time_status && (
                            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                              stop.on_time_status === 'ON TIME'
                                ? 'bg-green-50 text-green-600'
                                : 'bg-amber-50 text-amber-600'
                            }`}>
                              {stop.on_time_status}
                            </span>
                          )}
                          {stop.gps_arrival_date && (
                            <span className="text-[10px] text-gray-400 flex items-center gap-1">
                              <Clock size={9} />
                              {new Date(stop.gps_arrival_date).toLocaleString('es-CL', {
                                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                              })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Empresa de Transporte */}
            <section>
              <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <Building2 size={10} /> Empresa de Transporte
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
          </div>

          {/* RIGHT — bitácora */}
          <div className="w-full md:w-[380px] shrink-0 overflow-y-auto p-6">
            <div className="space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-border/60">
                <h4 className="text-xs font-bold text-accent uppercase tracking-wider">
                  Bitácora Operativa
                </h4>
                <span className="flex h-2.5 w-2.5 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent/60 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-accent" />
                </span>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1.5">Estado</label>
                <select
                  value={form.estado_manual ?? ''}
                  onChange={e => setForm(f => ({ ...f, estado_manual: e.target.value }))}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent/30"
                >
                  {ESTADO_OPTIONS.map(s => (
                    <option key={s} value={s}>{s || 'Usar estado del TMS'}</option>
                  ))}
                </select>
              </div>

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
          </div>
        </div>
      </div>
    </>
  )
}
