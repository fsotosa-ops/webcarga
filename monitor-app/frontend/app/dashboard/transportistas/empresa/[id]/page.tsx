'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  ChevronRight, PenLine, Check, X, RotateCcw,
  Plus, Trash2, Loader2,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { transportersApi } from '@/lib/api/transporters'
import type { TransporterProfile } from '@/lib/types'

const ACCOUNT_STAGES = ['Lead', 'Operational']
const EDITOR_ROLES = new Set(['editor', 'admin', 'owner'])

const INITIAL_COLORS = [
  '#0A66C2', '#10b981', '#8b5cf6', '#f59e0b',
  '#ef4444', '#06b6d4', '#64748b', '#e11d48',
]

function getInitialColor(name: string | null) {
  if (!name) return '#64748b'
  return INITIAL_COLORS[name.charCodeAt(0) % INITIAL_COLORS.length]
}

function getInitials(name: string | null) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase()
}

// ── Driver card with inline edit ─────────────────────────────────
function DriverCard({
  driver, canEdit, onPatch, onRemove,
}: {
  driver: { id: string; rut: string; name: string }
  canEdit: boolean
  onPatch: (body: { rut?: string; name?: string }) => Promise<void>
  onRemove: () => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState({ rut: driver.rut, name: driver.name })
  const [saving, setSaving]   = useState(false)
  const [err, setErr]         = useState<string | null>(null)

  const dColor = getInitialColor(driver.name)

  const handleSave = async () => {
    setSaving(true); setErr(null)
    try {
      await onPatch({ rut: draft.rut, name: draft.name })
      setEditing(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setDraft({ rut: driver.rut, name: driver.name })
    setEditing(false)
    setErr(null)
  }

  return (
    <div className="bg-white border border-border rounded-xl p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm text-white shrink-0 mt-0.5"
          style={{ backgroundColor: dColor }}
        >
          {driver.name ? driver.name[0].toUpperCase() : '?'}
        </div>

        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="space-y-2">
              <input
                value={draft.name}
                onChange={e => setDraft(v => ({ ...v, name: e.target.value }))}
                placeholder="Nombre completo"
                className="w-full text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
              <input
                value={draft.rut}
                onChange={e => setDraft(v => ({ ...v, rut: e.target.value }))}
                placeholder="RUT"
                className="w-full text-sm font-mono border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
              {err && <p className="text-xs text-red-500">{err}</p>}
              <div className="flex gap-2">
                <button
                  onClick={handleSave} disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50"
                >
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                  Guardar
                </button>
                <button onClick={handleCancel}
                  className="px-3 py-1.5 rounded-lg border border-border text-xs text-gray-500 hover:bg-gray-50">
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="font-bold text-slate-800 text-sm truncate">{driver.name}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                RUT: <span className="font-mono">{driver.rut}</span>
              </p>
            </>
          )}
        </div>

        {canEdit && !editing && (
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => { setDraft({ rut: driver.rut, name: driver.name }); setEditing(true) }}
              className="p-1.5 rounded-lg border border-border/60 text-gray-400 hover:text-accent hover:border-accent hover:bg-accent/5 transition-all">
              <PenLine size={13} />
            </button>
            <button onClick={onRemove}
              className="p-1.5 text-gray-300 hover:text-red-400 transition-colors">
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Editable field (used inside the info slide-over) ─────────────
function EditableField({
  label, value, field, isProtected, canEdit, onSave, onReset, options,
}: {
  label: string; value: string | null; field: string
  isProtected: boolean; canEdit: boolean
  onSave: (field: string, val: string) => Promise<void>
  onReset: (field: string) => Promise<void>
  options?: string[]
}) {
  const [editing, setEditing]   = useState(false)
  const [draft, setDraft]       = useState(value ?? '')
  const [saving, setSaving]     = useState(false)
  const [fieldErr, setFieldErr] = useState<string | null>(null)

  const handleSave = async () => {
    if (draft === (value ?? '')) { setEditing(false); return }
    setSaving(true); setFieldErr(null)
    try { await onSave(field, draft); setEditing(false) }
    catch (e) { setFieldErr(e instanceof Error ? e.message : 'Error') }
    finally { setSaving(false) }
  }

  const handleReset = async () => {
    setSaving(true); setFieldErr(null)
    try { await onReset(field) }
    catch (e) { setFieldErr(e instanceof Error ? e.message : 'Error') }
    finally { setSaving(false) }
  }

  return (
    <div className="py-3 border-b border-border/60 last:border-0">
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-400 w-32 shrink-0">{label}</span>
        {editing ? (
          <div className="flex items-center gap-2 flex-1">
            {options ? (
              <select className="flex-1 text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30"
                value={draft} onChange={e => setDraft(e.target.value)} autoFocus>
                {options.map(o => <option key={o}>{o}</option>)}
              </select>
            ) : (
              <input className="flex-1 text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30"
                value={draft} onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false) }}
                autoFocus />
            )}
            <button onClick={handleSave} disabled={saving}
              className="p-1.5 rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-50">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            </button>
            <button onClick={() => { setEditing(false); setFieldErr(null) }}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
              <X size={14} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-sm text-text-primary flex-1 truncate">
              {value || <span className="text-gray-300 italic">sin datos</span>}
            </span>
            {isProtected && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-500 shrink-0">Protegido</span>
            )}
            {canEdit && (
              <button onClick={() => { setDraft(value ?? ''); setEditing(true) }}
                className="p-1.5 rounded-lg border border-border/60 text-gray-400 hover:text-accent hover:border-accent hover:bg-accent/5 shrink-0">
                <PenLine size={13} />
              </button>
            )}
            {isProtected && canEdit && (
              <button onClick={handleReset}
                className="p-1.5 rounded-lg border border-border/60 text-gray-400 hover:text-amber-500 hover:border-amber-300 shrink-0">
                {saving ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
              </button>
            )}
          </div>
        )}
      </div>
      {fieldErr && <p className="text-xs text-red-500 mt-1 pl-[9.5rem]">{fieldErr}</p>}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────
export default function EmpresaDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [tp, setTp]         = useState<TransporterProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState<string | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const [addDriverOpen, setAddDriverOpen] = useState(false)
  const [driverForm, setDriverForm] = useState({ rut: '', name: '' })
  const [addVehicleOpen, setAddVehicleOpen] = useState(false)
  const [vehicleForm, setVehicleForm] = useState({ type: '', plate: '' })
  const [addTrailerOpen, setAddTrailerOpen] = useState(false)
  const [trailerForm, setTrailerForm] = useState({ plate: '' })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', session.user.id).single()
      if (profile && EDITOR_ROLES.has(profile.role)) setCanEdit(true)
    })
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setTp(await transportersApi.get(id)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Error cargando datos') }
    finally { setLoading(false) }
  }, [id])

  useEffect(() => { load() }, [load])

  const handleSaveField = async (field: string, value: string) => {
    setTp(await transportersApi.patch(id, { [field]: value }))
  }
  const handleResetField = async (field: string) => {
    await transportersApi.resetField(id, field); await load()
  }
  const handleAddDriver = async () => {
    if (!driverForm.rut || !driverForm.name) return
    setSubmitting(true)
    try { await transportersApi.addDriver(id, driverForm); setDriverForm({ rut: '', name: '' }); setAddDriverOpen(false); await load() }
    finally { setSubmitting(false) }
  }
  const handlePatchDriver = async (did: string, body: { rut?: string; name?: string }) => {
    const res = await transportersApi.patchDriver(id, did, body)
    setTp(prev => prev ? {
      ...prev,
      drivers: prev.drivers.map(d => d.id === did ? res.data : d),
    } : prev)
  }

  const handleRemoveDriver = async (did: string) => {
    await transportersApi.removeDriver(id, did); await load()
  }
  const handleAddVehicle = async () => {
    if (!vehicleForm.plate) return
    setSubmitting(true)
    try { await transportersApi.addVehicle(id, vehicleForm); setVehicleForm({ type: '', plate: '' }); setAddVehicleOpen(false); await load() }
    finally { setSubmitting(false) }
  }
  const handleRemoveVehicle = async (vid: string) => {
    await transportersApi.removeVehicle(id, vid); await load()
  }
  const handleAddTrailer = async () => {
    if (!trailerForm.plate) return
    setSubmitting(true)
    try { await transportersApi.addTrailer(id, trailerForm); setTrailerForm({ plate: '' }); setAddTrailerOpen(false); await load() }
    finally { setSubmitting(false) }
  }
  const handleRemoveTrailer = async (trid: string) => {
    await transportersApi.removeTrailer(id, trid); await load()
  }

  if (loading) return (
    <div className="p-6 flex items-center gap-2 text-sm text-gray-400">
      <Loader2 size={16} className="animate-spin" /> Cargando…
    </div>
  )
  if (error || !tp) return (
    <div className="p-6 text-sm text-red-500">
      {error ?? 'No encontrado'}
      <Link href="/dashboard/transportistas" className="block mt-2 text-accent hover:underline text-xs">← Volver</Link>
    </div>
  )

  const protected_ = new Set(tp.manually_edited_fields)
  const initColor  = getInitialColor(tp.business_name)
  const initials   = getInitials(tp.business_name)

  return (
    <div className="p-4 md:p-6 space-y-5 relative">

      {/* Backdrop for edit panel */}
      {editOpen && (
        <div className="fixed inset-0 bg-black/20 z-40 md:hidden" onClick={() => setEditOpen(false)} />
      )}

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-400">
        <Link href="/dashboard/transportistas" className="hover:text-accent transition-colors shrink-0">Empresas</Link>
        <ChevronRight size={13} />
        <span className="text-text-primary font-medium truncate">{tp.business_name ?? id}</span>
      </nav>

      {/* Company Header */}
      <div className="bg-white rounded-xl border border-border p-4 md:p-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div
              className="w-12 h-12 md:w-14 md:h-14 rounded-xl flex items-center justify-center font-bold text-lg md:text-xl text-white shrink-0 shadow-sm"
              style={{ backgroundColor: initColor }}
            >
              {initials}
            </div>
            <div>
              <h1 className="font-mulish font-black text-xl md:text-2xl text-text-primary leading-tight">
                {tp.business_name ?? '—'}
              </h1>
              {tp.rut && (
                <p className="text-xs text-gray-500 mt-0.5">
                  RUT Empresa: <span className="font-mono text-gray-700 bg-gray-50 px-1 rounded border border-border/60">{tp.rut}</span>
                </p>
              )}
            </div>
          </div>
          {canEdit && (
            <button
              onClick={() => setEditOpen(true)}
              className="md:w-auto w-full bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-bold transition border border-border shadow-sm"
            >
              Editar Datos Empresa
            </button>
          )}
        </div>
      </div>

      {/* 2-column grid: Conductores | Flota */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* ── CONDUCTORES ── */}
        <div className="border border-border rounded-xl overflow-hidden flex flex-col shadow-sm bg-white xl:h-[680px]">
          <div className="bg-gray-50 px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
            <h4 className="font-bold text-slate-800 text-base">
              Conductores ({tp.drivers.length})
            </h4>
            {canEdit && (
              <button
                onClick={() => setAddDriverOpen(v => !v)}
                className="text-xs bg-accent hover:bg-accent/90 text-white font-bold px-3 py-1.5 rounded-lg shadow-sm transition"
              >
                + Nuevo
              </button>
            )}
          </div>

          {addDriverOpen && (
            <div className="px-5 py-3 border-b border-border bg-gray-50/80 flex items-center gap-2 shrink-0">
              <input placeholder="RUT" value={driverForm.rut}
                onChange={e => setDriverForm(v => ({ ...v, rut: e.target.value }))}
                className="text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 w-36" />
              <input placeholder="Nombre completo" value={driverForm.name}
                onChange={e => setDriverForm(v => ({ ...v, name: e.target.value }))}
                className="text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 flex-1" />
              <button onClick={handleAddDriver} disabled={submitting || !driverForm.rut || !driverForm.name}
                className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50">
                {submitting ? <Loader2 size={13} className="animate-spin" /> : 'Guardar'}
              </button>
              <button onClick={() => setAddDriverOpen(false)} className="p-1.5 text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            </div>
          )}

          <div className="p-4 overflow-y-auto flex-1 bg-gray-50/50 space-y-3">
            {tp.drivers.length === 0 && (
              <div className="py-10 text-center text-sm text-gray-300">Sin conductores registrados</div>
            )}
            {tp.drivers.map(d => (
              <DriverCard
                key={d.id}
                driver={d}
                canEdit={canEdit}
                onPatch={(body) => handlePatchDriver(d.id, body)}
                onRemove={() => handleRemoveDriver(d.id)}
              />
            ))}
          </div>
        </div>

        {/* ── FLOTA (Tractos + Ramplas) ── */}
        <div className="border border-border rounded-xl overflow-hidden flex flex-col shadow-sm bg-white xl:h-[680px]">
          <div className="bg-gray-50 px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
            <h4 className="font-bold text-slate-800 text-base">
              Flota ({tp.vehicles.length + tp.trailers.length})
            </h4>
            <div className="flex items-center gap-2">
              {canEdit && (
                <>
                  <button onClick={() => setAddVehicleOpen(v => !v)}
                    className="text-xs bg-accent hover:bg-accent/90 text-white font-bold px-3 py-1.5 rounded-lg shadow-sm transition">
                    + Tracto
                  </button>
                  <button onClick={() => setAddTrailerOpen(v => !v)}
                    className="text-xs bg-white hover:bg-gray-50 text-gray-700 font-bold px-3 py-1.5 rounded-lg shadow-sm transition border border-border">
                    + Rampla
                  </button>
                </>
              )}
            </div>
          </div>

          {addVehicleOpen && (
            <div className="px-5 py-3 border-b border-border bg-gray-50/80 flex items-center gap-2 shrink-0">
              <input placeholder="Tipo (ej: Semi)" value={vehicleForm.type}
                onChange={e => setVehicleForm(v => ({ ...v, type: e.target.value }))}
                className="text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 w-32" />
              <input placeholder="Patente" value={vehicleForm.plate}
                onChange={e => setVehicleForm(v => ({ ...v, plate: e.target.value }))}
                className="text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 w-28 font-mono uppercase" />
              <button onClick={handleAddVehicle} disabled={submitting || !vehicleForm.plate}
                className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50">
                {submitting ? <Loader2 size={13} className="animate-spin" /> : 'Guardar'}
              </button>
              <button onClick={() => setAddVehicleOpen(false)} className="p-1.5 text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            </div>
          )}

          {addTrailerOpen && (
            <div className="px-5 py-3 border-b border-border bg-gray-50/80 flex items-center gap-2 shrink-0">
              <span className="text-xs text-gray-500 shrink-0">Rampla</span>
              <input placeholder="Patente" value={trailerForm.plate}
                onChange={e => setTrailerForm({ plate: e.target.value })}
                className="text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 w-32 font-mono uppercase" />
              <button onClick={handleAddTrailer} disabled={submitting || !trailerForm.plate}
                className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50">
                {submitting ? <Loader2 size={13} className="animate-spin" /> : 'Guardar'}
              </button>
              <button onClick={() => setAddTrailerOpen(false)} className="p-1.5 text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            </div>
          )}

          <div className="p-4 overflow-y-auto flex-1 bg-gray-50/50 space-y-3">
            {tp.vehicles.length === 0 && tp.trailers.length === 0 && (
              <div className="py-10 text-center text-sm text-gray-300">Sin flota registrada</div>
            )}

            {/* Tractos */}
            {tp.vehicles.map(v => (
              <div key={v.id} className="bg-white border border-border rounded-xl p-4 shadow-sm">
                <div className="flex items-start justify-between border-b border-border/60 pb-3 mb-3">
                  <div>
                    <span className="text-[9px] text-gray-400 block uppercase font-bold mb-1">Tracto</span>
                    <span className="text-base font-black bg-slate-800 text-white px-3 py-1 rounded-lg inline-block shadow-sm">
                      {v.plate}
                    </span>
                  </div>
                  {canEdit && (
                    <button onClick={() => handleRemoveVehicle(v.id)}
                      className="p-1.5 text-gray-300 hover:text-red-400 transition-colors mt-1">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
                {v.type && (
                  <div>
                    <span className="text-[9px] text-gray-400 uppercase font-bold">Tipo</span>
                    <span className="ml-2 text-xs text-gray-700 font-medium">{v.type}</span>
                  </div>
                )}
              </div>
            ))}

            {/* Ramplas */}
            {tp.trailers.length > 0 && (
              <div className="pt-1">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 px-1">Ramplas</p>
                <div className="space-y-2">
                  {tp.trailers.map(t => (
                    <div key={t.id} className="bg-white border border-border rounded-xl px-4 py-3 shadow-sm flex items-center justify-between">
                      <div>
                        <span className="text-[9px] text-gray-400 uppercase font-bold block mb-1">Remolque</span>
                        <span className="text-sm font-bold bg-gray-100 border border-border px-3 py-1 rounded-lg text-gray-800 inline-block font-mono">
                          {t.plate}
                        </span>
                      </div>
                      {canEdit && (
                        <button onClick={() => handleRemoveTrailer(t.id)}
                          className="p-1.5 text-gray-300 hover:text-red-400 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Info / Edit Slide-Over ── */}
      <div
        className={`
          fixed md:absolute inset-y-0 right-0 z-50
          w-full sm:w-[440px]
          bg-white border-l border-border shadow-2xl flex flex-col
          transition-transform duration-300
          ${editOpen ? 'translate-x-0' : 'translate-x-full'}
        `}
      >
        <div className="px-5 py-4 bg-slate-900 flex items-center justify-between shrink-0">
          <h3 className="text-base font-bold text-white">Editar Datos Empresa</h3>
          <button onClick={() => setEditOpen(false)} className="text-white/50 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="py-2.5 border-b border-border/60 flex items-center gap-3">
            <span className="text-xs text-gray-400 w-32 shrink-0">Admin ID</span>
            <span className="text-sm font-mono text-gray-500">{tp.admin_id ?? '—'}</span>
          </div>
          <div className="py-2.5 border-b border-border/60 flex items-center gap-3">
            <span className="text-xs text-gray-400 w-32 shrink-0">Transporter ID</span>
            <span className="text-xs font-mono text-gray-400 select-all break-all">{tp.id}</span>
          </div>

          {([
            { label: 'Razón Social', field: 'business_name', value: tp.business_name },
            { label: 'RUT',          field: 'rut',           value: tp.rut },
            { label: 'Estado',       field: 'account_stage', value: tp.account_stage, options: ACCOUNT_STAGES },
          ] as const).map(f => (
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

          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-2">Contactabilidad</h2>
          <div className="space-y-2">
            <div>
              <p className="text-xs text-gray-400 mb-1">Emails</p>
              <div className="flex flex-wrap gap-1.5">
                {(tp.contactability?.emails ?? []).length > 0
                  ? tp.contactability!.emails.map(e => (
                      <span key={e} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{e}</span>
                    ))
                  : <span className="text-xs text-gray-300 italic">sin emails</span>}
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Teléfonos</p>
              <div className="flex flex-wrap gap-1.5">
                {(tp.contactability?.phones ?? []).length > 0
                  ? tp.contactability!.phones.map(p => (
                      <span key={p} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{p}</span>
                    ))
                  : <span className="text-xs text-gray-300 italic">sin teléfonos</span>}
              </div>
            </div>
          </div>

          {tp.edited_at && (
            <p className="text-[10px] text-gray-300 pt-2">
              Última edición: {new Date(tp.edited_at).toLocaleString('es-CL')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
