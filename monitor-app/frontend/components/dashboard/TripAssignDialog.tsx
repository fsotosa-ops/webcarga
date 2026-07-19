'use client'

import { useState, useEffect, useRef } from 'react'
import {
  X, Loader2, Plus, Search, User, Truck,
  MapPin, Trash2, Link2,
} from 'lucide-react'
import type {
  Trip, TripsMeta, TripCreatePayload, TripStopCreatePayload, DriverPickCandidate,
} from '@/lib/types'
import { tripsApi } from '@/lib/api/trips'
import { driversApi } from '@/lib/api/drivers'
import { useQuery } from '@tanstack/react-query'
import { RegionCityPicker } from '@/components/ui/RegionCityPicker'
import { DriverSearchPicker } from '@/components/dashboard/DriverSearchPicker'

interface Props {
  open:      boolean
  onClose:   () => void
  onCreated: (trip: Trip) => void
  meta?:     TripsMeta | null
  /** Fecha activa del Diario — para sugerir conductores disponibles hoy */
  fecha:     string
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

// ── Main component ────────────────────────────────────────────────────────────

type OriginMode = 'none' | 'mapped' | 'other'

export function TripAssignDialog({ open, onClose, onCreated, meta, fecha }: Props) {
  const [form, setForm]             = useState<Partial<TripCreatePayload>>({})
  const [clientChoice, setClientChoice] = useState('')
  const [clientOther, setClientOther]   = useState('')
  const [originMode, setOriginMode] = useState<OriginMode>('none')
  const [originTms, setOriginTms]   = useState('')
  const [stops, setStops]           = useState<TripStopCreatePayload[]>([])
  const [driverQuery, setDriverQuery]   = useState('')
  const [pickedDriver, setPickedDriver] = useState<DriverPickCandidate | null>(null)
  const [saving, setSaving]         = useState(false)
  const [err, setErr]               = useState<string | null>(null)
  const panelRef                    = useRef<HTMLDivElement>(null)
  const firstFieldRef               = useRef<HTMLInputElement>(null)

  const availableQuery = useQuery({
    queryKey: ['available-drivers', fecha],
    queryFn: () => tripsApi.availableDrivers(fecha),
    enabled: open,
  })

  useEffect(() => {
    if (open) {
      setForm({ planning_date: todayISO() })
      setClientChoice(''); setClientOther('')
      setOriginMode('none')
      setOriginTms('')
      setStops([])
      setPickedDriver(null)
      setDriverQuery('')
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

  function handlePickDriver(d: DriverPickCandidate) {
    setPickedDriver(d)
    setDriverQuery('')
    setForm(f => ({
      ...f,
      driver_id:         d.driver_id,
      driver_name:       d.driver_name,
      driver_rut:        d.driver_rut ?? undefined,
      driver_phone:      d.driver_phone ?? undefined,
      carrier_id:        d.carrier_id ?? undefined,
      transporter_name:  d.carrier_name ?? undefined,
      tractor_asset_id:  d.tractor_asset_id ?? undefined,
      tractor_plate:     d.tractor_plate ?? undefined,
    }))
  }

  function handleClearDriver() {
    setPickedDriver(null)
    setForm(f => ({
      ...f,
      driver_id: undefined, driver_name: undefined, driver_rut: undefined,
      driver_phone: undefined, carrier_id: undefined, transporter_name: undefined,
      tractor_asset_id: undefined, tractor_plate: undefined,
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
    if (!form.driver_id) { setErr('Elegí un conductor del directorio de Empresas antes de crear el viaje'); return }
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

            {/* RIGHT — Conductor primero (llave real de la operación diaria);
                empresa/vehículo se autocompletan editables desde sus
                asignaciones activas — Ronda 26, TripAssignDialog */}
            <div className="p-6 space-y-5">
              <SectionTitle icon={<User size={14} />}>Conductor</SectionTitle>

              {pickedDriver ? (
                <div className="flex items-center justify-between bg-accent/5 border border-accent/20 rounded-xl px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{pickedDriver.driver_name}</p>
                    <p className="text-[10px] text-gray-400 font-mono">{pickedDriver.driver_rut ?? ''}</p>
                  </div>
                  <button type="button" onClick={handleClearDriver} className="text-xs text-gray-400 hover:text-red-400 transition-colors shrink-0 ml-3">
                    Cambiar
                  </button>
                </div>
              ) : (
                <>
                  <DriverSearchPicker
                    query={driverQuery}
                    onQueryChange={setDriverQuery}
                    onPick={handlePickDriver}
                    suggested={availableQuery.data ?? []}
                    suggestedLabel="Disponibles hoy"
                    autoFocus
                  />
                  {driverQuery.trim().length >= 2 && (
                    <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-2">
                      Si no aparece en la lista, hay que darlo de alta primero en{' '}
                      <a href="/dashboard/transportistas" className="underline font-semibold">Empresas</a> — no se puede crear el viaje sin un conductor vinculado al directorio real.
                    </p>
                  )}
                </>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Field label="Empresa de transporte">
                  <input type="text" value={form.transporter_name ?? ''} onChange={e => set('transporter_name', e.target.value)} placeholder="Se autocompleta al elegir conductor" className={INPUT} disabled={!pickedDriver} />
                </Field>
                <Field label="Teléfono">
                  <input type="text" value={form.driver_phone ?? ''} onChange={e => set('driver_phone', e.target.value)} placeholder="+56912345678" className={INPUT} disabled={!pickedDriver} />
                </Field>
              </div>

              <div className="border-t border-border/50 pt-5">
                <SectionTitle icon={<Truck size={14} />}>Vehículo</SectionTitle>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Patente tracto">
                    <input type="text" value={form.tractor_plate ?? ''} onChange={e => set('tractor_plate', e.target.value.toUpperCase())} placeholder="BGVS12" className={INPUT + ' uppercase'} disabled={!pickedDriver} />
                  </Field>
                  <Field label="Patente rampla">
                    <input type="text" value={form.trailer_plate ?? ''} onChange={e => set('trailer_plate', e.target.value.toUpperCase())} placeholder="RMPLA01" className={INPUT + ' uppercase'} />
                  </Field>
                </div>
                <p className="text-[10px] text-gray-400 mt-1.5">
                  Autocompletado editable desde la asignación activa del conductor — corregí acá si ese día manejó otro equipo.
                </p>
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
              disabled={saving || !form.planning_date || !form.driver_id}
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
