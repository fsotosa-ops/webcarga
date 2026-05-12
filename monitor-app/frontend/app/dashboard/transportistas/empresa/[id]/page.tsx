'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  Building2, ChevronRight, Users, Truck, PenLine,
  Check, X, RotateCcw, Plus, Trash2, Loader2,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { transportersApi } from '@/lib/api/transporters'
import type { TransporterProfile } from '@/lib/types'

const ACCOUNT_STAGES = ['Lead', 'Operational']
const EDITOR_ROLES = new Set(['editor', 'admin', 'owner'])

type Tab = 'info' | 'conductores' | 'flota' | 'ramplas'

// ── Inline editable field ─────────────────────────────────────────
function EditableField({
  label,
  value,
  field,
  isProtected,
  canEdit,
  onSave,
  onReset,
  options,
}: {
  label: string
  value: string | null
  field: string
  isProtected: boolean
  canEdit: boolean
  onSave: (field: string, val: string) => Promise<void>
  onReset: (field: string) => Promise<void>
  options?: string[]
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [saving, setSaving] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)

  const handleSave = async () => {
    if (draft === (value ?? '')) { setEditing(false); return }
    setSaving(true)
    setFieldError(null)
    try {
      await onSave(field, draft)
      setEditing(false)
    } catch (e) {
      setFieldError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    setSaving(true)
    setFieldError(null)
    try { await onReset(field) } catch (e) {
      setFieldError(e instanceof Error ? e.message : 'Error')
    } finally { setSaving(false) }
  }

  return (
    <div className="py-3 border-b border-border/60 last:border-0">
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-400 w-32 shrink-0">{label}</span>
        {editing ? (
          <div className="flex items-center gap-2 flex-1">
            {options ? (
              <select
                className="flex-1 text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                autoFocus
              >
                {options.map(o => <option key={o}>{o}</option>)}
              </select>
            ) : (
              <input
                className="flex-1 text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false) }}
                autoFocus
              />
            )}
            <button onClick={handleSave} disabled={saving}
              className="p-1.5 rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-50 transition-colors">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            </button>
            <button onClick={() => { setEditing(false); setFieldError(null) }}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
              <X size={14} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-sm text-text-primary flex-1 truncate">
              {value || <span className="text-gray-300 italic">sin datos</span>}
            </span>
            {isProtected && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-500 shrink-0">
                Protegido
              </span>
            )}
            {canEdit && (
              <button
                onClick={() => { setDraft(value ?? ''); setEditing(true) }}
                title={`Editar ${label}`}
                className="p-1.5 rounded-lg border border-border/60 text-gray-400 hover:text-accent hover:border-accent hover:bg-accent/5 transition-all shrink-0"
              >
                <PenLine size={13} />
              </button>
            )}
            {isProtected && canEdit && (
              <button onClick={handleReset} title="Restaurar control al pipeline"
                className="p-1.5 rounded-lg border border-border/60 text-gray-400 hover:text-amber-500 hover:border-amber-300 transition-all shrink-0">
                {saving ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
              </button>
            )}
          </div>
        )}
      </div>
      {fieldError && (
        <p className="text-xs text-red-500 mt-1 pl-[9.5rem]">{fieldError}</p>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────
export default function EmpresaDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [tp, setTp] = useState<TransporterProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('info')
  const [canEdit, setCanEdit] = useState(false)

  const [addDriverOpen, setAddDriverOpen] = useState(false)
  const [driverForm, setDriverForm] = useState({ rut: '', name: '' })
  const [addVehicleOpen, setAddVehicleOpen] = useState(false)
  const [vehicleForm, setVehicleForm] = useState({ type: '', plate: '' })
  const [addTrailerOpen, setAddTrailerOpen] = useState(false)
  const [trailerForm, setTrailerForm] = useState({ plate: '' })
  const [submitting, setSubmitting] = useState(false)

  // Check user role from Supabase session
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single()
      if (profile && EDITOR_ROLES.has(profile.role)) setCanEdit(true)
    })
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await transportersApi.get(id)
      setTp(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando datos')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  const handleSaveField = async (field: string, value: string) => {
    const updated = await transportersApi.patch(id, { [field]: value })
    setTp(updated)
  }

  const handleResetField = async (field: string) => {
    await transportersApi.resetField(id, field)
    await load()
  }

  const handleAddDriver = async () => {
    if (!driverForm.rut || !driverForm.name) return
    setSubmitting(true)
    try {
      await transportersApi.addDriver(id, driverForm)
      setDriverForm({ rut: '', name: '' })
      setAddDriverOpen(false)
      await load()
    } finally { setSubmitting(false) }
  }

  const handleRemoveDriver = async (did: string) => {
    await transportersApi.removeDriver(id, did)
    await load()
  }

  const handleAddVehicle = async () => {
    if (!vehicleForm.plate) return
    setSubmitting(true)
    try {
      await transportersApi.addVehicle(id, vehicleForm)
      setVehicleForm({ type: '', plate: '' })
      setAddVehicleOpen(false)
      await load()
    } finally { setSubmitting(false) }
  }

  const handleRemoveVehicle = async (vid: string) => {
    await transportersApi.removeVehicle(id, vid)
    await load()
  }

  const handleAddTrailer = async () => {
    if (!trailerForm.plate) return
    setSubmitting(true)
    try {
      await transportersApi.addTrailer(id, trailerForm)
      setTrailerForm({ plate: '' })
      setAddTrailerOpen(false)
      await load()
    } finally { setSubmitting(false) }
  }

  const handleRemoveTrailer = async (trid: string) => {
    await transportersApi.removeTrailer(id, trid)
    await load()
  }

  if (loading) return (
    <div className="p-6 flex items-center gap-2 text-sm text-gray-400">
      <Loader2 size={16} className="animate-spin" /> Cargando…
    </div>
  )

  if (error || !tp) return (
    <div className="p-6 text-sm text-red-500">
      {error ?? 'No encontrado'}
      <Link href="/dashboard/transportistas" className="block mt-2 text-accent hover:underline text-xs">← Volver a Empresas</Link>
    </div>
  )

  const protected_ = new Set(tp.manually_edited_fields)
  const tabs: { id: Tab; label: string }[] = [
    { id: 'info',        label: 'Información' },
    { id: 'conductores', label: `Conductores (${tp.drivers.length})` },
    { id: 'flota',       label: `Flota (${tp.vehicles.length})` },
    { id: 'ramplas',     label: `Ramplas (${tp.trailers.length})` },
  ]

  const stageColor = tp.account_stage === 'Operational'
    ? { bg: '#eef6e6', text: '#62a420' }
    : tp.account_stage === 'Lead'
    ? { bg: '#e8eeff', text: '#053bfa' }
    : null

  return (
    <div className="p-6 space-y-5">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-400">
        <Link href="/dashboard/transportistas" className="hover:text-accent transition-colors">Empresas de Transportes</Link>
        <ChevronRight size={13} />
        <span className="text-text-primary font-medium truncate max-w-xs">{tp.business_name ?? id}</span>
      </nav>

      {/* Header */}
      <div className="bg-white rounded-xl border border-border p-5 flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
          <Building2 size={22} className="text-gray-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-mulish font-bold text-xl text-text-primary">{tp.business_name ?? '—'}</h1>
            {stageColor && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: stageColor.bg, color: stageColor.text }}>
                {tp.account_stage}
              </span>
            )}
            {tp.manually_edited_fields.length > 0 && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-500">
                Editado manualmente
              </span>
            )}
          </div>
          {tp.rut && <p className="text-sm text-gray-400 mt-0.5">RUT: {tp.rut}</p>}
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {tp.admin_id && (
              <span className="text-[10px] text-gray-400 font-mono bg-gray-100 px-2 py-0.5 rounded">
                Admin ID: #{tp.admin_id}
              </span>
            )}
            <span className="text-[10px] text-gray-300 font-mono bg-gray-50 px-2 py-0.5 rounded border border-border/40 select-all" title="Transporter ID (UUID)">
              {tp.id}
            </span>
          </div>
          {!canEdit && (
            <p className="text-[10px] text-gray-300 mt-1">Solo lectura — necesitas rol editor+ para editar</p>
          )}
        </div>
        <div className="grid grid-cols-3 gap-6 shrink-0">
          {[
            { label: 'Conductores', value: tp.drivers.length,  icon: Users },
            { label: 'Vehículos',   value: tp.vehicles.length, icon: Truck },
            { label: 'Ramplas',     value: tp.trailers.length, icon: Truck },
          ].map(({ label, value }) => (
            <div key={label} className="text-center">
              <p className="font-mulish font-bold text-2xl text-text-primary">{value}</p>
              <p className="text-xs text-gray-400">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-border">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id ? 'border-accent text-accent' : 'border-transparent text-gray-500 hover:text-text-primary'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* INFO TAB */}
      {tab === 'info' && (
        <div className="bg-white rounded-xl border border-border p-5">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Datos principales</h2>
          {canEdit && (
            <p className="text-[10px] text-gray-300 mb-3">Haz clic en <PenLine size={10} className="inline" /> para editar un campo</p>
          )}

          {/* Read-only IDs */}
          <div className="py-2.5 border-b border-border/60 flex items-center gap-3">
            <span className="text-xs text-gray-400 w-32 shrink-0">Admin ID</span>
            <span className="text-sm font-mono text-gray-500">{tp.admin_id ?? <span className="text-gray-300 italic">—</span>}</span>
          </div>
          <div className="py-2.5 border-b border-border/60 flex items-center gap-3">
            <span className="text-xs text-gray-400 w-32 shrink-0">Transporter ID</span>
            <span className="text-xs font-mono text-gray-400 select-all break-all">{tp.id}</span>
          </div>

          {(
            [
              { label: 'Razón Social', field: 'business_name', value: tp.business_name },
              { label: 'RUT',          field: 'rut',           value: tp.rut },
              { label: 'Estado',       field: 'account_stage', value: tp.account_stage, options: ACCOUNT_STAGES },
            ] as const
          ).map(f => (
            <EditableField
              key={f.field}
              label={f.label}
              value={f.value ?? null}
              field={f.field}
              isProtected={protected_.has(f.field)}
              canEdit={canEdit}
              onSave={handleSaveField}
              onReset={handleResetField}
              options={'options' in f ? f.options : undefined}
            />
          ))}

          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3 mt-6">Contactabilidad</h2>
          <div className="space-y-2">
            <div>
              <p className="text-xs text-gray-400 mb-1">Emails</p>
              <div className="flex flex-wrap gap-1.5">
                {(tp.contactability?.emails ?? []).length > 0
                  ? tp.contactability!.emails.map(e => (
                      <span key={e} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{e}</span>
                    ))
                  : <span className="text-xs text-gray-300 italic">sin emails</span>
                }
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Teléfonos</p>
              <div className="flex flex-wrap gap-1.5">
                {(tp.contactability?.phones ?? []).length > 0
                  ? tp.contactability!.phones.map(p => (
                      <span key={p} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{p}</span>
                    ))
                  : <span className="text-xs text-gray-300 italic">sin teléfonos</span>
                }
              </div>
            </div>
          </div>

          {tp.edited_at && (
            <p className="text-[10px] text-gray-300 mt-6">
              Última edición manual: {new Date(tp.edited_at).toLocaleString('es-CL')}
            </p>
          )}
        </div>
      )}

      {/* CONDUCTORES TAB */}
      {tab === 'conductores' && (
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Conductores</span>
            {canEdit && (
              <button onClick={() => setAddDriverOpen(v => !v)}
                className="flex items-center gap-1.5 text-xs font-medium text-accent hover:text-accent/80 transition-colors">
                <Plus size={13} /> Agregar
              </button>
            )}
          </div>
          {addDriverOpen && (
            <div className="px-5 py-3 border-b border-border bg-gray-50 flex items-center gap-2">
              <input placeholder="RUT (ej: 12345678-9)" value={driverForm.rut}
                onChange={e => setDriverForm(v => ({ ...v, rut: e.target.value }))}
                className="text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 w-40" />
              <input placeholder="Nombre completo" value={driverForm.name}
                onChange={e => setDriverForm(v => ({ ...v, name: e.target.value }))}
                className="text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 flex-1" />
              <button onClick={handleAddDriver} disabled={submitting || !driverForm.rut || !driverForm.name}
                className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors">
                {submitting ? <Loader2 size={13} className="animate-spin" /> : 'Guardar'}
              </button>
              <button onClick={() => setAddDriverOpen(false)} className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors">
                <X size={14} />
              </button>
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-border">
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Nombre</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">RUT</th>
                {canEdit && <th className="px-5 py-3 w-10" />}
              </tr>
            </thead>
            <tbody>
              {tp.drivers.length === 0 && (
                <tr><td colSpan={3} className="px-5 py-8 text-center text-sm text-gray-300">Sin conductores registrados</td></tr>
              )}
              {tp.drivers.map((d, i) => (
                <tr key={d.id} className={`border-b border-border/60 last:border-0 hover:bg-gray-50 ${i % 2 === 1 ? 'bg-gray-50/30' : ''}`}>
                  <td className="px-5 py-3 font-medium text-text-primary">{d.name}</td>
                  <td className="px-5 py-3 text-gray-500 font-mono text-xs">{d.rut}</td>
                  {canEdit && (
                    <td className="px-5 py-3">
                      <button onClick={() => handleRemoveDriver(d.id)} className="p-1 text-gray-300 hover:text-red-400 transition-colors">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* FLOTA TAB */}
      {tab === 'flota' && (
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Flota</span>
            {canEdit && (
              <button onClick={() => setAddVehicleOpen(v => !v)}
                className="flex items-center gap-1.5 text-xs font-medium text-accent hover:text-accent/80 transition-colors">
                <Plus size={13} /> Agregar
              </button>
            )}
          </div>
          {addVehicleOpen && (
            <div className="px-5 py-3 border-b border-border bg-gray-50 flex items-center gap-2">
              <input placeholder="Tipo (ej: Camión, Semi)" value={vehicleForm.type}
                onChange={e => setVehicleForm(v => ({ ...v, type: e.target.value }))}
                className="text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 w-36" />
              <input placeholder="Patente" value={vehicleForm.plate}
                onChange={e => setVehicleForm(v => ({ ...v, plate: e.target.value }))}
                className="text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 w-28 font-mono uppercase" />
              <button onClick={handleAddVehicle} disabled={submitting || !vehicleForm.plate}
                className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors">
                {submitting ? <Loader2 size={13} className="animate-spin" /> : 'Guardar'}
              </button>
              <button onClick={() => setAddVehicleOpen(false)} className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors">
                <X size={14} />
              </button>
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-border">
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Patente</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Tipo</th>
                {canEdit && <th className="px-5 py-3 w-10" />}
              </tr>
            </thead>
            <tbody>
              {tp.vehicles.length === 0 && (
                <tr><td colSpan={3} className="px-5 py-8 text-center text-sm text-gray-300">Sin vehículos registrados</td></tr>
              )}
              {tp.vehicles.map((v, i) => (
                <tr key={v.id} className={`border-b border-border/60 last:border-0 hover:bg-gray-50 ${i % 2 === 1 ? 'bg-gray-50/30' : ''}`}>
                  <td className="px-5 py-3 font-mono font-semibold text-text-primary">{v.plate}</td>
                  <td className="px-5 py-3 text-gray-500">{v.type || '—'}</td>
                  {canEdit && (
                    <td className="px-5 py-3">
                      <button onClick={() => handleRemoveVehicle(v.id)} className="p-1 text-gray-300 hover:text-red-400 transition-colors">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* RAMPLAS TAB */}
      {tab === 'ramplas' && (
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Ramplas</span>
            {canEdit && (
              <button onClick={() => setAddTrailerOpen(v => !v)}
                className="flex items-center gap-1.5 text-xs font-medium text-accent hover:text-accent/80 transition-colors">
                <Plus size={13} /> Agregar
              </button>
            )}
          </div>
          {addTrailerOpen && (
            <div className="px-5 py-3 border-b border-border bg-gray-50 flex items-center gap-2">
              <input placeholder="Patente" value={trailerForm.plate}
                onChange={e => setTrailerForm({ plate: e.target.value })}
                className="text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 w-32 font-mono uppercase" />
              <button onClick={handleAddTrailer} disabled={submitting || !trailerForm.plate}
                className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors">
                {submitting ? <Loader2 size={13} className="animate-spin" /> : 'Guardar'}
              </button>
              <button onClick={() => setAddTrailerOpen(false)} className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors">
                <X size={14} />
              </button>
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-border">
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Patente</th>
                {canEdit && <th className="px-5 py-3 w-10" />}
              </tr>
            </thead>
            <tbody>
              {tp.trailers.length === 0 && (
                <tr><td colSpan={2} className="px-5 py-8 text-center text-sm text-gray-300">Sin ramplas registradas</td></tr>
              )}
              {tp.trailers.map((t, i) => (
                <tr key={t.id} className={`border-b border-border/60 last:border-0 hover:bg-gray-50 ${i % 2 === 1 ? 'bg-gray-50/30' : ''}`}>
                  <td className="px-5 py-3 font-mono font-semibold text-text-primary">{t.plate}</td>
                  {canEdit && (
                    <td className="px-5 py-3">
                      <button onClick={() => handleRemoveTrailer(t.id)} className="p-1 text-gray-300 hover:text-red-400 transition-colors">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
