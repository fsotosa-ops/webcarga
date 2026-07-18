'use client'

import { useState, useEffect, useRef } from 'react'
import {
  X, Loader2, Plus, Search, Building2, User, Truck,
  MapPin, Trash2, Link2,
} from 'lucide-react'
import type {
  Trip, TripsMeta, TripCreatePayload, TripStopCreatePayload,
} from '@/lib/types'
import { tripsApi } from '@/lib/api/trips'
import { carriersApi } from '@/lib/api/carriers'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useQuery } from '@tanstack/react-query'
import { RegionCityPicker } from '@/components/ui/RegionCityPicker'

// Búsqueda debounced de empresa (public.carriers) — mismo patrón que
// TransferModal.tsx/TransporterAssignSection. Reactivado 2026-07-17: ver
// migración migrate_trip_fleet_links_to_carriers.
type EmpresaSeleccionada = {
  id: string
  business_name: string | null
  rut: string | null
  drivers: { id: string; name: string | null; rut: string | null }[]
  vehicles: { id: string; plate: string | null; type: string | null }[]
}

interface Props {
  open:      boolean
  onClose:   () => void
  onCreated: (trip: Trip) => void
  meta?:     TripsMeta | null
  /** Pre-llenado (ej: asignar un conductor liberado a un viaje nuevo) */
  prefill?:  Partial<TripCreatePayload> | null
}

const INPUT = "w-full text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all placeholder:text-gray-300"

// Sin w-full: convive en la fila de destino con el input de nombre (INPUT trae
// w-full y dos utilidades de ancho en conflicto dejan el ancho al azar del stylesheet)
const INPUT_DATE = "text-sm border border-border rounded-lg px-2 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all w-[150px] sm:w-[185px]"

// Valores canónicos en minúscula: coinciden con app.trips.client_name real y con
// la fórmula md5 de reconciliación (que lowercasea el cliente)
const MANUAL_CLIENTS = [
  { value: 'walmart', label: 'Walmart' },
  { value: 'sodimac', label: 'Sodimac' },
  { value: 'colun',   label: 'Colún'   },
  { value: 'iansa',   label: 'Iansa'   },
] as const

const OTHER_CLIENT = 'otro'

const BASE_CARGO_TYPES = ['SECO', 'FRIO', 'CONGELADO']

