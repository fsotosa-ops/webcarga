'use client'

import { useState, useEffect, useMemo } from 'react'
import { Check, Loader2, PenLine, X, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import type { AlertStatus, ComplianceAlertSummary, Trip, TripStop, TripsMeta } from '@/lib/types'
import { ComplianceBadge } from './ComplianceBadge'
import { tripsApi } from '@/lib/api/trips'


function TmsChip({ tms, meta }: { tms: string; meta?: TripsMeta | null }) {
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

function FlagDots({ activo, trabajando, asignado, primera_vuelta }: {
  activo: boolean; trabajando: boolean; asignado: boolean; primera_vuelta: boolean
}) {
  const flags = [
    { label: 'A',  title: 'Activo',      active: activo,        color: 'bg-blue-400' },
    { label: 'T',  title: 'Trabajando',  active: trabajando,    color: 'bg-green-400' },
    { label: 'As', title: 'Asignado',    active: asignado,      color: 'bg-violet-400' },
    { label: '1V', title: '1ra Vuelta',  active: primera_vuelta, color: 'bg-amber-400' },
  ]
  return (
    <div className="flex gap-0.5 items-center">
      {flags.map(f => (
        <span
          key={f.label}
          title={f.title}
          className={`text-[8px] font-bold px-1 py-0.5 rounded ${
            f.active
              ? `${f.color} text-white`
              : 'bg-gray-100 text-gray-300'
          }`}
        >
          {f.label}
        </span>
      ))}
    </div>
  )
}

function StopPills({ stops }: { stops: TripStop[] }) {
  if (!stops?.length) return <span className="text-gray-200 text-xs">—</span>

  const isCompleted = (s: TripStop) =>
    !!(s.arrival_date || s.gps_arrival_date || s.on_time_status)

  const currentIdx   = stops.findIndex(s => !isCompleted(s))
  const isInProgress = currentIdx >= 0
  const current      = isInProgress ? stops[currentIdx] : stops[stops.length - 1]
  const completedCnt = stops.filter(isCompleted).length
  const total        = stops.length
  const name         = current.local ?? current.destination_city ?? '—'

  const pillCls = isInProgress
    ? 'bg-accent/10 text-accent border border-accent/20'
    : current.on_time_status === 'ON TIME'
    ? 'bg-green-50 text-green-600 border border-green-100'
    : current.on_time_status === 'OFF TIME'
    ? 'bg-amber-50 text-amber-600 border border-amber-100'
    : 'bg-gray-50 text-gray-400 border border-gray-100'

  return (
    <div className="space-y-0.5">
      <span
        className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full max-w-[110px] truncate flex items-center gap-1 w-fit ${pillCls}`}
        title={name}
      >
        {isInProgress && <span className="shrink-0">→</span>}
        <span className="truncate">{name}</span>
      </span>
      {total > 1 && (
        <p className="text-[9px] text-gray-400 pl-0.5">{completedCnt} / {total}</p>
      )}
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

  const handleSave = async (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation()
    if (!draft.trim() || draft === trip.driver_name) { setEditing(false); return }
    setSaving(true)
    try {
      const updated = await tripsApi.patch(trip.id, { driver_name: draft.trim() })
      onSaved(updated)
      setEditing(false)
    } catch { /* ignore */ } finally {
      setSaving(false)
    }
  }

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation()
    setDraft(trip.driver_name ?? '')
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 min-w-[140px]" onClick={e => e.stopPropagation()}>
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(e); if (e.key === 'Escape') { setDraft(trip.driver_name ?? ''); setEditing(false) } }}
          className="text-xs border border-accent/40 rounded px-2 py-1 w-full focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        <button type="button" onClick={handleSave} disabled={saving} className="p-1 text-accent hover:text-accent/80 shrink-0">
          {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
        </button>
        <button type="button" onClick={handleCancel} className="p-1 text-gray-300 hover:text-gray-500 shrink-0">
          <X size={11} />
        </button>
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
      <div className="mt-1">
        <FlagDots
          activo={trip.activo}
          trabajando={trip.trabajando}
          asignado={trip.asignado}
          primera_vuelta={trip.primera_vuelta}
        />
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

  useEffect(() => { setDraft(parsePhones(trip.driver_phone)) }, [trip.driver_phone])

  const addPhone = () => {
    const v = input.trim().replace(/,/g, '').replace(/\s/g, '')
    if (v && !draft.includes(v)) setDraft(p => [...p, v])
    setInput('')
  }

  const handleSave = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setSaving(true)
    try {
      const updated = await tripsApi.patch(trip.id, { driver_phone: JSON.stringify(draft) })
      onSaved(updated)
      setEditing(false)
    } catch { /* ignore */ } finally { setSaving(false) }
  }

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation()
    setDraft(parsePhones(trip.driver_phone))
    setInput('')
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
    try {
      const field = editing === 'secondary' ? 'trailer_plate' : 'tractor_plate'
      const updated = await tripsApi.patch(trip.id, { [field]: draft.trim().toUpperCase() })
      onSaved(updated)
      setEditing(null)
    } catch { /* ignore */ } finally { setSaving(false) }
  }

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation()
    setEditing(null)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 min-w-[110px]" onClick={e => e.stopPropagation()}>
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value.toUpperCase())}
          onKeyDown={e => {
            if (e.key === 'Enter') handleSave(e)
            if (e.key === 'Escape') { setEditing(null) }
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

type SortKey = 'planning_date' | 'tractor_plate' | 'driver_name' | 'transporter' | 'client_name' | 'current_status' | 'source_trip_id'

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
}

export function TripTable({ trips, selectedId, onSelect, onSaved, alertSummary, meta }: Props) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  function handleSort(col: SortKey) {
    if (sortKey !== col) { setSortKey(col); setSortDir('asc') }
    else if (sortDir === 'asc') setSortDir('desc')
    else { setSortKey(null); setSortDir('asc') }
  }

  const sorted = useMemo(() => {
    if (!sortKey) return trips
    return [...trips].sort((a, b) => {
      const av = (a[sortKey] ?? '') as string
      const bv = (b[sortKey] ?? '') as string
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
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
          const driverAlert   = alertSummary?.driver_ruts[trip.driver_rut ?? ''] as AlertStatus | undefined
          const currentStatus = trip.estado_manual ?? trip.current_status
          const statusMeta    = currentStatus ? meta?.statuses.find(s => s.id === currentStatus) : null

          return (
            <div
              key={trip.id}
              onClick={() => onSelect(trip)}
              className={`px-4 py-3 cursor-pointer transition-colors ${
                isActive ? 'bg-accent/5 border-l-2 border-l-accent' : 'hover:bg-gray-50/60'
              }`}
            >
              {/* fila 1: patente + estado */}
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={`font-mono text-sm font-bold shrink-0 ${primaryPlate ? 'text-slate-800' : 'text-gray-300 italic font-normal text-xs'}`}>
                    {primaryPlate ?? 'sin patente'}
                  </span>
                  <ComplianceBadge status={plateAlert ?? null} compact />
                  <TmsChip tms={trip.tms_name ?? ''} meta={meta} />
                </div>
                <span
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap shrink-0"
                  style={statusMeta
                    ? { backgroundColor: statusMeta.bg_color, color: statusMeta.text_color }
                    : { backgroundColor: '#f3f4f6', color: '#9ca3af' }}
                >
                  {currentStatus ?? '—'}
                </span>
              </div>

              {/* fila 2: conductor + flags */}
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs text-slate-600 truncate">
                  {trip.driver_name ?? <span className="text-gray-300 italic text-[11px]">sin conductor</span>}
                </span>
                <ComplianceBadge status={driverAlert ?? null} compact />
                <FlagDots
                  activo={trip.activo}
                  trabajando={trip.trabajando}
                  asignado={trip.asignado}
                  primera_vuelta={trip.primera_vuelta}
                />
              </div>

              {/* fila 3: EETT + origen */}
              <div className="flex items-center gap-1.5 mt-1 text-[10px] text-gray-400 min-w-0">
                {trip.transporter_profile_id
                  ? <span className="font-medium text-slate-500 truncate max-w-[160px]">{trip.transporter}</span>
                  : <span className="italic">sin EETT</span>}
                {trip.origin && <><span>·</span><span className="truncate max-w-[100px]">{trip.origin}</span></>}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Desktop: table ────────────────────────────────────────── */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 1080 }}>
          <thead>
            <tr className="bg-gray-50 border-b border-border text-[10px] font-bold text-gray-400 uppercase tracking-wide">
              <th onClick={() => handleSort('planning_date')} className="px-3 py-2.5 text-left w-[72px] cursor-pointer select-none hover:bg-gray-100 transition-colors">Fecha<SortIcon col="planning_date" sortKey={sortKey} sortDir={sortDir} /></th>
              <th className="px-2 py-2.5 text-left w-[44px]">TMS</th>
              <th onClick={() => handleSort('source_trip_id')} className="px-3 py-2.5 text-left w-[110px] cursor-pointer select-none hover:bg-gray-100 transition-colors">ID Viaje<SortIcon col="source_trip_id" sortKey={sortKey} sortDir={sortDir} /></th>
              <th onClick={() => handleSort('tractor_plate')} className="px-3 py-2.5 text-left w-[110px] cursor-pointer select-none hover:bg-gray-100 transition-colors">Patente<SortIcon col="tractor_plate" sortKey={sortKey} sortDir={sortDir} /></th>
              <th onClick={() => handleSort('driver_name')} className="px-3 py-2.5 text-left w-[150px] cursor-pointer select-none hover:bg-gray-100 transition-colors">Conductor<SortIcon col="driver_name" sortKey={sortKey} sortDir={sortDir} /></th>
              <th className="px-3 py-2.5 text-left w-[110px]">Teléfono</th>
              <th onClick={() => handleSort('transporter')} className="px-3 py-2.5 text-left w-[130px] cursor-pointer select-none hover:bg-gray-100 transition-colors">EETT<SortIcon col="transporter" sortKey={sortKey} sortDir={sortDir} /></th>
              <th onClick={() => handleSort('client_name')} className="px-3 py-2.5 text-left w-[100px] cursor-pointer select-none hover:bg-gray-100 transition-colors">Cliente<SortIcon col="client_name" sortKey={sortKey} sortDir={sortDir} /></th>
              <th className="px-3 py-2.5 text-left w-[110px]">Origen · Carga</th>
              <th className="px-3 py-2.5 text-left">Destinos</th>
              <th onClick={() => handleSort('current_status')} className="px-3 py-2.5 text-left w-[110px] cursor-pointer select-none hover:bg-gray-100 transition-colors">Estado<SortIcon col="current_status" sortKey={sortKey} sortDir={sortDir} /></th>
              <th className="px-2 py-2.5 w-6"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((trip, i) => {
              const isActive    = trip.id === selectedId
              const plateAlert  = alertSummary?.plates[trip.tractor_plate ?? ''] as AlertStatus | undefined
              const driverAlert = alertSummary?.driver_ruts[trip.driver_rut ?? ''] as AlertStatus | undefined
              const currentStatus = trip.estado_manual ?? trip.current_status
              const statusMeta    = currentStatus ? meta?.statuses.find(s => s.id === currentStatus) : null

              return (
                <tr
                  key={trip.id}
                  onClick={() => onSelect(trip)}
                  className={`border-b border-border/60 last:border-0 cursor-pointer transition-colors ${
                    isActive
                      ? 'bg-accent/5 border-l-2 border-l-accent'
                      : i % 2 === 1
                      ? 'bg-gray-50/40 hover:bg-gray-50'
                      : 'hover:bg-gray-50/70'
                  }`}
                >
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
                        }).format(new Date(trip.status_reported_at + 'Z'))}
                      </p>
                    )}
                  </td>

                  {/* TMS */}
                  <td className="px-2 py-2.5">
                    <TmsChip tms={trip.tms_name ?? ''} meta={meta} />
                  </td>

                  {/* ID VIAJE */}
                  <td className="px-3 py-2.5">
                    <span className="font-mono text-[11px] text-gray-500">
                      {trip.source_trip_id ?? '—'}
                    </span>
                  </td>

                  {/* PATENTE */}
                  <td className="px-3 py-2.5">
                    <div className="flex items-start gap-1.5">
                      <PlateCell trip={trip} onSaved={onSaved} />
                      <ComplianceBadge status={plateAlert ?? null} compact
                        tooltip={plateAlert === 'expired' ? 'Vehículo vencido' : 'Vence pronto'} />
                    </div>
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
                    {trip.transporter_profile_id ? (
                      <span className="text-xs font-medium text-slate-700 leading-tight block truncate max-w-[120px]">
                        {trip.transporter}
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
                    <StopPills stops={trip.stops} />
                  </td>

                  {/* ESTADO */}
                  <td className="px-3 py-2.5">
                    <span
                      className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap"
                      style={statusMeta
                        ? { backgroundColor: statusMeta.bg_color, color: statusMeta.text_color }
                        : { backgroundColor: '#f3f4f6', color: '#9ca3af' }}
                    >
                      {currentStatus ?? '—'}
                    </span>
                    {trip.estado_manual && (
                      <span className="text-[8px] text-accent block mt-0.5">override</span>
                    )}
                  </td>

                  {/* Chevron */}
                  <td className="px-2 py-2.5 text-center">
                    <span className={`text-xs ${isActive ? 'text-accent' : 'text-gray-200'}`}>›</span>
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
