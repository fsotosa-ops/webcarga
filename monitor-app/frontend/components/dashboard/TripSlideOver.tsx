'use client'

import { useState, useEffect, useRef } from 'react'
import {
  X, Copy, Check,
  Truck, User, Phone, Hash, MapPin,
} from 'lucide-react'
import type { Trip, TripsMeta } from '@/lib/types'
import { tripsApi } from '@/lib/api/trips'
import { getLatestTemp, stopWasVisited, classifyTemperature, getActiveStop, describeStopTiming } from '@/lib/utils/temperature'
import { stopComplianceSummary } from '@/lib/utils/compliance'
import { fmtDT, formatRelativeTime, toDatetimeLocalValue } from '@/lib/utils/datetime'
import { TMS_LOGIN_URLS } from '@/lib/utils/tmsLinks'
import { StopTimeline } from './StopTimeline'
import { TripNotesFeed } from './TripNotesFeed'
import { useTripNotes } from '@/hooks/useTripNotes'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { OperationTypeBadge } from '@/components/ui/OperationTypeBadge'
import { GestionPanel } from './GestionPanel'

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  trip:        Trip | null
  onClose:     () => void
  onSaved:     (updated: Trip) => void
  meta?:       TripsMeta | null
  focusNotes?: boolean
}

