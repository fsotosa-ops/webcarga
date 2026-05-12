'use client'

import { useState, useEffect } from 'react'
import { X, Clock, MapPin, Loader2 } from 'lucide-react'
import type { Trip, TripMilestone } from '@/lib/types'
import { tripsApi, type TripPatch } from '@/lib/api/trips'

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

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] text-gray-500 font-bold uppercase">{label}</span>
      <label className="flex items-center cursor-pointer w-fit">
        <div
          onClick={() => onChange(!value)}
          className={`w-10 h-6 rounded-full relative transition-colors cursor-pointer ${value ? 'bg-accent' : 'bg-gray-200'}`}
        >
          <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${value ? 'left-5' : 'left-1'}`} />
        </div>
      </label>
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
      activo:         trip.activo,
      trabajando:     trip.trabajando,
      asignado:       trip.asignado,
      primera_vuelta: trip.primera_vuelta,
      estado_manual:  trip.estado_manual ?? '',
      locales:        trip.locales ?? '',
      observaciones:  trip.observaciones ?? '',
      comentarios:    trip.comentarios ?? '',
    })
    setErr(null)
  }, [trip?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    if (!trip) return
    setSaving(true)
    setErr(null)
    try {
      const payload: TripPatch = {
        activo:         form.activo,
        trabajando:     form.trabajando,
        asignado:       form.asignado,
        primera_vuelta: form.primera_vuelta,
        estado_manual:  form.estado_manual || undefined,
        locales:        form.locales       || undefined,
        observaciones:  form.observaciones || undefined,
        comentarios:    form.comentarios   || undefined,
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

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-40 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className={`
          fixed md:relative inset-y-0 right-0 z-50
          w-full sm:w-[480px] md:w-[420px] lg:w-[460px]
          bg-white border-l border-border flex flex-col shrink-0
          transition-transform duration-300
          ${isOpen ? 'translate-x-0' : 'translate-x-full md:hidden'}
        `}
      >
        {trip && (
          <>
            {/* Header */}
            <div className="px-5 py-4 bg-slate-900 flex items-start justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <h3 className="text-base font-bold text-white truncate">
                  Gestión: {trip.tractor_plate ?? 'Sin patente'}
                </h3>
                <p className="text-[11px] text-white/50 mt-0.5 truncate">
                  {trip.driver_name ?? '—'} · {trip.tms_name}
                </p>
              </div>
              <button
                onClick={onClose}
                className="text-white/50 hover:text-white transition-colors shrink-0 mt-0.5"
              >
                <X size={18} />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">

              {/* Milestones timeline */}
              {trip.milestones?.length > 0 && (
                <section>
                  <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">
                    Historial de estados
                  </h4>
                  <div className="space-y-2">
                    {[...trip.milestones]
                      .sort((a, b) => (a.ts ?? '') < (b.ts ?? '') ? -1 : 1)
                      .map((m: TripMilestone, i) => {
                        const colors = STATUS_COLOR[m.status]
                        return (
                          <div key={m.status_id ?? i} className="flex items-start gap-3">
                            <div className="w-1.5 h-1.5 rounded-full bg-gray-300 mt-2 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span
                                  className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold"
                                  style={colors
                                    ? { backgroundColor: colors.bg, color: colors.text }
                                    : { backgroundColor: '#f3f4f6', color: '#9ca3af' }}
                                >
                                  {m.status}
                                </span>
                                {m.ts && (
                                  <span className="text-[10px] text-gray-400 flex items-center gap-1">
                                    <Clock size={9} />
                                    {m.ts}
                                  </span>
                                )}
                              </div>
                              {m.local && (
                                <p className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-1">
                                  <MapPin size={9} />
                                  {m.local}
                                </p>
                              )}
                            </div>
                          </div>
                        )
                      })}
                  </div>
                </section>
              )}

              {/* Bitácora Operativa */}
              <section className="bg-accent/5 rounded-xl border border-accent/15 p-4 space-y-5">
                <div className="flex items-center justify-between border-b border-accent/15 pb-3">
                  <h4 className="text-xs font-bold text-accent uppercase tracking-wider">
                    Bitácora Operativa
                  </h4>
                  <span className="flex h-2.5 w-2.5 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent/60 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-accent" />
                  </span>
                </div>

                {/* Toggles */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-white rounded-lg border border-border/60 p-3">
                  <Toggle
                    label="Activo"
                    value={form.activo ?? true}
                    onChange={v => setForm(f => ({ ...f, activo: v }))}
                  />
                  <Toggle
                    label="Trabajando"
                    value={form.trabajando ?? false}
                    onChange={v => setForm(f => ({ ...f, trabajando: v }))}
                  />
                  <Toggle
                    label="Asignado"
                    value={form.asignado ?? false}
                    onChange={v => setForm(f => ({ ...f, asignado: v }))}
                  />
                  <Toggle
                    label="1ra Vuelta"
                    value={form.primera_vuelta ?? false}
                    onChange={v => setForm(f => ({ ...f, primera_vuelta: v }))}
                  />
                </div>

                {/* Estado + Locales */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-600 uppercase mb-1.5">Estado</label>
                    <select
                      value={form.estado_manual ?? ''}
                      onChange={e => setForm(f => ({ ...f, estado_manual: e.target.value }))}
                      className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent/30"
                    >
                      {ESTADO_OPTIONS.map(s => (
                        <option key={s} value={s}>{s || 'Sin override'}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-600 uppercase mb-1.5">Locales Asignados</label>
                    <input
                      type="text"
                      value={form.locales ?? ''}
                      onChange={e => setForm(f => ({ ...f, locales: e.target.value }))}
                      placeholder="Ej: Tienda Costanera"
                      className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent/30"
                    />
                  </div>
                </div>

                {/* Observaciones */}
                <div>
                  <label className="block text-[10px] font-bold text-gray-600 uppercase mb-1.5">Observaciones</label>
                  <textarea
                    rows={2}
                    value={form.observaciones ?? ''}
                    onChange={e => setForm(f => ({ ...f, observaciones: e.target.value }))}
                    placeholder="Novedad operativa…"
                    className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent/30 resize-none"
                  />
                </div>

                {/* Comentarios */}
                <div>
                  <label className="block text-[10px] font-bold text-gray-600 uppercase mb-1.5">Comentarios</label>
                  <textarea
                    rows={2}
                    value={form.comentarios ?? ''}
                    onChange={e => setForm(f => ({ ...f, comentarios: e.target.value }))}
                    placeholder="Comentario adicional…"
                    className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent/30 resize-none"
                  />
                </div>

                {err && (
                  <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</p>
                )}

                {/* Save */}
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="w-full flex items-center justify-center gap-2 bg-accent text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-accent/90 disabled:opacity-60 transition-colors"
                >
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  Guardar Bitácora
                </button>
              </section>
            </div>
          </>
        )}
      </div>
    </>
  )
}
