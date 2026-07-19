'use client'

import { useState, useEffect, useMemo } from 'react'
import { Check, Loader2, PenLine, X, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import type { Trip, TripStop, TripsMeta } from '@/lib/types'
import { ComplianceBadge } from './ComplianceBadge'

// TODO(H2.6): venían de GET /transporters/compliance-alerts/summary (Checkpoint
// A-E, borrado). Sin productor hasta que se resuelva el puente del Diario con
// el modelo nuevo de Empresas — alertSummary queda siempre null/undefined
// mientras tanto (degradación limpia, no se muestran alertas de vencimiento).
export type AlertStatus = 'expired' | 'expiring_soon' | 'ok'
export type ComplianceAlertSummary = {
  driver_ruts:         Record<string, AlertStatus>
  plates:              Record<string, AlertStatus>
  total_expired:       number
  total_expiring_soon: number
}
import { tripsApi } from '@/lib/api/trips'
import { getLatestTemp, classifyTemperature, getActiveStop, describeStopTiming } from '@/lib/utils/temperature'
import { stopComplianceSummary } from '@/lib/utils/compliance'
import { formatRelativeTime, normalizeUTC } from '@/lib/utils/datetime'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { OperationTypeBadge } from '@/components/ui/OperationTypeBadge'


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

function ConductorCell({
  trip,
  alertStatus,
  onSaved,
}: {
  trip: Trip
  alertStatus: AlertStatus | undefined
  onSaved: (t: Trip) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(trip.driver_name ?? '')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const handleSave = async (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation()
    if (!draft.trim() || draft === trip.driver_name) { setEditing(false); return }
    setSaving(true)
    setError(null)
    try {
      const updated = await tripsApi.patch(trip.id, { driver_name: draft.trim() })
      onSaved(updated)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation()
    setDraft(trip.driver_name ?? '')
    setError(null)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="min-w-[140px]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-1">
          <input
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave(e); if (e.key === 'Escape') { setDraft(trip.driver_name ?? ''); setError(null); setEditing(false) } }}
            className="text-xs border border-accent/40 rounded px-2 py-1 w-full focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          <button type="button" onClick={handleSave} disabled={saving} className="p-1 text-accent hover:text-accent/80 shrink-0">
            {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          </button>
          <button type="button" onClick={handleCancel} className="p-1 text-gray-300 hover:text-gray-500 shrink-0">
            <X size={11} />
          </button>
        </div>
        {error && <p className="text-[9px] text-red-500 mt-0.5 max-w-[160px]">{error}</p>}
      </div>
    )
  }

  return (
    <div
      className="group cursor-text"
      onClick={e => { e.stopPropagation(); setDraft(trip.driver_name ?? ''); setEditing(true) }}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-slate-700 font-medium leading-tight">
          {trip.driver_name ?? <span className="text-gray-300 italic">sin asignar</span>}
        </span>
        <ComplianceBadge status={alertStatus ?? null} compact />
        <PenLine size={10} className="text-gray-200 group-hover:text-accent/60 transition-colors shrink-0" />
      </div>
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

function PhoneTagCell({ trip, onSaved }: { trip: Trip; onSaved: (t: Trip) => void }) {
  const [editing, setEditing]   = useState(false)
  const [draft, setDraft]       = useState<string[]>(() => parsePhones(trip.driver_phone))
  const [input, setInput]       = useState('')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => { setDraft(parsePhones(trip.driver_phone)) }, [trip.driver_phone])

  const addPhone = () => {
    const v = input.trim().replace(/,/g, '').replace(/\s/g, '')
    if (v && !draft.includes(v)) setDraft(p => [...p, v])
    setInput('')
  }

  const handleSave = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setSaving(true)
    setError(null)
    try {
      const updated = await tripsApi.patch(trip.id, { driver_phone: JSON.stringify(draft) })
      onSaved(updated)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar')
    } finally { setSaving(false) }
  }

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation()
    setDraft(parsePhones(trip.driver_phone))
    setInput('')
    setError(null)
    setEditing(false)
  }

  const phones = parsePhones(trip.driver_phone)

  if (editing) {
    return (
      <div className="space-y-1 min-w-[130px]" onClick={e => e.stopPropagation()}>
        {draft.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {draft.map(p => (
              <span key={p} className="flex items-center gap-0.5 text-[9px] font-mono bg-accent/10 text-accent px-1.5 py-0.5 rounded-full">
                {p}
                <button type="button" onClick={() => setDraft(d => d.filter(x => x !== p))}
                  className="hover:text-red-400 ml-0.5 leading-none">
                  <X size={8} />
                </button>
              </span>
            ))}
          </div>
        )}
        <input
          autoFocus
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addPhone() }
            if (e.key === 'Escape') handleCancel(e as unknown as React.MouseEvent)
          }}
          placeholder="+56912345678"
          className="text-[11px] font-mono border border-border rounded px-2 py-1 w-full focus:outline-none focus:ring-1 focus:ring-accent/30"
        />
        <div className="flex items-center gap-1">
          {input.trim() && (
            <button type="button" onClick={addPhone}
              className="text-[10px] text-accent hover:underline">+ agregar</button>
          )}
          <button type="button" onClick={handleSave} disabled={saving} className="p-1 text-accent shrink-0">
            {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          </button>
          <button type="button" onClick={handleCancel} className="p-1 text-gray-300 hover:text-gray-500 shrink-0">
            <X size={11} />
          </button>
        </div>
        {error && <p className="text-[9px] text-red-500 max-w-[160px]">{error}</p>}
      </div>
    )
  }

  return (
    <div className="group cursor-pointer"
      onClick={e => { e.stopPropagation(); setDraft(parsePhones(trip.driver_phone)); setEditing(true) }}>
      {phones.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {phones.map(p => (
            <a key={p} href={`tel:${p}`} onClick={e => e.stopPropagation()}
              className="text-[10px] font-mono text-accent hover:underline block">
              {p}
            </a>
          ))}
        </div>
      ) : (
        <span className="text-[10px] text-gray-300 group-hover:text-accent/50 transition-colors">—</span>
      )}
      <PenLine size={9} className="text-gray-200 group-hover:text-accent/60 mt-0.5 transition-colors" />
    </div>
  )
}

