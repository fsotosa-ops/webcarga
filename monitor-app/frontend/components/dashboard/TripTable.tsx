'use client'

import { useState, useMemo } from 'react'
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import type { Trip, TripStop, TripsMeta } from '@/lib/types'
import { getLatestTemp, classifyTemperature, getActiveStop, describeStopTiming } from '@/lib/utils/temperature'
import { stopComplianceSummary } from '@/lib/utils/compliance'
import { formatRelativeTime, normalizeUTC } from '@/lib/utils/datetime'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { OperationTypeBadge } from '@/components/ui/OperationTypeBadge'
import { InsuranceAlertBadge } from '@/components/ui/InsuranceAlertBadge'
import { PendingDocsBadge } from '@/components/ui/PendingDocsBadge'


export function TmsChip({ tms, meta }: { tms: string; meta?: TripsMeta | null }) {
  const tm = meta?.tms_sources.find(x => x.id === tms.toLowerCase())
  const label = tm?.label ?? tms.toUpperCase().slice(0, 3)
  return (
    <span
      className="text-[9px] font-bold px-1.5 py-0.5 rounded border"
      style={tm
        ? { backgroundColor: tm.bg_color, color: tm.text_color, borderColor: `${tm.bg_color}80` }
        : { backgroundColor: '#f3f4f6', color: '#6b7280', borderColor: '#e5e7eb' }}
    >
      {label}
    </span>
  )
}

