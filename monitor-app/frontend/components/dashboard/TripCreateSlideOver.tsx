'use client'

import { useState, useEffect } from 'react'
import { X, Loader2, Plus, Search, Building2, User, Truck, ChevronRight } from 'lucide-react'
import type { Trip, TripsMeta, TripCreatePayload, TransporterProfile, TransporterListItem } from '@/lib/types'
import { tripsApi } from '@/lib/api/trips'
import { transportersApi } from '@/lib/api/transporters'

interface Props {
  open:      boolean
  onClose:   () => void
  onCreated: (trip: Trip) => void
  meta?:     TripsMeta | null
}

const INPUT = "w-full text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all placeholder:text-gray-300"

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="text-accent">{icon}</span>
      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">{children}</h3>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

// ── Empresa search (asociado con módulo Empresas) ─────────────────────────────

function EmpresaSelector({
  selected,
  onSelect,
  onClear,
}: {
  selected: TransporterProfile | null
  onSelect: (t: TransporterProfile) => void
  onClear:  () => void
}) {
  const [query, setQuery]         = useState('')
  const [results, setResults]     = useState<TransporterListItem[]>([])
  const [searching, setSearching] = useState(false)
  const [open, setOpen]           = useState(false)

  useEffect(() => {
    if (query.length < 2) { setResults([]); return }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await transportersApi.list({ q: query, limit: 10 })
        setResults(res.data)
      } finally { setSearching(false) }
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  async function handleSelect(item: TransporterListItem) {
    setOpen(false); setQuery('')
    const full = await transportersApi.get(item.id)
    onSelect(full)
  }

  if (selected) {
    return (
      <div className="flex items-center justify-between bg-accent/5 border border-accent/20 rounded-xl px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
            <Building2 size={14} className="text-accent" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800 truncate">{selected.business_name ?? '—'}</p>
            <p className="text-[10px] text-gray-400 font-mono">{selected.rut ?? ''}</p>
          </div>
        </div>
        <button type="button" onClick={onClear} className="text-xs text-gray-400 hover:text-red-400 transition-colors shrink-0 ml-3">
          Cambiar
        </button>
      </div>
    )
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Buscar empresa por nombre o RUT…"
          className={INPUT + ' pl-8'}
        />
        {searching && <Loader2 size={12} className="animate-spin text-gray-400 absolute right-3 top-1/2 -translate-y-1/2" />}
      </div>
      {open && results.length > 0 && (
        <ul className="absolute z-20 w-full mt-1 bg-white border border-border rounded-xl shadow-lg overflow-hidden max-h-48 overflow-y-auto">
          {results.map(r => (
            <li key={r.id}>
              <button
                type="button"
                onMouseDown={() => handleSelect(r)}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 flex items-center justify-between gap-2"
              >
                <div>
                  <p className="font-medium text-slate-700">{r.business_name ?? '—'}</p>
                  <p className="text-[10px] text-gray-400 font-mono">{r.rut ?? ''}</p>
                </div>
                <ChevronRight size={13} className="text-gray-300 shrink-0" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && query.length >= 2 && !searching && results.length === 0 && (
        <div className="absolute z-20 w-full mt-1 bg-white border border-border rounded-xl shadow-lg px-4 py-3">
          <p className="text-xs text-gray-400">Sin resultados para "{query}"</p>
        </div>
      )}
      {query.length < 2 && (
        <p className="text-[10px] text-gray-400 mt-1.5 pl-1">
          O deja vacío para ingreso libre de conductor y patente
        </p>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function TripCreateSlideOver({ open, onClose, onCreated, meta }: Props) {
  const [form, setForm]                   = useState<Partial<TripCreatePayload>>({ tms_name: 'manual' })
  const [empresa, setEmpresa]             = useState<TransporterProfile | null>(null)
  const [saving, setSaving]               = useState(false)
  const [err, setErr]                     = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setForm({ tms_name: 'manual' })
      setEmpresa(null)
      setErr(null)
    }
  }, [open])

  function set(field: keyof TripCreatePayload, value: string) {
    setForm(f => ({ ...f, [field]: value || undefined }))
  }

  function handleSelectEmpresa(profile: TransporterProfile) {
    setEmpresa(profile)
    setForm(f => ({
      ...f,
      transporter_name:       profile.business_name ?? undefined,
      transporter_profile_id: profile.id,
    }))
  }

  function handleClearEmpresa() {
    setEmpresa(null)
    setForm(f => ({
      ...f,
      transporter_name:       undefined,
      transporter_profile_id: undefined,
      driver_name:            undefined,
      driver_rut:             undefined,
      driver_phone:           undefined,
      tractor_plate:          undefined,
      trailer_plate:          undefined,
    }))
  }

  function selectDriver(d: { name?: string; rut?: string } | null) {
    if (!d) return
    setForm(f => ({
      ...f,
      driver_name: d.name ?? f.driver_name,
      driver_rut:  d.rut  ?? f.driver_rut,
    }))
  }

  function selectVehicle(v: { plate?: string } | null) {
    if (!v) return
    setForm(f => ({ ...f, tractor_plate: v.plate?.toUpperCase() ?? f.tractor_plate }))
  }

  async function handleCreate() {
    if (!form.planning_date) { setErr('La fecha de planificación es requerida'); return }
    setSaving(true); setErr(null)
    try {
      const created = await tripsApi.create(form as TripCreatePayload)
      onCreated(created)
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al crear el viaje')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const drivers  = empresa?.drivers  ?? []
  const vehicles = empresa?.vehicles ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 md:p-8">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl my-auto overflow-hidden flex flex-col">

        {/* Header */}
        <div className="bg-slate-900 px-6 py-5 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-accent/20 flex items-center justify-center">
              <Plus size={18} className="text-accent" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Nuevo Viaje</h2>
              <p className="text-xs text-white/40 mt-0.5">Ingresa los datos del viaje manualmente</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white transition-colors p-2 rounded-xl hover:bg-white/10">
            <X size={20} />
          </button>
        </div>

        {/* Body — 2 columns on desktop */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border/50">

            {/* LEFT — Identificación + Ruta */}
            <div className="p-6 space-y-5">
              <SectionTitle icon={<Search size={14} />}>Identificación</SectionTitle>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Fecha planificación" required>
                  <input type="date" value={form.planning_date ?? ''} onChange={e => set('planning_date', e.target.value)} className={INPUT} />
                </Field>
                <Field label="Fuente">
                  <select value={form.tms_name ?? 'manual'} onChange={e => set('tms_name', e.target.value)} className={INPUT}>
                    {(meta?.tms_sources ?? []).map(t => (
                      <option key={t.id} value={t.id}>{t.label} — {t.id}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="ID viaje en origen">
                  <input type="text" value={form.source_trip_id ?? ''} onChange={e => set('source_trip_id', e.target.value)} placeholder="VJE-001" className={INPUT} />
                </Field>
                <Field label="Cliente">
                  <input type="text" value={form.client_name ?? ''} onChange={e => set('client_name', e.target.value)} placeholder="Walmart, Sodimac…" className={INPUT} />
                </Field>
              </div>

              <div className="border-t border-border/50 pt-5">
                <SectionTitle icon={<Truck size={14} />}>Ruta</SectionTitle>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Origen">
                    <input type="text" value={form.origin ?? ''} onChange={e => set('origin', e.target.value)} placeholder="Santiago CD" className={INPUT} />
                  </Field>
                  <Field label="Tipo de carga">
                    <input type="text" value={form.cargo_type ?? ''} onChange={e => set('cargo_type', e.target.value)} placeholder="Refrigerado…" className={INPUT} />
                  </Field>
                </div>
                <div className="mt-3">
                  <Field label="Estado inicial">
                    <select value={form.current_status ?? ''} onChange={e => set('current_status', e.target.value)} className={INPUT}>
                      <option value="">— Sin estado</option>
                      {(meta?.statuses ?? []).map(s => (
                        <option key={s.id} value={s.id}>{s.label}</option>
                      ))}
                    </select>
                  </Field>
                </div>
              </div>
            </div>

            {/* RIGHT — Empresa & Flota (asociado con módulo Empresas) */}
            <div className="p-6 space-y-5">
              <SectionTitle icon={<Building2 size={14} />}>Empresa de Transporte</SectionTitle>

              <Field label="Buscar en módulo Empresas">
                <EmpresaSelector selected={empresa} onSelect={handleSelectEmpresa} onClear={handleClearEmpresa} />
              </Field>

              {/* Conductor — dropdown si empresa seleccionada, libre si no */}
              <div className="border-t border-border/50 pt-5">
                <SectionTitle icon={<User size={14} />}>Conductor</SectionTitle>
                {empresa && drivers.length > 0 ? (
                  <Field label="Seleccionar conductor">
                    <select
                      onChange={e => {
                        const d = drivers.find(x => x.id === e.target.value)
                        if (d) selectDriver({ name: d.name, rut: d.rut })
                      }}
                      className={INPUT}
                      defaultValue=""
                    >
                      <option value="">— Seleccionar conductor…</option>
                      {drivers.map(d => (
                        <option key={d.id} value={d.id}>{d.name ?? '—'} · {d.rut ?? ''}</option>
                      ))}
                    </select>
                  </Field>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Nombre">
                      <input type="text" value={form.driver_name ?? ''} onChange={e => set('driver_name', e.target.value)} placeholder="Juan Pérez" className={INPUT} />
                    </Field>
                    <Field label="RUT">
                      <input type="text" value={form.driver_rut ?? ''} onChange={e => set('driver_rut', e.target.value)} placeholder="12345678-9" className={INPUT} />
                    </Field>
                  </div>
                )}
                <div className="mt-3">
                  <Field label="Teléfono">
                    <input type="text" value={form.driver_phone ?? ''} onChange={e => set('driver_phone', e.target.value)} placeholder="+56912345678" className={INPUT} />
                  </Field>
                </div>

                {/* Preview auto-fill cuando se seleccionó conductor desde empresa */}
                {empresa && (form.driver_name || form.driver_rut) && (
                  <div className="mt-2 bg-gray-50 border border-border/60 rounded-lg px-3 py-2 text-[11px] text-gray-500">
                    <span className="font-semibold text-slate-700">{form.driver_name}</span>
                    {form.driver_rut && <span className="ml-2 font-mono text-gray-400">{form.driver_rut}</span>}
                  </div>
                )}
              </div>

              {/* Vehículo — dropdown si empresa seleccionada */}
              <div className="border-t border-border/50 pt-5">
                <SectionTitle icon={<Truck size={14} />}>Vehículo</SectionTitle>
                {empresa && vehicles.length > 0 ? (
                  <Field label="Seleccionar tracto">
                    <select
                      onChange={e => {
                        const v = vehicles.find(x => x.id === e.target.value)
                        if (v) selectVehicle({ plate: v.plate })
                      }}
                      className={INPUT}
                      defaultValue=""
                    >
                      <option value="">— Seleccionar vehículo…</option>
                      {vehicles.map(v => (
                        <option key={v.id} value={v.id}>{v.plate ?? '—'} · {v.type ?? ''}</option>
                      ))}
                    </select>
                  </Field>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Patente tracto">
                      <input type="text" value={form.tractor_plate ?? ''} onChange={e => set('tractor_plate', e.target.value.toUpperCase())} placeholder="BGVS12" className={INPUT + ' uppercase'} />
                    </Field>
                    <Field label="Patente rampla">
                      <input type="text" value={form.trailer_plate ?? ''} onChange={e => set('trailer_plate', e.target.value.toUpperCase())} placeholder="RMPLA01" className={INPUT + ' uppercase'} />
                    </Field>
                  </div>
                )}

                {/* Si hay empresa y se seleccionó tracto, mostrar también campo rampla libre */}
                {empresa && form.tractor_plate && (
                  <div className="mt-3">
                    <Field label="Patente rampla (opcional)">
                      <input type="text" value={form.trailer_plate ?? ''} onChange={e => set('trailer_plate', e.target.value.toUpperCase())} placeholder="RMPLA01" className={INPUT + ' uppercase'} />
                    </Field>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        {err && (
          <div className="px-6 pt-0 pb-1">
            <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</p>
          </div>
        )}
        <div className="shrink-0 border-t border-border px-6 py-4 flex items-center gap-3 bg-gray-50/50">
          <button onClick={onClose} className="px-4 py-2.5 text-sm text-gray-500 border border-border rounded-lg hover:bg-white transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleCreate}
            disabled={saving || !form.planning_date}
            className="flex-1 flex items-center justify-center gap-2 bg-accent text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-accent/90 disabled:opacity-40 transition-colors"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Crear viaje
          </button>
        </div>
      </div>
    </div>
  )
}
