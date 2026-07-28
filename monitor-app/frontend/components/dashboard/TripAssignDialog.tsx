'use client'

import { useState, useEffect, useRef } from 'react'
import { X, Loader2, Plus, Search, User, MapPin, Link2 } from 'lucide-react'
import type { Trip, TripsMeta, TripCreatePayload, TripStopCreatePayload } from '@/lib/types'
import { tripsApi } from '@/lib/api/trips'
import { useQuery } from '@tanstack/react-query'
import { RouteEditor } from '@/components/dashboard/RouteEditor'
import { FleetAssignSection, EMPTY_FLEET_ASSIGN_VALUE, type FleetAssignValue } from '@/components/dashboard/FleetAssignSection'
import { ClientPicker } from '@/components/dashboard/ClientPicker'

interface Props {
  open:      boolean
  onClose:   () => void
  onCreated: (trip: Trip) => void
  meta?:     TripsMeta | null
  /** Fecha activa del Diario — para sugerir conductores disponibles hoy */
  fecha:     string
  /** Precarga de equipo/conductor cuando se abre desde "Asignar viaje" en
   *  Centro de Flota (2026-07-28) — sin esto, abre en blanco como siempre. */
  initialFleet?: FleetAssignValue
}

const INPUT = "w-full text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all placeholder:text-gray-300"

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

export function TripAssignDialog({ open, onClose, onCreated, meta, fecha, initialFleet }: Props) {
  const [form, setForm]             = useState<Partial<TripCreatePayload>>({})
  const [clientName, setClientName] = useState('')
  const [originMode, setOriginMode] = useState<OriginMode>('none')
  const [originTms, setOriginTms]   = useState('')
  const [stops, setStops]           = useState<TripStopCreatePayload[]>([])
  const [fleet, setFleet]           = useState<FleetAssignValue>(EMPTY_FLEET_ASSIGN_VALUE)
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
      setClientName('')
      setOriginMode('none')
      setOriginTms('')
      setStops([])
      setFleet(initialFleet ?? EMPTY_FLEET_ASSIGN_VALUE)
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

  const mappedTms = (meta?.tms_sources ?? []).filter(t => t.id !== 'manual')

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
    if (!fleet.driver_id) { setErr('Elegí un conductor del directorio de Empresas antes de crear el viaje'); return }
    if (stops.some(s => s.stop_type !== 'ORIGIN' && !s.local.trim())) { setErr('Cada destino debe tener un nombre'); return }
    setSaving(true); setErr(null)
    try {
      const payload: TripCreatePayload = {
        planning_date:          form.planning_date,
        origin_tms:              originMode === 'none' ? undefined : originTms || undefined,
        source_system_trip_id:  form.source_system_trip_id,
        client_name:             clientName.trim() || undefined,
        cargo_type:              form.cargo_type,
        current_status:          form.current_status,
        stops:                   stops.filter(s => s.local.trim()),
        tractor_plate:           fleet.tractor_plate ?? undefined,
        trailer_plate:           fleet.trailer_plate ?? undefined,
        driver_name:             fleet.driver_name ?? undefined,
        driver_rut:              fleet.driver_rut ?? undefined,
        driver_phone:            fleet.driver_phone ?? undefined,
        transporter_name:        fleet.carrier_name ?? undefined,
        carrier_id:               fleet.carrier_id ?? undefined,
        driver_id:                fleet.driver_id ?? undefined,
        tractor_asset_id:        fleet.tractor_asset_id ?? undefined,
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

            {/* LEFT — Esencial + Sistema de origen + Ruta (origen y destinos unificados) */}
            <div className="p-6 space-y-5">
              <SectionTitle icon={<Search size={14} />}>Datos del viaje</SectionTitle>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Fecha planificación" required>
                  <input ref={firstFieldRef} type="date" value={form.planning_date ?? ''} onChange={e => set('planning_date', e.target.value)} className={INPUT} />
                </Field>
                <Field label="Cliente">
                  <ClientPicker value={clientName} onChange={setClientName} placeholder="Buscar o crear cliente…" />
                </Field>
              </div>
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
                  <div className="mt-2 space-y-1.5">
                    <p className="text-[10px] text-accent bg-accent/5 border border-accent/15 rounded-lg px-3 py-2">
                      Se vinculará automáticamente cuando {mappedTms.find(t => t.id === originTms)?.label ?? originTms} reporte este viaje (mismo cliente e ID).
                    </p>
                    <p className="text-[10px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                      El origen se conserva siempre, pero si {mappedTms.find(t => t.id === originTms)?.label ?? originTms} reporta paradas distintas a las que cargues abajo, los destinos que hayas puesto acá pueden reemplazarse por lo que reporte el TMS.
                    </p>
                  </div>
                )}
              </div>

              {/* Ruta — origen + destinos unificados (Fase 2, Plan 3) */}
              <div className="border-t border-border/50 pt-5">
                <SectionTitle icon={<MapPin size={14} />}>Ruta</SectionTitle>
                <RouteEditor stops={stops} onChange={setStops} />
              </div>
            </div>

            {/* RIGHT — Conductor primero (llave real de la operación diaria);
                empresa/vehículo se autocompletan editables desde sus
                asignaciones activas — Ronda 26, sobre FleetAssignSection (Fase 2, Plan 3) */}
            <div className="p-6 space-y-5">
              <SectionTitle icon={<User size={14} />}>Conductor</SectionTitle>
              <FleetAssignSection
                value={fleet}
                onChange={setFleet}
                suggested={availableQuery.data ?? []}
                suggestedLabel="Disponibles hoy"
                notFoundHint={
                  <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-2">
                    Si no aparece en la lista, hay que darlo de alta primero en{' '}
                    <a href="/dashboard/carriers" className="underline font-semibold">Empresas</a> — no se puede crear el viaje sin un conductor vinculado al directorio real.
                  </p>
                }
              />
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
              disabled={saving || !form.planning_date || !fleet.driver_id}
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