export function TripSlideOver({ trip, onClose, onSaved, meta, focusNotes = false }: Props) {
  const [copiedField, setCopiedField]           = useState<'external' | 'internal' | null>(null)
  const panelRef                                = useRef<HTMLDivElement>(null)
  const notesRef                                = useRef<HTMLElement>(null)
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

  // Ítem 6.5 de la minuta (10/07): el badge de la tabla principal abre el
  // detalle directo en la Bitácora en vez de que el operador tenga que
  // scrollear a buscarla — no hay tabs en este panel, así que "abrir en la
  // Bitácora" es llevar el scroll ahí, no cambiar de vista.
  useEffect(() => {
    if (!trip || !focusNotes) return
    notesRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [trip?.id, focusNotes])

  useEffect(() => {
    if (!trip) return
    setCopiedField(null)
  }, [trip?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Desc. Inicio/Fin (esquema de fechas 2026-07-17): override manual de lo
  // que reporta el TMS por parada — incluye el origen desde que se unificó
  // como parada 0 (Fase 1, 2026-07-18; antes vivía aparte como
  // trip.cag_inicio_at/cag_fin_at, "Carga Inicio/Fin"). Guardado directo al
  // cambiar, sin botón aparte — mismo patrón que onExpirationChange en
  // DocumentChecklist.
  const [stopSaving, setStopSaving] = useState<string | null>(null)

  async function handleStopFieldChange(
    stopId: string,
    field: 'desc_inicio' | 'desc_fin' | 'arrival' | 'departure' | 'gps_arrival' | 'gps_departure',
    value: string,
  ) {
    if (!trip) return
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

          <GestionPanel trip={trip} meta={meta} onSaved={onSaved} />

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
                        {/* HU-14 (Fase 0, 2026-07-21): orden y nomenclatura
                            alineados a lo que Pablo pidió explícitamente en
                            la reunión del 20/07 (transcript líneas 554-557):
                            Plan. → GPS Llegada/Salida → Llegada/Salida TR
                            (híbrido) → Desc. Inicio/Fin. Antes GPS aparecía
                            DESPUÉS de Llegada/Salida y con el mismo nombre
                            genérico que el campo híbrido — ambigüedad real
                            detectada en vivo durante la reunión, no solo de
                            documentación (los datos en sí ya son correctos,
                            verificado contra Supabase: 0 filas con
                            gps_departure_date = planning_date). */}
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
                              {/* GPS Llegada/Salida y Llegada/Salida TR: generalización del
                                  override manual (bitácora 2026-07-29, hoja
                                  "campos-seguimiento-viajes") — editables solo en destinos
                                  (el origen no tiene un concepto real de llegada, ver plan).
                                  Sodimac nunca reporta estos 4 campos vía TMS; con esto el
                                  equipo de operaciones puede cargarlos a mano.

                                  BUG REAL (2026-07-29, reportado en vivo por el usuario en el
                                  viaje 30182422): el widget nativo de Chrome para
                                  datetime-local renderiza en 12h (am/pm), inconsistente con
                                  fmtDT() (siempre 24h, hour12:false explícito) usado en "Plan.".
                                  Se probó `lang="en-GB"` (workaround documentado en la web) y
                                  se descartó — verificado en vivo contra este mismo browser que
                                  Chrome ignora el atributo `lang` por elemento para este
                                  control y usa el locale de la app (es-419 en este entorno) sin
                                  importar el valor de `lang`. Fix real: el texto nativo del
                                  input queda transparente y un <span> encima (pointer-events
                                  none, así los clics igual abren el date-picker nativo)
                                  muestra fmtDT() — mismo formato exacto que "Plan." en reposo.
                                  Al enfocar el campo para editar, el texto nativo (aunque sea
                                  12h) vuelve a ser visible para dar feedback en vivo mientras
                                  se escribe; al perder el foco vuelve a mostrarse el overlay
                                  24h con el valor ya guardado. */}
                              {isOrigin ? (
                                <td className="px-3 py-2 font-mono text-[10px] text-gray-500 whitespace-nowrap">{fmtDT(stop.gps_arrival_date)}</td>
                              ) : (
                                <td className="px-2 py-1">
                                  <div className="relative">
                                    <input
                                      key={`${stop.stop_id}-gps_arrival-${stop.gps_arrival_date ?? ''}`}
                                      type="datetime-local"
                                      aria-label={`GPS Llegada de ${stop.local ?? 'parada'}`}
                                      defaultValue={toDatetimeLocalValue(stop.gps_arrival_date)}
                                      onBlur={e => e.target.value && stop.stop_id && handleStopFieldChange(stop.stop_id, 'gps_arrival', e.target.value)}
                                      disabled={stopSaving === stop.stop_id}
                                      className={`peer w-full text-[10px] font-mono border rounded px-1 py-0.5 text-transparent focus:text-inherit focus:outline-none focus:ring-1 focus:ring-accent/30 bg-white disabled:opacity-50 ${stop.gps_arrival_manual ? 'border-accent/40 text-accent' : 'border-border text-gray-500'}`}
                                    />
                                    <span className="absolute inset-0 flex items-center px-1 text-[10px] font-mono pointer-events-none peer-focus:opacity-0 truncate">{fmtDT(stop.gps_arrival_date)}</span>
                                  </div>
                                </td>
                              )}
                              {isOrigin ? (
                                <td className="px-3 py-2 font-mono text-[10px] text-gray-500 whitespace-nowrap">{fmtDT(stop.gps_departure_date)}</td>
                              ) : (
                                <td className="px-2 py-1">
                                  <div className="relative">
                                    <input
                                      key={`${stop.stop_id}-gps_departure-${stop.gps_departure_date ?? ''}`}
                                      type="datetime-local"
                                      aria-label={`GPS Salida de ${stop.local ?? 'parada'}`}
                                      defaultValue={toDatetimeLocalValue(stop.gps_departure_date)}
                                      onBlur={e => e.target.value && stop.stop_id && handleStopFieldChange(stop.stop_id, 'gps_departure', e.target.value)}
                                      disabled={stopSaving === stop.stop_id}
                                      className={`peer w-full text-[10px] font-mono border rounded px-1 py-0.5 text-transparent focus:text-inherit focus:outline-none focus:ring-1 focus:ring-accent/30 bg-white disabled:opacity-50 ${stop.gps_departure_manual ? 'border-accent/40 text-accent' : 'border-border text-gray-500'}`}
                                    />
                                    <span className="absolute inset-0 flex items-center px-1 text-[10px] font-mono pointer-events-none peer-focus:opacity-0 truncate">{fmtDT(stop.gps_departure_date)}</span>
                                  </div>
                                </td>
                              )}
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
            <section ref={notesRef}>
              <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Bitácora</h4>
              <TripNotesFeed trip={trip} />
            </section>
          </div>
        </div>
      </div>
    </>
  )
}