function PlateCell({ trip, onSaved }: { trip: Trip; onSaved: (t: Trip) => void }) {
  const primaryPlate   = trip.tractor_plate ?? trip.trailer_plate ?? null
  const secondaryPlate = trip.tractor_plate && trip.trailer_plate ? trip.trailer_plate : null

  const [editing, setEditing] = useState<'primary' | 'secondary' | null>(null)
  const [draft, setDraft]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const startEdit = (which: 'primary' | 'secondary', e: React.MouseEvent) => {
    e.stopPropagation()
    const current = which === 'primary'
      ? (trip.tractor_plate ?? trip.trailer_plate ?? '')
      : (trip.trailer_plate ?? '')
    setDraft(current)
    setEditing(which)
  }

  const handleSave = async (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation()
    setSaving(true)
    setError(null)
    try {
      const field = editing === 'secondary' ? 'trailer_plate' : 'tractor_plate'
      const updated = await tripsApi.patch(trip.id, { [field]: draft.trim().toUpperCase() })
      onSaved(updated)
      setEditing(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar')
    } finally { setSaving(false) }
  }

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation()
    setError(null)
    setEditing(null)
  }

  if (editing) {
    return (
      <div className="min-w-[110px]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-1">
          <input
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value.toUpperCase())}
            onKeyDown={e => {
              if (e.key === 'Enter') handleSave(e)
              if (e.key === 'Escape') { setError(null); setEditing(null) }
            }}
            placeholder="XXNN00"
            className="font-mono text-xs border border-accent/40 rounded px-2 py-1 w-full focus:outline-none focus:ring-2 focus:ring-accent/30 uppercase"
          />
          <button type="button" onClick={handleSave} disabled={saving} className="p-1 text-accent hover:text-accent/80 shrink-0">
            {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          </button>
          <button type="button" onClick={handleCancel} className="p-1 text-gray-300 hover:text-gray-500 shrink-0">
            <X size={11} />
          </button>
        </div>
        {error && <p className="text-[9px] text-red-500 mt-0.5 max-w-[160px]">{error}</p>}
      </div>
    )
  }

  return (
    <div>
      <div
        className="group flex items-center gap-1.5 cursor-text"
        onClick={e => startEdit('primary', e)}
      >
        <span className={`font-mono text-xs font-bold ${primaryPlate ? 'text-slate-800' : 'text-gray-300 italic font-normal'}`}>
          {primaryPlate ?? 'sin patente'}
        </span>
        <PenLine size={10} className="text-gray-200 group-hover:text-accent/60 transition-colors shrink-0" />
      </div>
      {secondaryPlate && (
        <span
          className="font-mono text-[10px] text-gray-400 mt-0.5 block cursor-text hover:text-gray-600 transition-colors"
          onClick={e => startEdit('secondary', e)}
        >
          {secondaryPlate}
        </span>
      )}
    </div>
  )
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
  onSaved:       (trip: Trip) => void
  alertSummary?: ComplianceAlertSummary | null
  meta?:         TripsMeta | null
  /** Viajes cuyo último reporte TMS cambió en el refetch más reciente — glow sutil */
  updatedIds?:   Set<string>
}