function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
}

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
  selected: EmpresaSeleccionada | null
  onSelect: (t: EmpresaSeleccionada) => void
  onClear:  () => void
}) {
  const [q, setQ]           = useState('')
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [err, setErr]       = useState<string | null>(null)
  const qDebounced = useDebouncedValue(q, 250)

  const query = useQuery({
    queryKey: ['carriers', 'trip-create-search', qDebounced],
    queryFn: () => carriersApi.list({ q: qDebounced, limit: 10 }),
    enabled: qDebounced.length >= 2,
  })
  const results = query.data?.data ?? []

  async function handlePick(carrierId: string, businessName: string, taxId: string) {
    setLoadingId(carrierId); setErr(null)
    try {
      const [drivers, assets] = await Promise.all([
        carriersApi.listDrivers(carrierId),
        carriersApi.listAssets(carrierId),
      ])
      onSelect({
        id: carrierId,
        business_name: businessName,
        rut: taxId,
        drivers: drivers.map(d => ({ id: d.id, name: d.full_name, rut: d.tax_id })),
        vehicles: assets.map(a => ({ id: a.id, plate: a.license_plate, type: a.asset_type })),
      })
      setQ('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al cargar la empresa')
    } finally {
      setLoadingId(null)
    }
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
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Buscar empresa (nombre o RUT)…"
          aria-label="Buscar empresa transportista"
          className={INPUT + ' pl-8'}
        />
      </div>
      {q.length >= 2 && (
        <div className="max-h-40 overflow-y-auto border border-border rounded-lg divide-y divide-border/60 mt-1.5">
          {query.isFetching && (
            <p className="px-3 py-2 text-center text-[11px] text-gray-400 flex items-center justify-center gap-1.5">
              <Loader2 size={11} className="animate-spin" /> Buscando…
            </p>
          )}
          {!query.isFetching && results.length === 0 && (
            <p className="px-3 py-2 text-center text-[11px] text-gray-400">Sin resultados</p>
          )}
          {results.map(c => (
            <button
              key={c.id}
              type="button"
              disabled={loadingId === c.id}
              onClick={() => handlePick(c.id, c.business_name, c.tax_id)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <Building2 size={12} className="text-gray-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold text-text-primary truncate">{c.business_name}</p>
                <p className="text-[10px] text-gray-400 font-mono">{c.tax_id}</p>
              </div>
              {loadingId === c.id && <Loader2 size={11} className="animate-spin shrink-0" />}
            </button>
          ))}
        </div>
      )}
      {err && <p className="text-[11px] text-red-500 mt-1">{err}</p>}
      <p className="text-[10px] text-gray-400 mt-1.5 pl-1">
        O ingreso libre de conductor y patente más abajo
      </p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

type OriginMode = 'none' | 'mapped' | 'other'

export function TripCreateSlideOver({ open, onClose, onCreated, meta, prefill }: Props) {
  const [form, setForm]             = useState<Partial<TripCreatePayload>>({})
  const [clientChoice, setClientChoice] = useState('')
  const [clientOther, setClientOther]   = useState('')
  const [originMode, setOriginMode] = useState<OriginMode>('none')
  const [originTms, setOriginTms]   = useState('')
  const [stops, setStops]           = useState<TripStopCreatePayload[]>([])
  const [empresa, setEmpresa]       = useState<EmpresaSeleccionada | null>(null)
  const [saving, setSaving]         = useState(false)
  const [err, setErr]               = useState<string | null>(null)
  const panelRef                    = useRef<HTMLDivElement>(null)
  const firstFieldRef               = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setForm({ planning_date: todayISO(), ...(prefill ?? {}) })
      const preClient = prefill?.client_name ?? ''
      if (MANUAL_CLIENTS.some(c => c.value === preClient)) {
        setClientChoice(preClient); setClientOther('')
      } else {
        setClientChoice(preClient ? OTHER_CLIENT : ''); setClientOther(preClient)
      }
      setOriginMode('none')
      setOriginTms('')
      setStops([])
      setEmpresa(null)
      setErr(null)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Semántica de diálogo: Escape cierra, Tab atrapado, foco inicial y retorno
  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    firstFieldRef.current?.focus()

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
  }, [open, onClose])

  function set(field: keyof TripCreatePayload, value: string) {
    setForm(f => ({ ...f, [field]: value || undefined }))
  }

  function handleSelectEmpresa(profile: EmpresaSeleccionada) {
    setEmpresa(profile)
    setForm(f => ({
      ...f,
      transporter_name: profile.business_name ?? undefined,
      carrier_id:       profile.id,
    }))
  }

  function handleClearEmpresa() {
    setEmpresa(null)
    setForm(f => ({
      ...f,
      transporter_name: undefined,
      carrier_id:        undefined,
      driver_name:       undefined,
      driver_rut:        undefined,
      driver_phone:      undefined,
      driver_id:         undefined,
      tractor_plate:     undefined,
      trailer_plate:     undefined,
      tractor_asset_id:  undefined,
    }))
  }

  const mappedTms = (meta?.tms_sources ?? []).filter(t => t.id !== 'manual')

  // Cliente derivado del dropdown: "Otro cliente" usa el texto libre o el genérico 'otro'
  const clientName =
    clientChoice === OTHER_CLIENT ? (clientOther.trim() || OTHER_CLIENT) : clientChoice || undefined

  // Tipos de carga: base + los configurados en Rangos de Temperatura (dedup)
  const cargoTypes = Array.from(new Set([
    ...BASE_CARGO_TYPES,
    ...(meta?.temperature_ranges ?? []).map(r => r.cargo_type),
    ...(form.cargo_type ? [form.cargo_type] : []),
  ]))

  const canReconcile =
    originMode === 'mapped' && !!originTms && !!form.source_system_trip_id && !!clientName

  async function handleCreate() {
    if (!form.planning_date) { setErr('La fecha de planificación es requerida'); return }
    if (stops.some(s => !s.local.trim())) { setErr('Cada destino debe tener un nombre'); return }
    setSaving(true); setErr(null)
    try {
      const payload: TripCreatePayload = {
        ...(form as TripCreatePayload),
        client_name: clientName,
        origin_tms: originMode === 'none' ? undefined : originTms || undefined,
        stops: stops.filter(s => s.local.trim()),
      }
      const created = await tripsApi.create(payload)
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 md:p-8 animate-backdrop-in">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Nuevo viaje manual"
        tabIndex={-1}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl my-auto overflow-hidden flex flex-col focus:outline-none animate-modal-in"
      >

        {/* Header */}
        <div className="bg-slate-900 px-6 py-4 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-accent/20 flex items-center justify-center">
              <Plus size={18} className="text-accent" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Nuevo Viaje</h2>
              <p className="text-xs text-white/40 mt-0.5">Registro manual — quedará con fuente MAN</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-white/50 hover:text-white transition-colors p-2 rounded-xl hover:bg-white/10">
            <X size={20} />
          </button>
        </div>

        {/* Body — form con Enter para crear */}
        <form
          className="flex-1 overflow-y-auto min-h-0 flex flex-col"
          onSubmit={e => { e.preventDefault(); handleCreate() }}
        >
          <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border/50 flex-1">

            {/* LEFT — Esencial + Origen del viaje + Destinos */}
            <div className="p-6 space-y-5">
              <SectionTitle icon={<Search size={14} />}>Datos del viaje</SectionTitle>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Fecha planificación" required>
                  <input ref={firstFieldRef} type="date" value={form.planning_date ?? ''} onChange={e => set('planning_date', e.target.value)} className={INPUT} />
                </Field>
                <Field label="Cliente">
                  <select
                    value={clientChoice}
                    onChange={e => { setClientChoice(e.target.value); if (e.target.value !== OTHER_CLIENT) setClientOther('') }}
                    aria-label="Cliente"
                    className={INPUT}
                  >
                    <option value="">— Seleccionar…</option>
                    {MANUAL_CLIENTS.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                    <option value={OTHER_CLIENT}>Otro cliente (spot)</option>
                  </select>
                </Field>
              </div>
              {clientChoice === OTHER_CLIENT && (
                <Field label="Nombre del cliente (opcional)">
                  <input
                    type="text"
                    value={clientOther}
                    onChange={e => setClientOther(e.target.value)}
                    placeholder="Si aún no se sabe, queda como “otro”"
                    aria-label="Nombre del cliente"
                    className={INPUT}
                  />
                </Field>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Origen">
                  <input type="text" value={form.origin ?? ''} onChange={e => set('origin', e.target.value)} placeholder="Santiago CD" className={INPUT} />
                </Field>
                <Field label="Tipo de carga">
                  <select
                    value={form.cargo_type ?? ''}
                    onChange={e => set('cargo_type', e.target.value)}
                    aria-label="Tipo de carga"
                    className={INPUT}
                  >
                    <option value="">— Sin especificar</option>
                    {cargoTypes.map(ct => (
                      <option key={ct} value={ct}>{ct}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Región / ciudad de origen">
                <RegionCityPicker
                  region={form.origin_region ?? null}
                  city={form.origin_city ?? null}
                  onChange={(region, city) => setForm(f => ({ ...f, origin_region: region, origin_city: city }))}
                  labelSuffix="de origen"
                />
              </Field>
              <Field label="Estado inicial">
                <select value={form.current_status ?? ''} onChange={e => set('current_status', e.target.value)} className={INPUT}>
                  <option value="">— Sin estado</option>
                  {(meta?.statuses ?? []).map(s => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </Field>

              {/* Sistema de origen — separa el canal de ingreso (manual) del origen real */}
              <div className="border-t border-border/50 pt-5">
                <SectionTitle icon={<Link2 size={14} />}>¿De dónde viene este viaje?</SectionTitle>
                <div className="flex items-center gap-1.5 flex-wrap mb-3">
                  {([
                    { id: 'none',   label: 'Sin TMS'      },
                    { id: 'mapped', label: 'TMS integrado' },
                    { id: 'other',  label: 'Otro sistema'  },
                  ] as const).map(m => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => { setOriginMode(m.id); setOriginTms('') }}
                      aria-pressed={originMode === m.id}
                      className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all ${
                        originMode === m.id
                          ? 'bg-accent border-accent text-white'
                          : 'text-gray-500 border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                {originMode === 'none' && (
                  <div>
                    <Field label="ID de seguimiento (opcional)">
                      <input
                        type="text"
                        value={form.source_system_trip_id ?? ''}
                        onChange={e => set('source_system_trip_id', e.target.value)}
                        placeholder="Guía, hoja de ruta, factura…"
                        className={INPUT}
                      />
                    </Field>
                    <p className="mt-2 text-[10px] text-gray-400">
                      El viaje queda igual con un ID interno de Webcarga para trazabilidad y facturación.
                    </p>
                  </div>
                )}
                {originMode === 'mapped' && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="TMS">
                      <select value={originTms} onChange={e => setOriginTms(e.target.value)} aria-label="TMS de origen" className={INPUT}>
                        <option value="">— Seleccionar…</option>
                        {mappedTms.map(t => (
                          <option key={t.id} value={t.id}>{t.label}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="ID del viaje en ese TMS">
                      <input type="text" value={form.source_system_trip_id ?? ''} onChange={e => set('source_system_trip_id', e.target.value)} placeholder="1994062" className={INPUT} />
                    </Field>
                  </div>
                )}
                {originMode === 'other' && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Nombre del sistema">
                      <input type="text" value={originTms} onChange={e => setOriginTms(e.target.value)} placeholder="Ej: Beetrack" className={INPUT} />
                    </Field>
                    <Field label="ID del viaje (opcional)">
                      <input type="text" value={form.source_system_trip_id ?? ''} onChange={e => set('source_system_trip_id', e.target.value)} placeholder="VJE-001" className={INPUT} />
                    </Field>
                  </div>
                )}
                {canReconcile && (
                  <p className="mt-2 text-[10px] text-accent bg-accent/5 border border-accent/15 rounded-lg px-3 py-2">
                    Se vinculará automáticamente cuando {mappedTms.find(t => t.id === originTms)?.label ?? originTms} reporte este viaje (mismo cliente e ID).
                  </p>
                )}
              </div>

              {/* Destinos */}
              <div className="border-t border-border/50 pt-5">
                <SectionTitle icon={<MapPin size={14} />}>Destinos</SectionTitle>
                <div className="space-y-2">
                  {stops.map((s, i) => (
                    <div key={i} className="space-y-1.5 border border-border/60 rounded-lg p-2">
                      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
                        <input
                          type="text"
                          value={s.local}
                          onChange={e => setStops(prev => prev.map((x, j) => j === i ? { ...x, local: e.target.value } : x))}
                          placeholder={`Destino ${i + 1} — nombre del local`}
                          className={INPUT}
                          aria-label={`Nombre destino ${i + 1}`}
                        />
                        <input
                          type="datetime-local"
                          value={s.planning_date ?? ''}
                          onChange={e => setStops(prev => prev.map((x, j) => j === i ? { ...x, planning_date: e.target.value || null } : x))}
                          className={INPUT_DATE}
                          aria-label={`Fecha planificada destino ${i + 1}`}
                        />
                        <button
                          type="button"
                          onClick={() => setStops(prev => prev.filter((_, j) => j !== i))}
                          aria-label={`Quitar destino ${i + 1}`}
                          className="p-2 rounded-lg border border-transparent text-gray-400 hover:text-red-500 hover:border-red-200 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <RegionCityPicker
                        size="sm"
                        region={s.destination_region ?? null}
                        city={s.destination_city ?? null}
                        onChange={(region, city) => setStops(prev => prev.map((x, j) =>
                          j === i ? { ...x, destination_region: region, destination_city: city } : x))}
                        labelSuffix={`destino ${i + 1}`}
                      />
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setStops(prev => [...prev, { local: '', planning_date: null }])}
                    className="flex items-center gap-1.5 text-xs text-accent hover:text-accent/80 transition-colors"
                  >
                    <Plus size={12} />
                    Agregar destino
                  </button>
                </div>
              </div>
            </div>

            {/* RIGHT — Empresa & Flota (asociado con módulo Empresas) */}
            <div className="p-6 space-y-5">
              <SectionTitle icon={<Building2 size={14} />}>Empresa de Transporte</SectionTitle>

              <Field label="Buscar en módulo Empresas">
                <EmpresaSelector selected={empresa} onSelect={handleSelectEmpresa} onClear={handleClearEmpresa} />
              </Field>

              {/* Conductor — dropdown como atajo; los campos libres SIEMPRE disponibles */}
              <div className="border-t border-border/50 pt-5">
                <SectionTitle icon={<User size={14} />}>Conductor</SectionTitle>
                {empresa && drivers.length > 0 && (
                  <div className="mb-3">
                    <Field label="Autocompletar desde la empresa">
                      <select
                        onChange={e => {
                          const d = drivers.find(x => x.id === e.target.value)
                          setForm(f => ({
                            ...f,
                            driver_name: d?.name ?? f.driver_name,
                            driver_rut:  d?.rut ?? f.driver_rut,
                            driver_id:   d?.id,
                          }))
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
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Nombre">
                    <input type="text" value={form.driver_name ?? ''} onChange={e => set('driver_name', e.target.value)} placeholder="Juan Pérez" className={INPUT} />
                  </Field>
                  <Field label="RUT">
                    <input type="text" value={form.driver_rut ?? ''} onChange={e => set('driver_rut', e.target.value)} placeholder="12345678-9" className={INPUT} />
                  </Field>
                </div>
                <div className="mt-3">
                  <Field label="Teléfono">
                    <input type="text" value={form.driver_phone ?? ''} onChange={e => set('driver_phone', e.target.value)} placeholder="+56912345678" className={INPUT} />
                  </Field>
                </div>
              </div>

              {/* Vehículo — dropdown como atajo; campos libres siempre disponibles */}
              <div className="border-t border-border/50 pt-5">
                <SectionTitle icon={<Truck size={14} />}>Vehículo</SectionTitle>
                {empresa && vehicles.length > 0 && (
                  <div className="mb-3">
                    <Field label="Autocompletar desde la empresa">
                      <select
                        onChange={e => {
                          const v = vehicles.find(x => x.id === e.target.value)
                          setForm(f => ({
                            ...f,
                            tractor_plate:    v?.plate ? v.plate.toUpperCase() : f.tractor_plate,
                            tractor_asset_id: v?.id,
                          }))
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
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Patente tracto">
                    <input type="text" value={form.tractor_plate ?? ''} onChange={e => set('tractor_plate', e.target.value.toUpperCase())} placeholder="BGVS12" className={INPUT + ' uppercase'} />
                  </Field>
                  <Field label="Patente rampla">
                    <input type="text" value={form.trailer_plate ?? ''} onChange={e => set('trailer_plate', e.target.value.toUpperCase())} placeholder="RMPLA01" className={INPUT + ' uppercase'} />
                  </Field>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          {err && (
            <div className="px-6 pt-3 pb-0 shrink-0">
              <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</p>
            </div>
          )}
          <div className="shrink-0 border-t border-border px-6 py-4 flex items-center gap-3 bg-gray-50/50 mt-3">
            <button type="button" onClick={onClose} className="px-4 py-2.5 text-sm text-gray-500 border border-border rounded-lg hover:bg-white transition-colors">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || !form.planning_date}
              className="flex-1 flex items-center justify-center gap-2 bg-accent text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-accent/90 disabled:opacity-40 transition-colors"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              Crear viaje
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
