'use client'

import { EntityCell } from './EntityCell'
import { useState, useEffect, useRef } from 'react'
import { X, Copy, Check, Truck, User, Phone, Hash, Ban, ArrowLeft } from 'lucide-react'
import type { Trip, TripsMeta } from '@/lib/types'
import { tripsApi } from '@/lib/api/trips'
import { getLatestTemp, stopWasVisited, getActiveStop, describeStopTiming } from '@/lib/utils/temperature'
import { getStopStates } from '@/lib/utils/stopState'
import { fmtDT, formatRelativeTime } from '@/lib/utils/datetime'
import { TMS_LOGIN_URLS } from '@/lib/utils/tmsLinks'
import { StopTimeline } from './StopTimeline'
import { TripNotesFeed } from './TripNotesFeed'
import { useTripNotes } from '@/hooks/useTripNotes'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { OperationTypeBadge } from '@/components/ui/OperationTypeBadge'
import { AccordionSection } from './AccordionSection'
import { GestionPanel } from './GestionPanel'
import { AnularViaje } from './AnularViaje'
import { StopTimeInput } from './StopTimeInput'
import { StatusChip } from '@/components/ui/StatusChip'
import { PageContainer } from '@/components/ui/PageContainer'

interface Props {
  trip:        Trip
  onDismiss:   () => void
  onSaved:     (updated: Trip) => void
  meta?:       TripsMeta | null
  focusNotes?: boolean
  /** Texto del vínculo de vuelta ("Volver al Cierre"). Sin él, sólo queda el ✕. */
  etiquetaVolver?: string
}

