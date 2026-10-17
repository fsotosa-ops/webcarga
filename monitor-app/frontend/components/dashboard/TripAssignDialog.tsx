'use client'

import { useState, useEffect, useId, useRef } from 'react'
import { Loader2, Search, User, MapPin, Link2 } from 'lucide-react'
import type { Trip, TripsMeta, TripCreatePayload, TripStopCreatePayload } from '@/lib/types'
import { tripsApi, type WithWarnings } from '@/lib/api/trips'
import { useQuery } from '@tanstack/react-query'
import { RouteEditor } from '@/components/dashboard/RouteEditor'
import { FleetAssignSection, EMPTY_FLEET_ASSIGN_VALUE, type FleetAssignValue } from '@/components/dashboard/FleetAssignSection'
import { ClientPicker, type ClienteElegido } from '@/components/dashboard/ClientPicker'
import { PanelLateral } from '@/components/ui/PanelLateral'
import { Button } from '@/components/ui/Button'
import { SegmentedControl } from '@/components/ui/SegmentedControl'

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

const INPUT = "w-full text-dato border border-border rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all placeholder:text-informativo/60"

/** Un aviso dentro del formulario: `info` explica lo que va a pasar, `warning` lo que
 *  conviene revisar antes de seguir. */
const NOTICE = {
  info:    'rounded-md border border-accent/15 bg-accent/5 px-3 py-2 text-etiqueta text-accion',
  warning: 'rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-etiqueta text-warning',
} as const


type OriginMode = 'none' | 'mapped' | 'other'
const ORIGIN_MODES: { id: OriginMode; label: string }[] = [
  { id: 'none',   label: 'Sin TMS' },
  { id: 'mapped', label: 'TMS integrado' },
  { id: 'other',  label: 'Otro sistema' },
]

const BASE_CARGO_TYPES = ['SECO', 'FRIO', 'CONGELADO']

function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="text-accent" aria-hidden="true">{icon}</span>
      <h3 className="text-dato font-semibold text-text-primary">{children}</h3>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-etiqueta font-semibold text-informativo">
        {label}{required && <span className="ml-0.5 text-status-incidente">*</span>}
      </label>
      {children}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────