function StopPills({ stops, meta }: { stops: TripStop[]; meta?: TripsMeta | null }) {
  if (!stops?.length) return <span className="text-gray-200 text-xs">—</span>

  const isCompleted = (s: TripStop) =>
    !!(s.arrival_date || s.gps_arrival_date || s.on_time_status)
  const currentIdx = stops.findIndex(s => !isCompleted(s))
  const activeIdx  = currentIdx >= 0 ? currentIdx : stops.length - 1

  return (
    <div className="flex flex-col gap-0.5">
      {stops.map((stop, i) => {
        const name     = stop.local ?? stop.destination_city ?? '—'
        const isActive = i === activeIdx
        const isDone   = currentIdx < 0 ? isCompleted(stop) : i < activeIdx
        return (
          <div key={stop.stop_id ?? i} className="flex items-center gap-1">
            <span
              title={name}
              className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full w-fit max-w-[120px] truncate flex items-center gap-1 ${
                isActive
                  ? 'bg-accent/10 text-accent border border-accent/20'
                  : isDone
                  ? 'text-gray-300 bg-gray-50'
                  : 'text-gray-200'
              }`}
            >
              {stop.on_time_status && (
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${stop.on_time_status === 'ON TIME' ? 'bg-green-500' : 'bg-red-500'}`} />
              )}
              {isActive && <span className="shrink-0 text-[8px]">→</span>}
              {isDone && !isActive && <span className="shrink-0 text-[8px]">✓</span>}
              <span className="truncate">{name}</span>
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

type SortKey = 'planning_date' | 'tractor_plate' | 'driver_name' | 'carrier_name' | 'client_name' | 'current_status' | 'source_system_trip_id'

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey | null; sortDir: 'asc' | 'desc' }) {
  if (sortKey !== col) return <ArrowUpDown size={10} className="inline ml-0.5 text-gray-300" />
  if (sortDir === 'asc') return <ArrowUp size={10} className="inline ml-0.5 text-accent" />
  return <ArrowDown size={10} className="inline ml-0.5 text-accent" />
}

interface Props {
  trips:         Trip[]
  selectedId:    string | null
  onSelect:      (trip: Trip) => void
  meta?:         TripsMeta | null
  /** Viajes cuyo último reporte TMS cambió en el refetch más reciente — glow sutil */
  updatedIds?:   Set<string>
}

export function TripTable({ trips, selectedId, onSelect, meta, updatedIds }: Props) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  function handleSort(col: SortKey) {
    if (sortKey !== col) { setSortKey(col); setSortDir('asc') }
    else if (sortDir === 'asc') setSortDir('desc')
    else { setSortKey(null); setSortDir('asc') }
  }

  const sorted = useMemo(() => {
    if (!sortKey) return trips
    // Orden natural: '9' < '10', fechas ISO ordenan bien, acentos ignorados. Nulls siempre al final.
    const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' })
    return [...trips].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const cmp = collator.compare(String(av), String(bv))
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [trips, sortKey, sortDir])

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
                  <PendingDocsBadge count={trip.tractor_pending_docs} critical={trip.tractor_pending_docs_critical} compact />
                  <TmsChip tms={trip.source_system ?? ''} meta={meta} />
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {(() => {
                    const temp = getLatestTemp(trip.stops ?? [])
                    const tempStatus = classifyTemperature(temp, trip.cargo_type, meta?.temperature_ranges ?? [])
                    return temp != null
                      ? <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tempStatus === 'out_of_range' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>{temp}°C</span>
                      : null
                  })()}
                  <StatusBadge status={currentStatus} meta={meta} />
                  {stopComplianceSummary(trip.stops ?? []) === 'warn' && (
                    <span className="text-[9px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full whitespace-nowrap">OFF TIME</span>
                  )}
                </div>
              </div>

              {/* fila 2: conductor */}
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs text-slate-600 truncate">
                  {trip.driver_name ?? <span className="text-gray-300 italic text-[11px]">sin conductor</span>}
                </span>
                <PendingDocsBadge count={trip.driver_pending_docs} critical={trip.driver_pending_docs_critical} compact />
              </div>

              {/* fila 3: EETT + origen */}
              <div className="flex items-center gap-1.5 mt-1 text-[10px] text-gray-400 min-w-0">
                {trip.carrier_id
                  ? <span className="font-medium text-slate-500 truncate max-w-[160px]">{trip.carrier_name}</span>
                  : <span className="italic">sin EETT</span>}
                <InsuranceAlertBadge alert={trip.insurance_alert} compact />
                <PendingDocsBadge count={trip.carrier_pending_docs} critical={trip.carrier_pending_docs_critical} compact />
                {trip.origin && <><span>·</span><span className="truncate max-w-[100px]">{trip.origin}</span></>}
              </div>

              {/* fila 4: ETA de la parada activa + tiempo desde el último reporte TMS */}
              {(() => {
                const activeStop = getActiveStop(trip.stops ?? [])
                const eta = activeStop ? describeStopTiming(activeStop) : null
                const since = formatRelativeTime(trip.status_reported_at)
                if (!eta && since === '—') return null
                return (
                  <div className="flex items-center gap-1.5 mt-1 text-[10px] text-gray-400 min-w-0">
                    {eta && <span className="truncate">{eta}</span>}
                    {eta && since !== '—' && <span>·</span>}
                    {since !== '—' && <span className="whitespace-nowrap">{since}</span>}
                  </div>
                )
              })()}
            </div>
          )
        })}
      </div>

      {/* ── Desktop: table ────────────────────────────────────────── */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 1080 }}>
          <thead>
            <tr className="bg-gray-50 border-b border-border text-[10px] font-bold text-gray-400 uppercase tracking-wide">
              <th onClick={() => handleSort('tractor_plate')} className="sticky left-0 z-10 bg-inherit border-r border-border/60 px-3 py-2.5 text-left w-[110px] cursor-pointer select-none hover:bg-gray-100 transition-colors">Patente<SortIcon col="tractor_plate" sortKey={sortKey} sortDir={sortDir} /></th>
              <th onClick={() => handleSort('planning_date')} className="px-3 py-2.5 text-left w-[72px] cursor-pointer select-none hover:bg-gray-100 transition-colors">Fecha<SortIcon col="planning_date" sortKey={sortKey} sortDir={sortDir} /></th>
              <th className="px-2 py-2.5 text-left w-[44px]">TMS</th>
              <th onClick={() => handleSort('source_system_trip_id')} className="px-3 py-2.5 text-left w-[110px] cursor-pointer select-none hover:bg-gray-100 transition-colors">ID Viaje<SortIcon col="source_system_trip_id" sortKey={sortKey} sortDir={sortDir} /></th>
              <th onClick={() => handleSort('driver_name')} className="px-3 py-2.5 text-left w-[150px] cursor-pointer select-none hover:bg-gray-100 transition-colors">Conductor<SortIcon col="driver_name" sortKey={sortKey} sortDir={sortDir} /></th>
              <th className="px-3 py-2.5 text-left w-[110px]">Teléfono</th>
              <th onClick={() => handleSort('carrier_name')} className="px-3 py-2.5 text-left w-[130px] cursor-pointer select-none hover:bg-gray-100 transition-colors">EETT<SortIcon col="carrier_name" sortKey={sortKey} sortDir={sortDir} /></th>
              <th onClick={() => handleSort('client_name')} className="px-3 py-2.5 text-left w-[100px] cursor-pointer select-none hover:bg-gray-100 transition-colors">Cliente<SortIcon col="client_name" sortKey={sortKey} sortDir={sortDir} /></th>
              <th className="px-3 py-2.5 text-left w-[110px]">Origen · Carga</th>
              <th className="px-3 py-2.5 text-left">Destinos</th>
              <th className="px-3 py-2.5 text-center w-[72px]">Temp</th>
              <th onClick={() => handleSort('current_status')} className="sticky right-[90px] z-10 bg-inherit border-l border-border/60 px-3 py-2.5 text-left w-[110px] cursor-pointer select-none hover:bg-gray-100 transition-colors">Estado<SortIcon col="current_status" sortKey={sortKey} sortDir={sortDir} /></th>
              {/* Indicadores se movió a tabs de filtro arriba de la tabla
                  (Fase 3, 2026-07-18) — esta columna ahora es solo el
                  chevron de apertura del detalle. */}
              <th className="sticky right-0 z-10 bg-inherit px-3 py-2.5 text-left w-[32px]">
                <span className="sr-only">Abrir detalle</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((trip, i) => {
              const isActive       = trip.id === selectedId
              const primaryPlate   = trip.tractor_plate ?? trip.trailer_plate ?? null
              const secondaryPlate = trip.tractor_plate && trip.trailer_plate ? trip.trailer_plate : null
              const currentStatus  = trip.manual_status ?? trip.current_status
              const phones         = parsePhones(trip.driver_phone)

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
                  {/* PATENTE — sticky: siempre visible al scrollear horizontal.
                      Solo lectura (Fase 2, Plan 6) — se editaba inline con
                      PlateCell, ahora el mismo texto que ya mostraba el card
                      mobile, sin click-to-edit; clic en cualquier parte de la
                      fila abre el detalle. */}
                  <td className="sticky left-0 z-10 bg-inherit border-r border-border/60 px-3 py-2.5">
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
                      <PendingDocsBadge count={trip.tractor_pending_docs} critical={trip.tractor_pending_docs_critical} compact />
                    </div>
                  </td>

                  {/* FECHA */}
                  <td className="px-3 py-2.5">
                    <p className="text-[11px] text-gray-700 font-medium whitespace-nowrap">
                      {trip.planning_date
                        ? new Date(trip.planning_date + 'T12:00:00').toLocaleDateString('es-CL', {
                            day: '2-digit', month: '2-digit',
                          })
                        : '—'}
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

                  {/* CONDUCTOR — solo lectura (Fase 2, Plan 6), antes ConductorCell */}
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-slate-700 font-medium leading-tight">
                        {trip.driver_name ?? <span className="text-gray-300 italic">sin asignar</span>}
                      </span>
                      <PendingDocsBadge count={trip.driver_pending_docs} critical={trip.driver_pending_docs_critical} compact />
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
                          <PendingDocsBadge count={trip.carrier_pending_docs} critical={trip.carrier_pending_docs_critical} />
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
                      const temp = getLatestTemp(trip.stops ?? [])
                      const tempStatus = classifyTemperature(temp, trip.cargo_type, meta?.temperature_ranges ?? [])
                      return temp != null
                        ? <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tempStatus === 'out_of_range' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>{temp}°C</span>
                        : <span className="text-gray-300 text-xs">—</span>
                    })()}
                  </td>

                  {/* ESTADO — sticky derecha */}
                  <td className="sticky right-[90px] z-10 bg-inherit border-l border-border/60 px-3 py-2.5">
                    <StatusBadge status={currentStatus} meta={meta} />
                    {trip.manual_status && (
                      <span className="text-[8px] text-accent block mt-0.5">override</span>
                    )}
                    {stopComplianceSummary(trip.stops ?? []) === 'warn' && (
                      <span className="text-[8px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full block mt-0.5 w-fit">OFF TIME</span>
                    )}
                    {(() => {
                      const activeStop = getActiveStop(trip.stops ?? [])
                      const eta = activeStop ? describeStopTiming(activeStop) : null
                      return eta ? <span className="text-[9px] text-gray-400 block mt-0.5 truncate max-w-[100px]">{eta}</span> : null
                    })()}
                    {(() => {
                      const since = formatRelativeTime(trip.status_reported_at)
                      return since !== '—' ? <span className="text-[9px] text-gray-300 block mt-0.5 whitespace-nowrap">{since}</span> : null
                    })()}
                  </td>

                  {/* Chevron de apertura — sticky derecha. Los indicadores
                      (Activo/Trabajando/Asignado) se ven y filtran arriba de
                      la tabla, se editan en el detalle (Fase 3 del hardening
                      del Diario, 2026-07-18). */}
                  <td className="sticky right-0 z-10 bg-inherit px-3 py-2.5 text-center">
                    <span className={`text-xs shrink-0 ${isActive ? 'text-accent' : 'text-gray-200'}`}>›</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
