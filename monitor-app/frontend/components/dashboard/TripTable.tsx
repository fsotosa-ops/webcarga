'use client'

import { useState, useRef, useEffect } from 'react'
import { ArrowUpDown, ArrowUp, ArrowDown, Check } from 'lucide-react'
import type { Trip, TripStop, TripsMeta } from '@/lib/types'
import { getLatestTempStop, getActiveStop, describeStopTiming } from '@/lib/utils/temperature'
import { getStopStates } from '@/lib/utils/stopState'
import { normalizeUTC, fmtDate } from '@/lib/utils/datetime'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { OperationTypeBadge } from '@/components/ui/OperationTypeBadge'
import { InsuranceAlertBadge } from '@/components/ui/InsuranceAlertBadge'
import { PendingDocsBadge } from '@/components/ui/PendingDocsBadge'
import { DwellSeverityBadge } from '@/components/ui/DwellSeverityBadge'
import { TMS_LOGIN_URLS } from '@/lib/utils/tmsLinks'
import { dwellStatus } from '@/lib/utils/kpis'
import type { SortKey } from '@/hooks/useDiarioFilters'

/** Hipervínculo desde la patente hacia el TMS de origen (minuta §7A ítem 16).
 *  No es un deep-link autenticado a un viaje específico — decisión de
 *  seguridad explícita (ver tmsLinks.ts: la cuenta de scraping es
 *  compartida/sin trazabilidad por usuario). En cambio, el click abre el
 *  login del TMS Y copia el ID externo del viaje al portapapeles, para que
 *  el gestor lo pegue en la búsqueda del TMS apenas entra — mismo resultado
 *  operativo (llegar rápido al viaje) sin comprometer la cuenta compartida. */
function useCopyToClipboard() {
  const [copiedId, setCopiedId] = useState<string | null>(null)
  function copy(tripId: string, value: string) {
    navigator.clipboard?.writeText(value).catch(() => {})
    setCopiedId(tripId)
    window.setTimeout(() => setCopiedId(id => id === tripId ? null : id), 1500)
  }
  return { copiedId, copy }
}

export function TmsChip({ tms, meta, sourceTripId }: { tms: string; meta?: TripsMeta | null; sourceTripId?: string | null }) {
  const tm = meta?.tms_sources.find(x => x.id === tms.toLowerCase())
  const label = tm?.label ?? tms.toUpperCase().slice(0, 3)
  const style = tm
    ? { backgroundColor: tm.bg_color, color: tm.text_color, borderColor: `${tm.bg_color}80` }
    : { backgroundColor: '#f3f4f6', color: '#6b7280', borderColor: '#e5e7eb' }
  const loginUrl = TMS_LOGIN_URLS[tms.toLowerCase()]

  if (loginUrl) {
    return (
      <a
        href={loginUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={e => {
          e.stopPropagation()
          if (sourceTripId) navigator.clipboard?.writeText(sourceTripId).catch(() => {})
        }}
        title={sourceTripId ? `Abrir ${label} — ID ${sourceTripId} copiado para buscarlo` : `Abrir ${label}`}
        className="text-[9px] font-bold px-1.5 py-0.5 rounded border hover:opacity-75 transition-opacity"
        style={style}
      >
        {label}
      </a>
    )
  }
  return (
    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border" style={style}>
      {label}
    </span>
  )
}

/** Columna "Destinos" — solo destinos (el origen se ve en la columna
 *  "Origen · Carga"), mismo lenguaje visual que StopTimeline (check verde =
 *  visitada, anillo pulsante accent = activa, contorno gris = pendiente)
 *  para que hito 13 se vea igual en la tabla y en el detalle del viaje. */
function StopPills({ stops, meta }: { stops: TripStop[]; meta?: TripsMeta | null }) {
  const destinations = stops?.filter(s => s.stop_type !== 'ORIGIN') ?? []
  if (!destinations.length) return <span className="text-gray-200 text-xs">—</span>

  const states = getStopStates(destinations)

  return (
    <div className="flex flex-col gap-1">
      {destinations.map((stop, i) => {
        const name  = stop.local ?? stop.destination_city ?? '—'
        const state = states[i]
        return (
          <div key={stop.stop_id ?? i} className="flex items-center gap-1.5">
            <span
              className={`w-3 h-3 rounded-full shrink-0 flex items-center justify-center ${
                state === 'done'
                  ? 'bg-green-500 text-white'
                  : state === 'active'
                  ? 'bg-white border-2 border-accent ring-2 ring-accent/10'
                  : 'bg-white border-2 border-gray-200'
              }`}
            >
              {state === 'done' && <Check size={7} strokeWidth={3} />}
              {state === 'active' && <span className="w-1 h-1 rounded-full bg-accent animate-pulse" />}
            </span>
            <span
              title={name}
              className={`text-[11px] truncate max-w-[170px] ${
                state === 'active' ? 'font-bold text-slate-800' : state === 'done' ? 'text-gray-500' : 'text-gray-400'
              }`}
            >
              {name}
            </span>
            <OperationTypeBadge operationType={stop.operation_type} meta={meta} />
          </div>
        )
      })}
    </div>
  )
}

// Phones stored as JSON array string in driver_phone column
function parsePhones(raw: string | null): string[] {
  if (!raw) return []
  try {
    const p = JSON.parse(raw)
    if (Array.isArray(p)) return p.filter(Boolean)
  } catch { /* plain string */ }
  return [raw]
}

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey | null; sortDir: 'asc' | 'desc' }) {
  if (sortKey !== col) return <ArrowUpDown size={10} className="inline ml-0.5 text-gray-300" />
  if (sortDir === 'asc') return <ArrowUp size={10} className="inline ml-0.5 text-accent" />
  return <ArrowDown size={10} className="inline ml-0.5 text-accent" />
}