export function TripAssignDialog({ open, onClose, onCreated, meta, fecha, initialFleet }: Props) {
  const [form, setForm]             = useState<Partial<TripCreatePayload>>({})
  // El cliente del directorio (spec 2026-10-11): el viaje guarda su id.
  const [cliente, setCliente] = useState<ClienteElegido | null>(null)
  const [originMode, setOriginMode] = useState<OriginMode>('none')
  const [originTms, setOriginTms]   = useState('')
  const [stops, setStops]           = useState<TripStopCreatePayload[]>([])
  const [fleet, setFleet]           = useState<FleetAssignValue>(EMPTY_FLEET_ASSIGN_VALUE)
  const [createdWithWarnings, setCreatedWithWarnings] = useState<WithWarnings<Trip> | null>(null)
  const [saving, setSaving]         = useState(false)
  const [err, setErr]               = useState<string | null>(null)
  const formId                      = useId()
  const firstFieldRef               = useRef<HTMLInputElement>(null)

  const availableQuery = useQuery({
    queryKey: ['available-drivers', fecha],
    queryFn: () => tripsApi.availableDrivers(fecha),
    enabled: open,
  })

  useEffect(() => {
    if (open) {
      setForm({ planning_date: todayISO() })
      setCliente(null)
      setOriginMode('none')
      setOriginTms('')
      setStops([])
      setFleet(initialFleet ?? EMPTY_FLEET_ASSIGN_VALUE)
      setErr(null)
      setCreatedWithWarnings(null)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // El diálogo (fondo, Escape, Tab, el foco de vuelta) es el del kit; aquí solo se
  // elige dónde empieza el foco: en la fecha, lo primero que se llena.
  useEffect(() => { if (open) firstFieldRef.current?.focus() }, [open])

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
    originMode === 'mapped' && !!originTms && !!form.source_system_trip_id && !!cliente

  async function handleCreate() {
    if (!form.planning_date) { setErr('La fecha de planificación es requerida'); return }
    if (!cliente) { setErr('Elige el cliente del viaje'); return }
    if (!fleet.driver_id) { setErr('Elige un conductor del directorio de Empresas antes de crear el viaje'); return }
    if (stops.some(s => s.stop_type !== 'ORIGIN' && !s.local.trim())) { setErr('Cada destino debe tener un nombre'); return }
    setSaving(true); setErr(null)
    try {
      const payload: TripCreatePayload = {
        planning_date:          form.planning_date,
        origin_tms:              originMode === 'none' ? undefined : originTms || undefined,
        source_system_trip_id:  form.source_system_trip_id,
        shipper_id:              cliente.id,
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
      // Se asignó, pero la empresa no está habilitada: decirlo ANTES de seguir,
      // no en un toast que se pierde al navegar (P14 abierta: bloquear después
      // es una línea en la API). Un rechazo (409) llega como `e.message`.
      if (created.warnings?.length) { setCreatedWithWarnings(created); return }
      onCreated(created)
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al crear el viaje')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const ready = !!form.planning_date && !!cliente && !!fleet.driver_id

  return (
    <PanelLateral
      placement="center"
      ancho="amplio"
      titulo="Nuevo viaje"
      description="Registro manual: quedará con fuente MAN"
      onCerrar={onClose}
      pie={createdWithWarnings ? (
        <Button variant="primary" onClick={() => { onCreated(createdWithWarnings); onClose() }}>Continuar</Button>
      ) : (
        <div className="flex items-center gap-3">
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" type="submit" form={formId} className="flex-1" disabled={saving || !ready}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            Crear viaje
          </Button>
        </div>
      )}
    >
      {createdWithWarnings ? (
        <div role="status" className="space-y-3">
          <p className="text-lectura font-semibold text-text-primary">Viaje creado.</p>
          {createdWithWarnings.warnings!.map(w => (
            <p key={w.code} className="rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-dato text-warning">{w.message}</p>
          ))}
        </div>
      ) : (
        /* Enter en cualquier campo crea el viaje */
        <form id={formId} onSubmit={e => { e.preventDefault(); handleCreate() }}>
          <div className="grid gap-6 md:grid-cols-2 md:gap-0 md:divide-x md:divide-border/50">
            {/* LEFT — Esencial + Sistema de origen + Ruta (origen y destinos unificados) */}
            <div className="space-y-5 md:pr-6">
              <SectionTitle icon={<Search size={14} />}>Datos del viaje</SectionTitle>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Fecha planificación" required>
                  <input ref={firstFieldRef} type="date" value={form.planning_date ?? ''} onChange={e => set('planning_date', e.target.value)} className={INPUT} />
                </Field>
                <Field label="Cliente" required>
                  <ClientPicker value={cliente} onChange={setCliente} placeholder="Buscar o crear cliente…" />
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
              <div className="border-t border-border pt-5">
                <SectionTitle icon={<Link2 size={14} />}>¿De dónde viene este viaje?</SectionTitle>
                <div className="mb-3">
                  <SegmentedControl label="¿De dónde viene este viaje?" options={ORIGIN_MODES} value={originMode}
                    onChange={id => { setOriginMode(id); setOriginTms('') }} />
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
                    <p className="mt-2 text-etiqueta text-informativo">
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
                    <p className={NOTICE.info}>
                      Se vinculará automáticamente cuando {mappedTms.find(t => t.id === originTms)?.label ?? originTms} reporte este viaje (mismo cliente e ID).
                    </p>
                    <p className={NOTICE.warning}>
                      El origen se conserva siempre, pero si {mappedTms.find(t => t.id === originTms)?.label ?? originTms} reporta paradas distintas a las que cargues abajo, los destinos que hayas puesto acá pueden reemplazarse por lo que reporte el TMS.
                    </p>
                  </div>
                )}
              </div>

              {/* Ruta — origen + destinos unificados (Fase 2, Plan 3) */}
              <div className="border-t border-border pt-5">
                <SectionTitle icon={<MapPin size={14} />}>Ruta</SectionTitle>
                <RouteEditor stops={stops} onChange={setStops} />
              </div>
            </div>

            {/* RIGHT — Conductor primero (llave real de la operación diaria);
                empresa/vehículo se autocompletan editables desde sus
                asignaciones activas — Ronda 26, sobre FleetAssignSection (Fase 2, Plan 3) */}
            <div className="space-y-5 md:pl-6">
              <SectionTitle icon={<User size={14} />}>Conductor</SectionTitle>
              <FleetAssignSection
                value={fleet}
                onChange={setFleet}
                suggested={availableQuery.data ?? []}
                suggestedLabel="Disponibles hoy"
                notFoundHint={
                  <p className={`mt-2 ${NOTICE.warning}`}>
                    Si no aparece en la lista, hay que darlo de alta primero en el{' '}
                    <a href="/dashboard/carriers" className="underline font-semibold">Directorio</a> — no se puede crear el viaje sin un conductor vinculado al directorio real.
                  </p>
                }
              />
            </div>
          </div>

          {err && (
            <p role="alert" className="mt-4 rounded-md border border-status-incidente/20 bg-status-incidente/5 px-3 py-2 text-dato text-status-incidente">{err}</p>
          )}
        </form>
      )}
    </PanelLateral>
  )
}
