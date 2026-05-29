'use client'

import { useState, useEffect } from 'react'
import { X, Loader2, Plus } from 'lucide-react'
import type { Trip, TripsMeta, TripCreatePayload } from '@/lib/types'
import { tripsApi } from '@/lib/api/trips'

interface Props {
  open:      boolean
  onClose:   () => void
  onCreated: (trip: Trip) => void
  meta?:     TripsMeta | null
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 mt-5 first:mt-0">
      {children}
    </p>
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

const INPUT = "w-full text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/40 transition-all placeholder:text-gray-300"

export function TripCreateSlideOver({ open, onClose, onCreated, meta }: Props) {
  const [form, setForm]   = useState<Partial<TripCreatePayload>>({ tms_name: 'manual' })
  const [saving, setSaving] = useState(false)
  const [err, setErr]     = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setForm({ tms_name: 'manual' })
      setErr(null)
    }
  }, [open])

  const set = (field: keyof TripCreatePayload, value: string) =>
    setForm(f => ({ ...f, [field]: value || undefined }))

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

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex flex-col bg-white
                      md:inset-y-3 md:right-3 md:left-auto
                      md:w-full md:max-w-xl
                      md:rounded-2xl md:shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="bg-slate-900 px-5 py-4 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Plus size={16} className="text-accent" />
                Nuevo Viaje
              </h2>
              <p className="text-xs text-white/40 mt-0.5">Ingresa los datos del viaje manualmente</p>
            </div>
            <button onClick={onClose} className="text-white/50 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto min-h-0 p-5 space-y-4">

          {/* Identificación */}
          <SectionLabel>Identificación</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fecha planificación" required>
              <input
                type="date"
                value={form.planning_date ?? ''}
                onChange={e => set('planning_date', e.target.value)}
                className={INPUT}
              />
            </Field>
            <Field label="Fuente">
              <select
                value={form.tms_name ?? 'manual'}
                onChange={e => set('tms_name', e.target.value)}
                className={INPUT}
              >
                {(meta?.tms_sources ?? []).map(t => (
                  <option key={t.id} value={t.id}>{t.label} — {t.id}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="ID viaje en origen">
              <input
                type="text"
                value={form.source_trip_id ?? ''}
                onChange={e => set('source_trip_id', e.target.value)}
                placeholder="Ej. VJE-001"
                className={INPUT}
              />
            </Field>
            <Field label="Cliente">
              <input
                type="text"
                value={form.client_name ?? ''}
                onChange={e => set('client_name', e.target.value)}
                placeholder="Walmart, Sodimac…"
                className={INPUT}
              />
            </Field>
          </div>

          {/* Ruta */}
          <SectionLabel>Ruta</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Origen">
              <input
                type="text"
                value={form.origin ?? ''}
                onChange={e => set('origin', e.target.value)}
                placeholder="Santiago CD"
                className={INPUT}
              />
            </Field>
            <Field label="Tipo de carga">
              <input
                type="text"
                value={form.cargo_type ?? ''}
                onChange={e => set('cargo_type', e.target.value)}
                placeholder="Refrigerado, Seco…"
                className={INPUT}
              />
            </Field>
          </div>
          <Field label="Estado inicial">
            <select
              value={form.current_status ?? ''}
              onChange={e => set('current_status', e.target.value)}
              className={INPUT}
            >
              <option value="">— Sin estado</option>
              {(meta?.statuses ?? []).map(s => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </Field>

          {/* Flota */}
          <SectionLabel>Flota</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Patente tracto">
              <input
                type="text"
                value={form.tractor_plate ?? ''}
                onChange={e => set('tractor_plate', e.target.value.toUpperCase())}
                placeholder="BGVS12"
                className={INPUT + ' uppercase'}
              />
            </Field>
            <Field label="Patente rampla">
              <input
                type="text"
                value={form.trailer_plate ?? ''}
                onChange={e => set('trailer_plate', e.target.value.toUpperCase())}
                placeholder="RMPLA01"
                className={INPUT + ' uppercase'}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Conductor">
              <input
                type="text"
                value={form.driver_name ?? ''}
                onChange={e => set('driver_name', e.target.value)}
                placeholder="Juan Pérez"
                className={INPUT}
              />
            </Field>
            <Field label="RUT conductor">
              <input
                type="text"
                value={form.driver_rut ?? ''}
                onChange={e => set('driver_rut', e.target.value)}
                placeholder="12345678-9"
                className={INPUT}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Teléfono conductor">
              <input
                type="text"
                value={form.driver_phone ?? ''}
                onChange={e => set('driver_phone', e.target.value)}
                placeholder="+56912345678"
                className={INPUT}
              />
            </Field>
            <Field label="Empresa TT">
              <input
                type="text"
                value={form.transporter_name ?? ''}
                onChange={e => set('transporter_name', e.target.value)}
                placeholder="TransCargo SPA"
                className={INPUT}
              />
            </Field>
          </div>

          {err && (
            <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</p>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-border px-5 py-4 flex items-center gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-500 border border-border rounded-lg hover:bg-gray-50 transition-colors"
          >
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
    </>
  )
}