export function TripTable({ trips, selectedId, onSelect, onSaved, alertSummary, meta, updatedIds }: Props) {
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
          const plateAlert    = alertSummary?.plates[primaryPlate ?? ''] as AlertStatus | undefined
          const driverAlert   = alertSummary?.driver_ruts[trip.driver_tax_id ?? ''] as AlertStatus | undefined
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
                  <ComplianceBadge status={plateAlert ?? null} compact />
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
                <ComplianceBadge status={driverAlert ?? null} compact />
              </div>

              {/* fila 3: EETT + origen */}
              <div className="flex items-center gap-1.5 mt-1 text-[10px] text-gray-400 min-w-0">
                {trip.carrier_id
                  ? <span className="font-medium text-slate-500 truncate max-w-[160px]">{trip.carrier_name}</span>
                  : <span className="italic">sin EETT</span>}
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
              const isActive    = trip.id === selectedId
              const plateAlert  = alertSummary?.plates[trip.tractor_plate ?? ''] as AlertStatus | undefined
              const driverAlert = alertSummary?.driver_ruts[trip.driver_tax_id ?? ''] as AlertStatus | undefined
              const currentStatus = trip.manual_status ?? trip.current_status

              return (
                <tr
                  key={trip.id}
                  tabIndex={0}
                  aria-selected={isActive}
                  onClick={() => onSelect(trip)}
                  onKeyDown={e => {
                    // Enter abre el detalle solo si el foco está en la fila misma (no en un input de edición inline)
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
                  {/* PATENTE — sticky: siempre visible al scrollear horizontal */}
                  <td className="sticky left-0 z-10 bg-inherit border-r border-border/60 px-3 py-2.5">
                    <div className="flex items-start gap-1.5">
                      <PlateCell trip={trip} onSaved={onSaved} />
                      <ComplianceBadge status={plateAlert ?? null} compact
                        tooltip={plateAlert === 'expired' ? 'Vehículo vencido' : 'Vence pronto'} />
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

                  {/* CONDUCTOR + FLAGS */}
                  <td className="px-3 py-2.5">
                    <ConductorCell trip={trip} alertStatus={driverAlert} onSaved={onSaved} />
                  </td>

                  {/* TELÉFONO */}
                  <td className="px-3 py-2.5">
                    <PhoneTagCell trip={trip} onSaved={onSaved} />
                  </td>

                  {/* EETT */}
                  <td className="px-3 py-2.5">
                    {trip.carrier_id ? (
                      <span className="text-xs font-medium text-slate-700 leading-tight block truncate max-w-[120px]">
                        {trip.carrier_name}
                      </span>
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
                      (Activo/Trabajando/Asignado/1ra Vuelta) se ven y
                      filtran arriba de la tabla, se editan en el detalle
                      (Fase 3 del hardening del Diario, 2026-07-18). */}
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