export function TripDetailView({ trip, onDismiss, onSaved, meta, focusNotes = false, etiquetaVolver }: Props) {
  const notesRef                      = useRef<HTMLElement>(null)
  const [stopSaving, setStopSaving]   = useState<string | null>(null)
  const [copiedField, setCopiedField] = useState<'external' | null>(null)
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

  function handleCopy(field: 'external', value: string) {
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
      {/* ── Header — 1 fila compacta: identidad del viaje. Blanca con borde, como la
          barra de la app (pasada visual 11/10); el azul solo en lo que se puede hacer clic. ── */}
      <div className="border-b border-border px-4 py-2.5 md:px-6 shrink-0 flex items-center gap-3 flex-wrap">
        {/* Dice adónde vuelve (spec 2026-10-10 §4): el ✕ de la derecha se queda,
            pero un ícono suelto no dice a qué pantalla lleva. */}
        {etiquetaVolver && (
          <button
            type="button"
            onClick={onDismiss}
            className="flex items-center gap-1 text-dato font-semibold text-accion hover:underline shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <ArrowLeft size={14} aria-hidden="true" /> {etiquetaVolver}
          </button>
        )}
        {tmsLoginUrl ? (
          <a
            href={tmsLoginUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={`Abrir en ${tmsMeta?.label ?? tmsLabel}`}
            className="text-etiqueta font-bold px-2 py-0.5 rounded-full shrink-0 bg-informativo/10 text-informativo hover:opacity-80 transition-opacity"
          >
            {tmsLabel}
          </a>
        ) : (
          <span
            className="text-etiqueta font-bold px-2 py-0.5 rounded-full shrink-0 bg-informativo/10 text-informativo"
          >
            {tmsLabel}
          </span>
        )}

        {trip.source_system_trip_id && (
          <span className="flex items-center gap-1.5 min-w-0">
            <Hash size={12} className="text-informativo shrink-0" aria-hidden="true" />
            <span className="font-identificador text-dato font-bold tabular-nums text-text-primary truncate">{trip.source_system_trip_id}</span>
            <button
              type="button"
              onClick={() => handleCopy('external', trip.source_system_trip_id!)}
              title="Copiar ID externo"
              aria-label="Copiar ID externo"
              className="text-informativo hover:text-text-primary transition-colors shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {copiedField === 'external' ? <Check size={12} className="text-resuelto" /> : <Copy size={12} />}
            </button>
          </span>
        )}
        {/* El UUID interno del viaje ya NO se muestra acá (2026-08-07, pedido
            de Operaciones): es una clave surrogada que no significa nada para
            quien opera — ellos identifican el viaje por su número de TMS, que
            es el que sí queda arriba. Para soporte/debug no se pierde nada:
            este mismo id es el segmento final de la URL
            (/operations/monitor/trips/[id]), copiable desde la barra de
            direcciones. */}

        <span className="flex items-center gap-1.5 shrink-0">
          <Truck size={14} className="text-informativo" aria-hidden="true" />
          {/* El tracto y el conductor llevan a su vista rápida (N2, Entrega 1 de fichas). */}
          <span className="font-identificador text-dato font-bold tabular-nums text-text-primary">
            {trip.tractor_plate
              ? <EntityCell kind="asset" id={trip.tractor_asset_id} label={trip.tractor_plate} mono />
              : trip.trailer_plate ?? 'Sin patente'}
          </span>
          {trip.tractor_plate && trip.trailer_plate && (
            <span className="font-identificador text-etiqueta tabular-nums text-informativo">/ {trip.trailer_plate}</span>
          )}
        </span>

        <span className="flex items-center gap-1.5 min-w-0">
          <User size={12} className="text-informativo shrink-0" aria-hidden="true" />
          <span className="text-dato text-text-primary truncate">
            <EntityCell kind="driver" id={trip.driver_id} label={trip.driver_name} />
          </span>
        </span>

        {trip.driver_phone && (
          <a
            href={`tel:${trip.driver_phone}`}
            className="flex items-center gap-1 text-dato font-identificador tabular-nums text-accion hover:underline shrink-0"
            onClick={e => e.stopPropagation()}
          >
            <Phone size={11} aria-hidden="true" />
            {trip.driver_phone}
          </a>
        )}

        {trip.client_name && (
          <span className="text-dato text-informativo truncate hidden sm:inline">· {trip.client_name}</span>
        )}

        <span className="ml-auto" />
        {/* Un viaje anulado sigue abierto en el detalle, con su insignia. */}
        <AnularViaje trip={trip} />
        <button
          onClick={onDismiss}
          className="text-informativo hover:text-text-primary transition-colors shrink-0 p-1.5 rounded-md border border-border hover:bg-bg-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          aria-label="Cerrar detalle"
        >
          <X size={16} />
        </button>
      </div>

      {trip.voided_at && (
        <div role="status" className="flex items-center gap-2 border-b border-status-incidente/20 bg-status-incidente/5 px-4 py-2 md:px-6 text-dato text-text-primary shrink-0">
          <Ban size={13} className="text-status-incidente shrink-0" />
          <span>
            <strong>Anulado</strong>
            {trip.voided_by_name && <> por {trip.voided_by_name}</>}
            {' · '}{fmtDT(trip.voided_at)}
            {trip.void_reason_label && <> · Motivo: {trip.void_reason_label}</>}
            {trip.void_note && <> · {trip.void_note}</>}
          </span>
        </div>
      )}

      {/* ── Hero — la historia del viaje ── */}
      <div data-testid="hero" className="px-4 py-3 md:px-6 border-b border-border shrink-0 space-y-1.5">
        <div className="flex items-center gap-2.5 flex-wrap">
          <StatusBadge status={currentStatus} meta={meta} fallbackLabel="Sin estado" />
          {trip.manual_status && <StatusChip tone="action">manual</StatusChip>}
          {activeStop && (
            <span className="text-lectura text-text-primary min-w-0">
              <span className="text-informativo">→</span>{' '}
              <span className="font-semibold">{activeStop.local ?? activeStop.destination_city ?? 'próxima parada'}</span>
              {activeTiming && <span className="text-informativo"> · {activeTiming}</span>}
            </span>
          )}
          {!activeStop && stops.length === 0 && (
            <span className="text-dato text-informativo">Sin paradas registradas</span>
          )}
        </div>

        <div className="flex items-center gap-2.5 flex-wrap text-etiqueta text-informativo">
          {destinationStops.length > 0 && (
            <span className="tabular-nums">{doneCount}/{destinationStops.length} paradas</span>
          )}
          {openIncidents > 0 && (
            <StatusChip tone="urgent">
              {openIncidents} incidente{openIncidents === 1 ? '' : 's'} abierto{openIncidents === 1 ? '' : 's'}
            </StatusChip>
          )}
          {temp != null && (
            tempStatus === 'out_of_range'
              ? <StatusChip tone="urgent">{temp}°C</StatusChip>
              : <span className="tabular-nums">{temp}°C</span>
          )}
          <span>
            TMS reportó {tmsSince}{syncSince !== '—' ? ` · sync ${syncSince}` : ''}
          </span>
          {trip.created_at && (
            <span>· en el Diario desde {fmtDT(trip.created_at)}</span>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden">
        {/* Un anulado es de solo lectura (la API responde 409): para editarlo se
            deshace la anulación, desde la barra de arriba. `contents` no altera el flex. */}
        <fieldset disabled={!!trip.voided_at} className="contents">
        <GestionPanel trip={trip} meta={meta} onSaved={onSaved} />

        <div className="order-2 md:order-1 flex-1 min-w-0 md:overflow-y-auto"><PageContainer>
          {stops.length > 0 && (
            <AccordionSection title={`Ruta (${stops.length} parada${stops.length === 1 ? '' : 's'})`} defaultOpen>
              <StopTimeline stops={stops} />

              <div className="overflow-x-auto mt-3 -mx-4 md:-mx-6">
                <div className="min-w-[960px] px-4 md:px-6">
                  {/* Encabezado claro, como las tablas del Cierre: el negro pesaba más que el dato. */}
                  <table className="w-full text-dato border border-border rounded-lg overflow-hidden">
                    <thead>
                      <tr className="bg-bg-main text-etiqueta font-semibold text-informativo uppercase tracking-wide">
                        <th className="px-3 py-2 text-left sticky left-0 bg-bg-main z-10 min-w-[220px]">Local</th>
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
                    <tbody className="divide-y divide-border">
                      {stops.map((stop, i) => {
                        const isOrigin = stop.stop_type === 'ORIGIN'
                        const opLabel = isOrigin ? 'Carga' : 'Desc.'
                        const place = stop.local ?? 'parada'
                        const saving = stopSaving === stop.stop_id
                        const commit = (field: 'desc_inicio' | 'desc_fin' | 'arrival' | 'departure') =>
                          (value: string) => { if (stop.stop_id) void handleStopFieldChange(stop.stop_id, field, value) }
                        const readOnlyCell = (value: string | null | undefined) => (
                          <td className="px-3 py-2 font-identificador text-etiqueta tabular-nums text-informativo whitespace-nowrap">{fmtDT(value)}</td>
                        )
                        return (
                          <tr key={stop.stop_id ?? i} className="bg-white">
                            <td className="px-3 py-2 sticky left-0 z-10 bg-white">
                              <p className="font-medium text-text-primary leading-snug flex items-center gap-1.5 flex-wrap">
                                {isOrigin && <StatusChip tone="action">Origen</StatusChip>}
                                {stop.local ?? '—'}
                                <OperationTypeBadge operationType={stop.operation_type} meta={meta} />
                              </p>
                              {stop.destination_city && (
                                <p className="text-etiqueta text-informativo mt-0.5">
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
                                <p className="text-etiqueta text-informativo mt-0.5">
                                  {stop.delivery_numbers.length === 1 ? 'Entrega ' : 'Entregas '}
                                  <span className="font-identificador tabular-nums text-text-primary">{stop.delivery_numbers.join(' · ')}</span>
                                </p>
                              )}
                            </td>
                            {readOnlyCell(stop.planning_date)}
                            {/* GPS Llegada/GPS Salida: inamovibles (minuta 29/07 §4.2, dato
                                sagrado para disputas comerciales/seguros) — siempre de solo
                                lectura, origen y destino por igual, nunca un <input>. */}
                            {readOnlyCell(stop.gps_arrival_date)}
                            {readOnlyCell(stop.gps_departure_date)}
                            {isOrigin ? readOnlyCell(stop.arrival_date) : (
                              <td className="px-2 py-1">
                                <StopTimeInput key={`${stop.stop_id}-arrival-${stop.arrival_date ?? ''}`}
                                               label={`Llegada TR de ${place}`} value={stop.arrival_date}
                                               manual={!!stop.arrival_manual} disabled={saving} onCommit={commit('arrival')} />
                              </td>
                            )}
                            {isOrigin ? readOnlyCell(stop.departure_date) : (
                              <td className="px-2 py-1">
                                <StopTimeInput key={`${stop.stop_id}-departure-${stop.departure_date ?? ''}`}
                                               label={`Salida TR de ${place}`} value={stop.departure_date}
                                               manual={!!stop.departure_manual} disabled={saving} onCommit={commit('departure')} />
                              </td>
                            )}
                            <td className="px-2 py-1">
                              <span className="block text-etiqueta text-informativo leading-none mb-1">{opLabel} inicio</span>
                              <StopTimeInput key={`${stop.stop_id}-desc_inicio-${stop.unload_start ?? ''}`}
                                             label={`${opLabel} inicio de ${place}`} value={stop.unload_start}
                                             manual={!!stop.desc_manual} disabled={saving} onCommit={commit('desc_inicio')} />
                            </td>
                            <td className="px-2 py-1">
                              <span className="block text-etiqueta text-informativo leading-none mb-1">{opLabel} fin</span>
                              <StopTimeInput key={`${stop.stop_id}-desc_fin-${stop.unload_end ?? ''}`}
                                             label={`${opLabel} fin de ${place}`} value={stop.unload_end}
                                             manual={!!stop.desc_manual} disabled={saving} onCommit={commit('desc_fin')} />
                            </td>
                            <td className="px-3 py-2 text-center">
                              {stop.s2s
                                ? <span className="text-etiqueta font-identificador tabular-nums bg-bg-main text-informativo px-1.5 py-0.5 rounded">{stop.s2s}</span>
                                : <span className="text-informativo">—</span>}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {stopWasVisited(stop) && stop.temperature != null ? (
                                <StatusChip tone={stop.temp_status === 'out_of_range' ? 'urgent' : stop.temp_status === 'ok' ? 'resolved' : 'neutral'}>
                                  {stop.temperature}°C
                                </StatusChip>
                              ) : <span className="text-informativo">—</span>}
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
        </PageContainer></div>
        </fieldset>
      </div>
    </div>
  )
}