interface Props {
  trips:              Trip[]
  selectedId:         string | null
  onSelect:           (trip: Trip) => void
  onSelectFocusNotes: (trip: Trip) => void
  meta?:              TripsMeta | null
  /** Viajes cuyo último reporte TMS cambió en el refetch más reciente — glow sutil */
  updatedIds?:        Set<string>
  /** Ordenamiento server-side real (2026-08-02) — controlado por el padre
   *  (page.tsx/useDiarioFilters), ya no hay estado local ni reordenamiento
   *  en memoria: `trips` llega pre-ordenado del backend. */
  sortKey:            SortKey | null
  sortDir:            'asc' | 'desc'
  onSort:             (col: SortKey) => void
}

export function TripTable({ trips, selectedId, onSelect, onSelectFocusNotes, meta, updatedIds, sortKey, sortDir, onSort }: Props) {
  // Ítem 3 (feedback post-weekly 2026-07-22, ajustado Ronda 43): solo
  // Patente queda sticky (izquierda) — es fácil no notar que hay más
  // columnas fuera de vista sin scrollear. Sombra/gradiente en el borde que
  // corresponde, visible solo mientras hay contenido para ese lado —
  // desaparece sola al llegar al final.
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollEdges, setScrollEdges] = useState({ left: false, right: false })

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    function update() {
      if (!el) return
      setScrollEdges({
        left: el.scrollLeft > 4,
        right: el.scrollLeft < el.scrollWidth - el.clientWidth - 4,
      })
    }
    update()
    el.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [trips])

  if (trips.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-border p-12 text-center text-sm text-gray-400">
        Sin viajes para los filtros seleccionados
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">

      {/* ── Mobile: card list ─────────────────────────────────────── */}
      <div className="md:hidden divide-y divide-border/60">
        {trips.map(trip => {
          const isActive      = trip.id === selectedId
          const primaryPlate  = trip.tractor_plate ?? trip.trailer_plate ?? null
          const currentStatus = trip.manual_status ?? trip.current_status
          const dwell         = dwellStatus(trip, meta?.monitor_alert_rules ?? undefined)

          return (
            <div
              key={trip.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(trip)}
              onKeyDown={e => {
                if (e.key === 'Enter') onSelect(trip)
                else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  const sibling = e.key === 'ArrowDown'
                    ? e.currentTarget.nextElementSibling
                    : e.currentTarget.previousElementSibling
                  ;(sibling as HTMLElement | null)?.focus?.()
                }
              }}
              className={`px-4 py-3 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 ${
                updatedIds?.has(trip.id) ? 'bg-amber-50' :
                isActive ? 'bg-accent/5 border-l-2 border-l-accent' : 'hover:bg-gray-50/60'
              }`}
            >
              {/* fila 1: patente + temp + estado */}
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={`font-mono text-sm font-bold shrink-0 ${primaryPlate ? 'text-slate-800' : 'text-gray-300 italic font-normal text-xs'}`}>
                    {primaryPlate ?? 'sin patente'}
                  </span>
                  <PendingDocsBadge count={trip.tractor_pending_docs} critical={trip.tractor_pending_docs_critical} label="Tracto" compact />
                  <TmsChip tms={trip.source_system ?? ''} meta={meta} />
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {(() => {
                    // temp y tempStatus salen de LA MISMA parada: trip.temp_status
                    // es de nivel viaje y el backend lo apaga al entregarse la
                    // carga, así que en Historial nunca marcaba rojo aunque la
                    // lectura de la parada estuviera fuera de rango.
                    const tempStop = getLatestTempStop(trip.stops ?? [])
                    const temp = tempStop?.temperature ?? null
                    const tempStatus = tempStop?.temp_status ?? null
                    return temp != null
                      ? <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tempStatus === 'out_of_range' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>{temp}°C</span>
                      : null
                  })()}
                  <StatusBadge status={currentStatus} meta={meta} />
                  <DwellSeverityBadge
                    severity={dwell?.severity ?? null}
                    label={dwell?.label ?? null}
                    compact
                    onClick={e => { e.stopPropagation(); onSelectFocusNotes(trip) }}
                  />
                </div>
              </div>

              {/* fila 2: conductor */}
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs text-slate-600 truncate">
                  {trip.driver_name ?? <span className="text-gray-300 italic text-[11px]">sin conductor</span>}
                </span>
                <PendingDocsBadge count={trip.driver_pending_docs} critical={trip.driver_pending_docs_critical} label="Conductor" compact />
              </div>

              {/* fila 3: EETT + origen */}
              <div className="flex items-center gap-1.5 mt-1 text-[10px] text-gray-400 min-w-0">
                {trip.carrier_id
                  ? <span className="font-medium text-slate-500 truncate max-w-[160px]">{trip.carrier_name}</span>
                  : <span className="italic">sin EETT</span>}
                <InsuranceAlertBadge alert={trip.insurance_alert} compact />
                <PendingDocsBadge count={trip.carrier_pending_docs} critical={trip.carrier_pending_docs_critical} label="Empresa" compact />
                {trip.origin && <><span>·</span><span className="truncate max-w-[100px]">{trip.origin}</span></>}
              </div>

              {/* fila 4: ETA de la parada activa */}
              {(() => {
                const activeStop = getActiveStop(trip.stops ?? [])
                const eta = activeStop ? describeStopTiming(activeStop) : null
                if (!eta) return null
                return (
                  <div className="flex items-center gap-1.5 mt-1 text-[10px] text-gray-400 min-w-0">
                    <span className="truncate">{eta}</span>
                  </div>
                )
              })()}
            </div>
          )
        })}
      </div>

      {/* ── Desktop: table ────────────────────────────────────────── */}
      <div className="hidden md:block relative">
        {scrollEdges.left && (
          <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-6 z-20 bg-gradient-to-r from-black/10 to-transparent" aria-hidden="true" />
        )}
        {scrollEdges.right && (
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 z-20 bg-gradient-to-l from-black/10 to-transparent" aria-hidden="true" />
        )}
        <div ref={scrollRef} className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 1080 }}>
            <thead>
              <tr className="bg-gray-50 border-b border-border text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                {/* ESTADO — columna fija (Hito 11, minuta 29/07 §4.3: "el
                    estado es lo primero que filtran"). Reemplaza a Patente
                    como única columna sticky al hacer scroll horizontal. */}
                <th onClick={() => onSort('current_status')} className="sticky left-0 z-10 bg-inherit border-r border-border/60 px-3 py-2.5 text-left w-[140px] cursor-pointer select-none hover:bg-gray-100 transition-colors">
                  Estado<SortIcon col="current_status" sortKey={sortKey} sortDir={sortDir} />
                  <span className="sr-only">, Abrir detalle</span>
                </th>
                <th onClick={() => onSort('planning_date')} className="px-3 py-2.5 text-left w-[92px] cursor-pointer select-none hover:bg-gray-100 transition-colors">Fecha<SortIcon col="planning_date" sortKey={sortKey} sortDir={sortDir} /></th>
                <th className="px-2 py-2.5 text-left w-[44px]">TMS</th>
                <th onClick={() => onSort('source_system_trip_id')} className="px-3 py-2.5 text-left w-[110px] cursor-pointer select-none hover:bg-gray-100 transition-colors">ID Viaje<SortIcon col="source_system_trip_id" sortKey={sortKey} sortDir={sortDir} /></th>
                <th onClick={() => onSort('tractor_plate')} className="px-3 py-2.5 text-left w-[110px] cursor-pointer select-none hover:bg-gray-100 transition-colors">Patente<SortIcon col="tractor_plate" sortKey={sortKey} sortDir={sortDir} /></th>
                <th onClick={() => onSort('driver_name')} className="px-3 py-2.5 text-left w-[150px] cursor-pointer select-none hover:bg-gray-100 transition-colors">Conductor<SortIcon col="driver_name" sortKey={sortKey} sortDir={sortDir} /></th>
                <th className="px-3 py-2.5 text-left w-[110px]">Teléfono</th>
                <th onClick={() => onSort('carrier_name')} className="px-3 py-2.5 text-left w-[130px] cursor-pointer select-none hover:bg-gray-100 transition-colors">EETT<SortIcon col="carrier_name" sortKey={sortKey} sortDir={sortDir} /></th>
                <th onClick={() => onSort('client_name')} className="px-3 py-2.5 text-left w-[100px] cursor-pointer select-none hover:bg-gray-100 transition-colors">Cliente<SortIcon col="client_name" sortKey={sortKey} sortDir={sortDir} /></th>
                <th className="px-3 py-2.5 text-left w-[110px]">Origen · Carga</th>
                <th className="px-3 py-2.5 text-left">Destinos</th>
                <th className="px-3 py-2.5 text-center w-[72px]">Temp</th>
              </tr>
            </thead>
            <tbody>
              {trips.map((trip, i) => {
                const isActive       = trip.id === selectedId
                const primaryPlate   = trip.tractor_plate ?? trip.trailer_plate ?? null
                const secondaryPlate = trip.tractor_plate && trip.trailer_plate ? trip.trailer_plate : null
                const currentStatus  = trip.manual_status ?? trip.current_status
                const phones         = parsePhones(trip.driver_phone)
                const dwell          = dwellStatus(trip, meta?.monitor_alert_rules ?? undefined)

                return (
                  <tr
                    key={trip.id}
                    tabIndex={0}
                    aria-selected={isActive}
                    onClick={() => onSelect(trip)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && e.target === e.currentTarget) onSelect(trip)
                      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        e.preventDefault()
                        const sibling = e.key === 'ArrowDown'
                          ? e.currentTarget.nextElementSibling
                          : e.currentTarget.previousElementSibling
                        ;(sibling as HTMLElement | null)?.focus?.()
                      }
                    }}
                    className={`border-b border-border/60 last:border-0 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 ${
                      updatedIds?.has(trip.id)
                        ? 'bg-amber-50'
                        : isActive
                        ? 'bg-sky-50 border-l-2 border-l-accent'
                        : i % 2 === 1
                        ? 'bg-gray-50 hover:bg-gray-100'
                        : 'bg-white hover:bg-gray-50'
                    }`}
                  >
                    {/* ESTADO — sticky: siempre visible al scrollear
                        horizontal (Hito 11, reemplaza a Patente). */}
                    <td className="sticky left-0 z-10 bg-inherit border-r border-border/60 px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <StatusBadge status={currentStatus} meta={meta} />
                          {trip.manual_status && (
                            <span className="text-[8px] text-accent block mt-0.5">override</span>
                          )}
                          <DwellSeverityBadge
                            severity={dwell?.severity ?? null}
                            label={dwell?.label ?? null}
                            onClick={e => { e.stopPropagation(); onSelectFocusNotes(trip) }}
                          />
                          {(() => {
                            const activeStop = getActiveStop(trip.stops ?? [])
                            const eta = activeStop ? describeStopTiming(activeStop) : null
                            return eta ? <span className="text-[9px] text-gray-400 block mt-0.5 truncate max-w-[100px]">{eta}</span> : null
                          })()}
                        </div>
                        {/* Los indicadores (Activo/Trabajando/Asignado) se ven
                            y filtran arriba de la tabla, se editan en el
                            detalle (Fase 3 del hardening del Diario, 2026-07-18). */}
                        <span className={`text-xs shrink-0 ${isActive ? 'text-accent' : 'text-gray-200'}`}>›</span>
                      </div>
                    </td>

                    {/* FECHA */}
                    <td className="px-3 py-2.5">
                      <p className="text-[11px] text-gray-700 font-medium whitespace-nowrap">
                        {fmtDate(trip.planning_date)}
                      </p>
                      {trip.status_reported_at && (
                        <p className="text-[9px] text-gray-300 whitespace-nowrap mt-0.5">
                          {new Intl.DateTimeFormat('es-CL', {
                            timeZone: 'America/Santiago',
                            hour: '2-digit', minute: '2-digit', second: '2-digit',
                            hour12: false,
                          }).format(new Date(normalizeUTC(trip.status_reported_at)))}
                        </p>
                      )}
                    </td>

                    {/* TMS */}
                    <td className="px-2 py-2.5">
                      <TmsChip tms={trip.source_system ?? ''} meta={meta} />
                    </td>

                    {/* ID VIAJE */}
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-[11px] text-gray-500">
                        {trip.source_system_trip_id ?? '—'}
                      </span>
                    </td>

                    {/* PATENTE — solo lectura (Fase 2, Plan 6) — se editaba
                        inline con PlateCell, ahora el mismo texto que ya
                        mostraba el card mobile, sin click-to-edit; clic en
                        cualquier parte de la fila abre el detalle. */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-start gap-1.5">
                        <div>
                          <span className={`font-mono text-xs font-bold ${primaryPlate ? 'text-slate-800' : 'text-gray-300 italic font-normal'}`}>
                            {primaryPlate ?? 'sin patente'}
                          </span>
                          {secondaryPlate && (
                            <span className="font-mono text-[10px] text-gray-400 mt-0.5 block">
                              {secondaryPlate}
                            </span>
                          )}
                        </div>
                        <PendingDocsBadge count={trip.tractor_pending_docs} critical={trip.tractor_pending_docs_critical} label="Tracto" compact />
                      </div>
                    </td>

                    {/* CONDUCTOR — solo lectura (Fase 2, Plan 6), antes ConductorCell */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-700 font-medium leading-tight">
                          {trip.driver_name ?? <span className="text-gray-300 italic">sin asignar</span>}
                        </span>
                        <PendingDocsBadge count={trip.driver_pending_docs} critical={trip.driver_pending_docs_critical} label="Conductor" compact />
                      </div>
                    </td>

                    {/* TELÉFONO — solo lectura (Fase 2, Plan 6), antes PhoneTagCell.
                        El enlace tel: conserva stopPropagation: llamar es una
                        acción distinta de abrir el detalle, no "editar". */}
                    <td className="px-3 py-2.5">
                      {phones.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {phones.map(p => (
                            <a
                              key={p}
                              href={`tel:${p}`}
                              onClick={e => e.stopPropagation()}
                              className="text-[10px] font-mono text-accent hover:underline block"
                            >
                              {p}
                            </a>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[10px] text-gray-300">—</span>
                      )}
                    </td>

                    {/* EETT */}
                    <td className="px-3 py-2.5">
                      {trip.carrier_id ? (
                        <>
                          <span className="text-xs font-medium text-slate-700 leading-tight block truncate max-w-[120px]">
                            {trip.carrier_name}
                          </span>
                          <div className="flex items-center gap-1 mt-0.5">
                            <InsuranceAlertBadge alert={trip.insurance_alert} />
                            <PendingDocsBadge count={trip.carrier_pending_docs} critical={trip.carrier_pending_docs_critical} label="Empresa" />
                          </div>
                        </>
                      ) : (
                        <span className="text-[10px] text-gray-300 italic">sin vincular</span>
                      )}
                    </td>

                    {/* CLIENTE */}
                    <td className="px-3 py-2.5">
                      <span className="text-[11px] text-gray-500 truncate block max-w-[100px]">
                        {trip.client_name ?? '—'}
                      </span>
                    </td>

                    {/* ORIGEN · CARGA */}
                    <td className="px-3 py-2.5">
                      <p className="text-[11px] text-gray-600 truncate max-w-[110px]">
                        {trip.origin ?? '—'}
                      </p>
                      {trip.cargo_type && (
                        <span className="text-[9px] text-gray-400 bg-gray-50 border border-gray-100 px-1 py-0.5 rounded mt-0.5 inline-block truncate max-w-[110px]">
                          {trip.cargo_type}
                        </span>
                      )}
                    </td>

                    {/* DESTINOS */}
                    <td className="px-3 py-2.5 max-w-[200px]">
                      <StopPills stops={trip.stops} meta={meta} />
                    </td>

                    {/* TEMP */}
                    <td className="px-3 py-2.5 text-center">
                      {(() => {
                        // Misma parada para temp y tempStatus (ver comentario
                        // en la card mobile) — trip.temp_status se apaga al
                        // entregarse la carga y ocultaba el rojo en Historial.
                        const tempStop = getLatestTempStop(trip.stops ?? [])
                        const temp = tempStop?.temperature ?? null
                        const tempStatus = tempStop?.temp_status ?? null
                        return temp != null
                          ? <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tempStatus === 'out_of_range' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>{temp}°C</span>
                          : <span className="text-gray-300 text-xs">—</span>
                      })()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
