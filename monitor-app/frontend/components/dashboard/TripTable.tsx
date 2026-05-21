'use client'

import { useState, useEffect } from 'react'
import { Check, Loader2, PenLine, X } from 'lucide-react'
import type { AlertStatus, ComplianceAlertSummary, Trip, TripStop } from '@/lib/types'
import { ComplianceBadge } from './ComplianceBadge'
import { tripsApi } from '@/lib/api/trips'

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
  'DEVUELTO':               { bg: '#fee2e2', text: '#b00020' },
  'EN PANA':                { bg: '#fee2e2', text: '#b00020' },
}

const TMS_CHIP: Record<string, { label: string; cls: string }> = {
  qanalytics: { label: 'QA',  cls: 'bg-blue-50 text-blue-600 border-blue-100' },
  wingsuite:  { label: 'WS',  cls: 'bg-purple-50 text-purple-600 border-purple-100' },
  sodimac:    { label: 'SDM', cls: 'bg-orange-50 text-orange-600 border-orange-100' },
}

function StatusBadge({ status }: { status: string | null }) {
  const s = status ?? ''
  const colors = STATUS_COLOR[s]
  return (
    <span
      className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap"
      style={colors
        ? { backgroundColor: colors.bg, color: colors.text }
        : { backgroundColor: '#f3f4f6', color: '#9ca3af' }}
    >
      {s || '—'}
    </span>
  )
}

function TmsChip({ tms }: { tms: string }) {
  const cfg = TMS_CHIP[tms.toLowerCase()]
  if (!cfg) return <span className="text-[9px] text-gray-400 font-mono">{tms}</span>
  return (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${cfg.cls}`}>
      {cfg.label}
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
  if (!stops || stops.length === 0) return <span className="text-gray-200 text-xs">—</span>
  const MAX_VISIBLE = 2
  const visible = stops.slice(0, MAX_VISIBLE)
  const extra = stops.length - MAX_VISIBLE
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((s, i) => (
        <span
          key={s.stop_id ?? i}
          title={`${s.local ?? s.destination_city ?? '—'} · ${s.on_time_status ?? 'sin estado'}`}
          className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full max-w-[90px] truncate ${
            s.on_time_status === 'ON TIME'
              ? 'bg-green-50 text-green-600 border border-green-100'
              : s.on_time_status === 'OFF TIME'
              ? 'bg-amber-50 text-amber-600 border border-amber-100'
              : 'bg-gray-50 text-gray-400 border border-gray-100'
          }`}
        >
          {s.local ?? s.destination_city ?? '—'}
        </span>
      ))}
      {extra > 0 && (
        <span className="text-[9px] text-gray-400 font-semibold px-1 py-0.5">+{extra}</span>
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

interface Props {
  trips:         Trip[]
  selectedId:    string | null
  onSelect:      (trip: Trip) => void
  onSaved:       (trip: Trip) => void
  alertSummary?: ComplianceAlertSummary | null
}

export function TripTable({ trips, selectedId, onSelect, onSaved, alertSummary }: Props) {
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
          const plateAlert    = alertSummary?.plates[trip.tractor_plate ?? ''] as AlertStatus | undefined
          const driverAlert   = alertSummary?.driver_ruts[trip.driver_rut ?? ''] as AlertStatus | undefined
          const currentStatus = trip.estado_manual ?? trip.current_status
          const statusColor   = currentStatus ? STATUS_COLOR[currentStatus] : null

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
                  <span className="font-mono text-sm font-bold text-slate-800 shrink-0">
                    {trip.tractor_plate ?? '—'}
                  </span>
                  <ComplianceBadge status={plateAlert ?? null} compact />
                  <TmsChip tms={trip.tms_name ?? ''} />
                </div>
                {statusColor ? (
                  <span
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap shrink-0"
                    style={{ backgroundColor: statusColor.bg, color: statusColor.text }}
                  >
                    {currentStatus}
                  </span>
                ) : <StatusBadge status={currentStatus} />}
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
        <table className="w-full text-sm" style={{ minWidth: 980 }}>
          <thead>
            <tr className="bg-gray-50 border-b border-border text-[10px] font-bold text-gray-400 uppercase tracking-wide">
              <th className="px-3 py-2.5 text-left w-[72px]">Fecha</th>
              <th className="px-2 py-2.5 text-left w-[44px]">TMS</th>
              <th className="px-3 py-2.5 text-left w-[110px]">Patente</th>
              <th className="px-3 py-2.5 text-left w-[150px]">Conductor</th>
              <th className="px-3 py-2.5 text-left w-[110px]">Teléfono</th>
              <th className="px-3 py-2.5 text-left w-[130px]">EETT</th>
              <th className="px-3 py-2.5 text-left w-[100px]">Cliente</th>
              <th className="px-3 py-2.5 text-left w-[110px]">Origen · Carga</th>
              <th className="px-3 py-2.5 text-left">Destinos</th>
              <th className="px-3 py-2.5 text-left w-[110px]">Estado</th>
              <th className="px-2 py-2.5 w-6"></th>
            </tr>
          </thead>
          <tbody>
            {trips.map((trip, i) => {
              const isActive    = trip.id === selectedId
              const plateAlert  = alertSummary?.plates[trip.tractor_plate ?? ''] as AlertStatus | undefined
              const driverAlert = alertSummary?.driver_ruts[trip.driver_rut ?? ''] as AlertStatus | undefined
              const currentStatus = trip.estado_manual ?? trip.current_status
              const statusColor   = currentStatus ? STATUS_COLOR[currentStatus] : null

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
                        {new Date(trip.status_reported_at).toLocaleTimeString('es-CL', {
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </p>
                    )}
                  </td>

                  {/* TMS */}
                  <td className="px-2 py-2.5">
                    <TmsChip tms={trip.tms_name ?? ''} />
                  </td>

                  {/* PATENTE */}
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs font-bold text-slate-800">
                        {trip.tractor_plate ?? '—'}
                      </span>
                      <ComplianceBadge status={plateAlert ?? null} compact
                        tooltip={plateAlert === 'expired' ? 'Vehículo vencido' : 'Vence pronto'} />
                    </div>
                    {trip.trailer_plate && (
                      <span className="font-mono text-[10px] text-gray-400 mt-0.5 block">
                        {trip.trailer_plate}
                      </span>
                    )}
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
                    {statusColor ? (
                      <span
                        className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap"
                        style={{ backgroundColor: statusColor.bg, color: statusColor.text }}
                      >
                        {currentStatus}
                      </span>
                    ) : (
                      <StatusBadge status={currentStatus} />
                    )}
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
