'use client'

import { useState, useEffect, useRef } from 'react'
import { X, Copy, Check, Truck, User, Phone, Hash, MapPin } from 'lucide-react'
import type { Trip, TripsMeta } from '@/lib/types'
import { tripsApi } from '@/lib/api/trips'
import { getLatestTemp, stopWasVisited, getActiveStop, describeStopTiming } from '@/lib/utils/temperature'
import { getStopStates } from '@/lib/utils/stopState'
import { fmtDT, formatRelativeTime, toDatetimeLocalValue } from '@/lib/utils/datetime'
import { TMS_LOGIN_URLS } from '@/lib/utils/tmsLinks'
import { StopTimeline } from './StopTimeline'
import { TripNotesFeed } from './TripNotesFeed'
import { useTripNotes } from '@/hooks/useTripNotes'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { OperationTypeBadge } from '@/components/ui/OperationTypeBadge'
import { AccordionSection } from './AccordionSection'
import { GestionPanel } from './GestionPanel'

interface Props {
  trip:        Trip
  onDismiss:   () => void
  onSaved:     (updated: Trip) => void
  meta?:       TripsMeta | null
  focusNotes?: boolean
}

export function TripDetailView({ trip, onDismiss, onSaved, meta, focusNotes = false }: Props) {
  const notesRef                      = useRef<HTMLElement>(null)
  const [stopSaving, setStopSaving]   = useState<string | null>(null)
  const [copiedField, setCopiedField] = useState<'external' | 'internal' | null>(null)
  const notesQuery = useTripNotes(trip.id)

  useEffect(() => {
    if (!focusNotes) return
    notesRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [trip.id, focusNotes])

  async function handleStopFieldChange(
    stopId: string,
    field: 'desc_inicio' | 'desc_fin' | 'arrival' | 'departure',
    value: string,
  ) {
    setStopSaving(stopId)
    try {
      const updated = await tripsApi.patchStop(trip.id, stopId, { [field]: value })
      onSaved(updated)
    } catch {
      // best-effort — la próxima edición reintenta; sin bloquear la tabla con un error persistente
    } finally {
      setStopSaving(null)
    }
  }

  function handleCopy(field: 'external' | 'internal', value: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 2000)
    })
  }

  const currentStatus = trip.manual_status ?? trip.current_status
  const tmsMeta       = trip.source_system ? meta?.tms_sources.find(t => t.id === trip.source_system.toLowerCase()) : null
  const tmsLabel      = tmsMeta?.label ?? trip.source_system?.toUpperCase().slice(0, 3) ?? '?'
  const tmsLoginUrl   = trip.source_system && trip.source_system !== 'manual' ? TMS_LOGIN_URLS[trip.source_system.toLowerCase()] : undefined
  const temp          = getLatestTemp(trip.stops ?? [])
  const tempStatus    = trip.temp_status

  const stops            = trip.stops ?? []
  const destinationStops = stops.filter(s => s.stop_type !== 'ORIGIN')
  const openIncidents    = (notesQuery.data ?? []).filter(n => n.note_type === 'incidente' && !n.resolved_at).length
  const activeStop  = getActiveStop(stops)
  const activeTiming = activeStop ? describeStopTiming(activeStop) : null
  // "Completadas" = destinos en estado 'done' según la misma fuente de
  // verdad que StopTimeline/StopPills (is_active), no on_time_status.
  const doneCount   = getStopStates(destinationStops).filter(s => s === 'done').length
  const tmsSince    = formatRelativeTime(trip.status_reported_at)
  const syncSince   = formatRelativeTime(trip.pipeline_updated_at)

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* ── Header — 1 fila compacta: identidad del viaje ── */}
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
          onClick={onDismiss}
          className="text-white/50 hover:text-white transition-colors shrink-0 p-1 rounded-lg hover:bg-white/10 ml-auto"
          aria-label="Cerrar detalle"
        >
          <X size={18} />
        </button>
      </div>

      {/* ── Hero — la historia del viaje ── */}
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

        <div className="flex items-center gap-2.5 flex-wrap text-[11px] text-gray-500">
          {destinationStops.length > 0 && (
            <span>{doneCount}/{destinationStops.length} paradas</span>
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

      {/* ── Body ── */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden">
        <GestionPanel trip={trip} meta={meta} onSaved={onSaved} />

        <div className="order-2 md:order-1 flex-1 min-w-0 md:overflow-y-auto p-4 md:p-6 space-y-5">
          {stops.length > 0 && (
            <AccordionSection
              title={<><MapPin size={11} /> Ruta ({stops.length} parada{stops.length === 1 ? '' : 's'})</>}
              defaultOpen
            >
              <StopTimeline stops={stops} />

              <div className="overflow-x-auto mt-3 -mx-4 md:-mx-6">
                <div className="min-w-[860px] px-4 md:px-6">
                  <table className="w-full text-xs border border-border/80 rounded-lg overflow-hidden">
                    <thead>
                      <tr className="bg-slate-800 text-[9px] font-bold text-slate-300 uppercase tracking-wide">
                        <th className="px-3 py-2 text-left sticky left-0 bg-slate-800 z-10 min-w-[120px]">Local</th>
                        <th className="px-3 py-2 text-left min-w-[82px]">Plan.</th>
                        <th className="px-3 py-2 text-left min-w-[82px]">GPS Llegada</th>
                        <th className="px-3 py-2 text-left min-w-[82px]">GPS Salida</th>
                        <th className="px-3 py-2 text-left min-w-[82px]">Llegada TR</th>
                        <th className="px-3 py-2 text-left min-w-[82px]">Salida TR</th>
                        <th className="px-3 py-2 text-left min-w-[82px]">Desc. inicio</th>
                        <th className="px-3 py-2 text-left min-w-[82px]">Desc. fin</th>
                        <th className="px-3 py-2 text-center min-w-[52px]">S2S</th>
                        <th className="px-3 py-2 text-center min-w-[52px]">°C</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {stops.map((stop, i) => {
                        const isOrigin = stop.stop_type === 'ORIGIN'
                        const rowBg =
                          isOrigin ? 'bg-slate-50' :
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
                              {/* Nº de entrega: va acá y no en una columna
                                  propia porque (a) pertenece a este destino,
                                  no es un dato independiente, y (b) esta celda
                                  es sticky — Facturación lo ve sin scrollear
                                  una tabla que ya tiene 10 columnas. Se listan
                                  todas: el caso de uso es cruzarlas contra un
                                  documento, un "+2" obligaría a otra vista. */}
                              {stop.delivery_numbers && stop.delivery_numbers.length > 0 && (
                                <p className="text-[9px] text-gray-500 mt-0.5">
                                  <span className="text-gray-400">
                                    {stop.delivery_numbers.length === 1 ? 'Entrega ' : 'Entregas '}
                                  </span>
                                  <span className="font-mono">{stop.delivery_numbers.join(' · ')}</span>
                                </p>
                              )}
                            </td>
                            <td className="px-3 py-2 font-mono text-[10px] text-gray-500 whitespace-nowrap">{fmtDT(stop.planning_date)}</td>
                            {/* GPS Llegada/GPS Salida: inamovibles (minuta 29/07 §4.2, dato
                                sagrado para disputas comerciales/seguros) — siempre de solo
                                lectura, origen y destino por igual, nunca un <input>. */}
                            <td className="px-3 py-2 font-mono text-[10px] text-gray-500 whitespace-nowrap">{fmtDT(stop.gps_arrival_date)}</td>
                            <td className="px-3 py-2 font-mono text-[10px] text-gray-500 whitespace-nowrap">{fmtDT(stop.gps_departure_date)}</td>
                            {isOrigin ? (
                              <td className="px-3 py-2 font-mono text-[10px] text-gray-500 whitespace-nowrap">{fmtDT(stop.arrival_date)}</td>
                            ) : (
                              <td className="px-2 py-1">
                                <div className="relative">
                                  <input
                                    key={`${stop.stop_id}-arrival-${stop.arrival_date ?? ''}`}
                                    type="datetime-local"
                                    aria-label={`Llegada TR de ${stop.local ?? 'parada'}`}
                                    defaultValue={toDatetimeLocalValue(stop.arrival_date)}
                                    onBlur={e => e.target.value && stop.stop_id && handleStopFieldChange(stop.stop_id, 'arrival', e.target.value)}
                                    disabled={stopSaving === stop.stop_id}
                                    className={`peer w-full text-[10px] font-mono border rounded px-1 py-0.5 text-transparent focus:text-inherit focus:outline-none focus:ring-1 focus:ring-accent/30 bg-white disabled:opacity-50 ${stop.arrival_manual ? 'border-accent/40 text-accent' : 'border-border text-gray-500'}`}
                                  />
                                  <span className="absolute inset-0 flex items-center px-1 text-[10px] font-mono pointer-events-none peer-focus:opacity-0 truncate">{fmtDT(stop.arrival_date)}</span>
                                </div>
                              </td>
                            )}
                            {isOrigin ? (
                              <td className="px-3 py-2 font-mono text-[10px] text-gray-500 whitespace-nowrap">{fmtDT(stop.departure_date)}</td>
                            ) : (
                              <td className="px-2 py-1">
                                <div className="relative">
                                  <input
                                    key={`${stop.stop_id}-departure-${stop.departure_date ?? ''}`}
                                    type="datetime-local"
                                    aria-label={`Salida TR de ${stop.local ?? 'parada'}`}
                                    defaultValue={toDatetimeLocalValue(stop.departure_date)}
                                    onBlur={e => e.target.value && stop.stop_id && handleStopFieldChange(stop.stop_id, 'departure', e.target.value)}
                                    disabled={stopSaving === stop.stop_id}
                                    className={`peer w-full text-[10px] font-mono border rounded px-1 py-0.5 text-transparent focus:text-inherit focus:outline-none focus:ring-1 focus:ring-accent/30 bg-white disabled:opacity-50 ${stop.departure_manual ? 'border-accent/40 text-accent' : 'border-border text-gray-500'}`}
                                  />
                                  <span className="absolute inset-0 flex items-center px-1 text-[10px] font-mono pointer-events-none peer-focus:opacity-0 truncate">{fmtDT(stop.departure_date)}</span>
                                </div>
                              </td>
                            )}
                            <td className="px-2 py-1">
                              <span className="text-[8px] text-gray-400 block leading-none mb-0.5">{opLabel} inicio</span>
                              <div className="relative">
                              <input
                                key={`${stop.stop_id}-desc_inicio-${stop.unload_start ?? ''}`}
                                type="datetime-local"
                                aria-label={`${opLabel} inicio de ${stop.local ?? 'parada'}`}
                                defaultValue={toDatetimeLocalValue(stop.unload_start)}
                                onBlur={e => e.target.value && stop.stop_id && handleStopFieldChange(stop.stop_id, 'desc_inicio', e.target.value)}
                                disabled={stopSaving === stop.stop_id}
                                className={`peer w-full text-[10px] font-mono border rounded px-1 py-0.5 text-transparent focus:text-inherit focus:outline-none focus:ring-1 focus:ring-accent/30 bg-white disabled:opacity-50 ${stop.desc_manual ? 'border-accent/40 text-accent' : 'border-border text-gray-500'}`}
                              />
                              <span className="absolute inset-0 flex items-center px-1 text-[10px] font-mono pointer-events-none peer-focus:opacity-0 truncate">{fmtDT(stop.unload_start)}</span>
                              </div>
                            </td>
                            <td className="px-2 py-1">
                              <span className="text-[8px] text-gray-400 block leading-none mb-0.5">{opLabel} fin</span>
                              <div className="relative">
                              <input
                                key={`${stop.stop_id}-desc_fin-${stop.unload_end ?? ''}`}
                                type="datetime-local"
                                aria-label={`${opLabel} fin de ${stop.local ?? 'parada'}`}
                                defaultValue={toDatetimeLocalValue(stop.unload_end)}
                                onBlur={e => e.target.value && stop.stop_id && handleStopFieldChange(stop.stop_id, 'desc_fin', e.target.value)}
                                disabled={stopSaving === stop.stop_id}
                                className={`peer w-full text-[10px] font-mono border rounded px-1 py-0.5 text-transparent focus:text-inherit focus:outline-none focus:ring-1 focus:ring-accent/30 bg-white disabled:opacity-50 ${stop.desc_manual ? 'border-accent/40 text-accent' : 'border-border text-gray-500'}`}
                              />
                              <span className="absolute inset-0 flex items-center px-1 text-[10px] font-mono pointer-events-none peer-focus:opacity-0 truncate">{fmtDT(stop.unload_end)}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-center">
                              {stop.s2s ? <span className="text-[9px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{stop.s2s}</span> : <span className="text-gray-200">—</span>}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {stopWasVisited(stop) && stop.temperature != null ? (
                                <span className={`text-sm font-mono font-semibold ${
                                  stop.temp_status === 'out_of_range' ? 'text-red-700 bg-red-50 px-1.5 py-0.5 rounded'
                                  : stop.temp_status === 'ok' ? 'text-green-700 bg-green-50 px-1.5 py-0.5 rounded'
                                  : 'text-blue-600'
                                }`}>{stop.temperature}°C</span>
                              ) : <span className="text-gray-200">—</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </AccordionSection>
          )}

          <section ref={notesRef}>
            <AccordionSection title="Bitácora" defaultOpen>
              <TripNotesFeed trip={trip} />
            </AccordionSection>
          </section>
        </div>
      </div>
    </div>
  )
}
