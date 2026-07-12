'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  ChevronRight, PenLine, Check, X, RotateCcw,
  Loader2, ShieldCheck, Search,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { transportersApi } from '@/lib/api/transporters'
import type {
  TransporterProfile, TransporterVehicle, TransporterContact,
  DriverGovernance, VehicleGovernance,
} from '@/lib/types'
import { EligibilityDot } from '@/components/dashboard/EligibilityDot'
import { InsuranceSummaryCard } from '@/components/dashboard/InsuranceSummaryCard'
import { TransporterDocumentsPanel } from '@/components/dashboard/TransporterDocumentsPanel'
import { TransporterAlertBanner } from '@/components/dashboard/TransporterAlertBanner'
import { DriverRosterCard } from '@/components/dashboard/DriverRosterCard'
import { VehicleRosterCard } from '@/components/dashboard/VehicleRosterCard'
import { DriverDetailPanel } from '@/components/dashboard/DriverDetailPanel'
import { VehicleDetailPanel } from '@/components/dashboard/VehicleDetailPanel'
import { TransferModal } from '@/components/dashboard/TransferModal'
import { describeEligibility } from '@/lib/utils/eligibility'
import { getDriverAlertStatus, getVehicleAlertStatus } from '@/lib/compliance'
import { vehicleCategory, VEHICLE_CATEGORY_LABELS, type VehicleCategory } from '@/lib/utils/transporterDocs'

const ACCOUNT_STAGES = ['Lead', 'Operational']
const EDITOR_ROLES = new Set(['editor', 'admin', 'owner'])
const ADMIN_ROLES  = new Set(['admin', 'owner'])

const VEHICLE_TYPES = [
  'Tractocamión', 'Camión Rígido', 'Camión Furgón', 'Camión Refrigerado', 'Plataforma', 'Cisterna',
]

// ── Editable field (modal "Editar Datos Empresa") — sin cambios ────
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
              <button
                onClick={() => { setDraft(value ?? ''); setEditing(true) }}
                className="p-1.5 rounded-lg border border-border/60 text-gray-400 hover:text-accent hover:border-accent hover:bg-accent/5 shrink-0"
              >
                <PenLine size={13} />
              </button>
            )}
            {isProtected && canEdit && (
              <button
                onClick={async () => { setSaving(true); try { await onReset(field) } finally { setSaving(false) } }}
                className="p-1.5 rounded-lg border border-border/60 text-gray-400 hover:text-amber-500 hover:border-amber-300 shrink-0"
              >
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

// ── Contactos (app.transporter_contacts) — sin cambios ─────────────
const CONTACT_ROLE_LABELS: Record<TransporterContact['role'], string> = {
  rep_legal:   'Representante legal',
  operacional: 'Operacional',
  finanzas:    'Finanzas',
  documentos:  'Documentos',
}

function ContactsSection({ contacts, tp }: { contacts: TransporterContact[]; tp: TransporterProfile }) {
  const byRole = new Map(contacts.map(c => [c.role, c]))
  return (
    <div className="bg-white rounded-xl border border-border p-4 md:p-5">
      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Contactos</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {(Object.keys(CONTACT_ROLE_LABELS) as TransporterContact['role'][]).map(role => {
          const c = byRole.get(role)
          return (
            <div key={role} className="border border-border/60 rounded-lg p-3">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">{CONTACT_ROLE_LABELS[role]}</p>
              {c?.name || c?.phone || c?.email ? (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-text-primary truncate">{c.name ?? <span className="text-gray-300 italic">sin nombre</span>}</p>
                  {c.phone && (
                    <a href={`tel:${c.phone}`} className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-accent">
                      {c.phone}
                    </a>
                  )}
                  {c.email && (
                    <a href={`mailto:${c.email}`} className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-accent truncate">
                      <span className="truncate">{c.email}</span>
                    </a>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-gray-300 italic">Sin datos</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────
export default function EmpresaDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [tp, setTp]               = useState<TransporterProfile | null>(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [canEdit, setCanEdit]     = useState(false)
  const [canAdmin, setCanAdmin]   = useState(false)
  const [editOpen, setEditOpen]   = useState(false)

  const [selectedDriverId,  setSelectedDriverId]  = useState<string | null>(null)
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)
  const [driverQ,         setDriverQ]         = useState('')
  const [driverAlertOnly, setDriverAlertOnly] = useState(false)
  const [vehicleQ,        setVehicleQ]        = useState('')
  const [vehicleTypeFilter, setVehicleTypeFilter] = useState<VehicleCategory | 'todos'>('todos')
  const [vehicleAlertOnly, setVehicleAlertOnly] = useState(false)

  const [addDriverOpen,  setAddDriverOpen]  = useState(false)
  const [driverForm,     setDriverForm]     = useState({ rut: '', name: '' })
  const [addVehicleOpen, setAddVehicleOpen] = useState(false)
  const [vehicleForm,    setVehicleForm]    = useState({ type: '', plate: '' })
  const [submitting,     setSubmitting]     = useState(false)

  const [transferTarget, setTransferTarget] = useState<
    { kind: 'driver' | 'vehicle'; id: string; label: string } | null
  >(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', session.user.id).single()
      if (profile && EDITOR_ROLES.has(profile.role)) setCanEdit(true)
      if (profile && ADMIN_ROLES.has(profile.role)) setCanAdmin(true)
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
    try {
      await transportersApi.addDriver(id, driverForm)
      setDriverForm({ rut: '', name: '' })
      setAddDriverOpen(false)
      await load()
    } finally { setSubmitting(false) }
  }

  const handlePatchDriver = async (did: string, body: { rut?: string; name?: string; governance?: DriverGovernance }) => {
    const res = await transportersApi.patchDriver(id, did, body)
    setTp(prev => prev ? { ...prev, drivers: prev.drivers.map(d => d.id === did ? res.data : d) } : prev)
  }

  // Sin try/catch propio (a diferencia del page original, donde
  // handleRemoveVehicle/handleRemoveTrailer sí lo tenían): el error ahora
  // se muestra inline dentro del panel de detalle (Tasks 5/6), no
  // reemplazando toda la página — evita que un fallo al eliminar un
  // conductor/equipo borre el resto de la ficha.
  const handleRemoveDriver = async (did: string) => {
    await transportersApi.removeDriver(id, did)
    setSelectedDriverId(null)
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

  const handlePatchVehicle = async (vid: string, body: { type?: string; plate?: string; governance?: VehicleGovernance }) => {
    const res = await transportersApi.patchVehicle(id, vid, body)
    setTp(prev => prev ? { ...prev, vehicles: prev.vehicles.map(v => v.id === vid ? res.data : v) } : prev)
  }

  const handleRemoveVehicle = async (vid: string) => {
    await transportersApi.removeVehicle(id, vid)
    setSelectedVehicleId(null)
    await load()
  }

  const handleRemoveTrailer = async (trid: string) => {
    await transportersApi.removeTrailer(id, trid)
    setSelectedVehicleId(null)
    await load()
  }

  const handleConfirmTransfer = async (toTransporterId: string) => {
    if (!transferTarget) return
    try {
      if (transferTarget.kind === 'driver') {
        await transportersApi.transferDriver(id, transferTarget.id, toTransporterId)
      } else {
        await transportersApi.transferVehicle(id, transferTarget.id, toTransporterId)
      }
      setTransferTarget(null)
      await load()
    } catch (e) {
      // Se relanza para que TransferModal muestre el error junto a la acción
      throw e
    }
  }

  const filteredDrivers = useMemo(() => {
    if (!tp) return []
    return tp.drivers.filter(d => {
      const matchesQ = !driverQ || d.name.toLowerCase().includes(driverQ.toLowerCase()) || d.rut.includes(driverQ)
      const matchesAlert = !driverAlertOnly || getDriverAlertStatus(d) !== 'ok'
      return matchesQ && matchesAlert
    })
  }, [tp, driverQ, driverAlertOnly])

  // Equipos: tractos/camiones/furgones (con gobernanza completa) + ramplas
  // (sin gobernanza en el contrato actual) unificados para el filtro de Tipo.
  const allEquipment = useMemo((): (TransporterVehicle & { isTrailer: boolean })[] => tp ? [
    ...tp.vehicles.map(v => ({ ...v, isTrailer: false })),
    ...tp.trailers.map(t => ({ id: t.id, type: 'Rampla', plate: t.plate, governance: null, isTrailer: true })),
  ] : [], [tp])

  const filteredVehicles = useMemo(() => allEquipment.filter(v => {
    const matchesQ = !vehicleQ ||
      v.plate.toLowerCase().includes(vehicleQ.toLowerCase()) ||
      (v.type ?? '').toLowerCase().includes(vehicleQ.toLowerCase())
    const matchesType = vehicleTypeFilter === 'todos' || vehicleCategory(v.type) === vehicleTypeFilter
    const matchesAlert = !vehicleAlertOnly || v.isTrailer || getVehicleAlertStatus(v) !== 'ok'
    return matchesQ && matchesType && matchesAlert
  }), [allEquipment, vehicleQ, vehicleTypeFilter, vehicleAlertOnly])

  const selectedDriver  = tp?.drivers.find(d => d.id === selectedDriverId) ?? null
  const selectedVehicle = allEquipment.find(v => v.id === selectedVehicleId) ?? null

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

  return (
    <div className="p-4 md:p-6 space-y-5 relative">
      {editOpen && (
        <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setEditOpen(false)} />
      )}

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-400">
        <Link href="/dashboard/transportistas" className="hover:text-accent transition-colors shrink-0">Empresas</Link>
        <ChevronRight size={13} />
        <span className="text-text-primary font-medium truncate">{tp.business_name ?? id}</span>
      </nav>

      {/* Header + Seguros */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4 items-start">
        <div className="bg-white rounded-xl border border-border p-4 md:p-5">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <EligibilityDot
                  eligible={tp.eligibility.eligible}
                  blockingReasons={tp.eligibility.blocking_reasons}
                  compliancePct={tp.eligibility.compliance_pct}
                  size="md"
                />
                <h1 className="font-mulish font-black text-xl md:text-2xl text-text-primary leading-tight">
                  {tp.business_name ?? '—'}
                </h1>
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5 pl-4">
                {describeEligibility(tp.eligibility.eligible, tp.eligibility.blocking_reasons, tp.eligibility.compliance_pct)}
              </p>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                {tp.rut && (
                  <p className="text-xs text-gray-500">
                    RUT: <span className="font-mono text-gray-700 bg-gray-50 px-1.5 py-0.5 rounded border border-border/60">{tp.rut}</span>
                  </p>
                )}
                {tp.account_stage && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                    {tp.account_stage}
                  </span>
                )}
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  tp.in_admin ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'
                }`}>
                  {tp.in_admin ? 'En admin' : 'No registrada en admin'}
                </span>
                {tp.clients.map(c => (
                  <span key={c} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{c}</span>
                ))}
                {tp.eligibility.eligible && (
                  <span className="inline-flex items-center gap-1 text-xs text-green-600 bg-green-50 border border-green-100 rounded-lg px-2 py-0.5">
                    <ShieldCheck size={11} /> Documentación al día
                  </span>
                )}
              </div>
            </div>

            {canEdit && (
              <button
                onClick={() => setEditOpen(true)}
                className="bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-bold transition border border-border shadow-sm shrink-0"
              >
                Editar Empresa
              </button>
            )}
          </div>
        </div>

        <InsuranceSummaryCard transporterId={tp.id} rut={tp.rut} />
      </div>

      <TransporterAlertBanner
        eligible={tp.eligibility.eligible}
        blockingReasons={tp.eligibility.blocking_reasons}
        compliancePct={tp.eligibility.compliance_pct}
      />

      <ContactsSection contacts={tp.contacts} tp={tp} />

      {/* ── Conductores ── */}
      <div className="bg-white rounded-xl border border-border p-4 md:p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Conductores ({tp.drivers.length})</h3>
          {canEdit && (
            <button
              onClick={() => setAddDriverOpen(v => !v)}
              className="text-xs bg-accent hover:bg-accent/90 text-white font-bold px-3 py-1.5 rounded-lg shadow-sm transition"
            >
              + Conductor
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={driverQ}
              onChange={e => setDriverQ(e.target.value)}
              placeholder="Filtrar por nombre o RUT…"
              className="pl-8 pr-4 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/30 w-56 bg-white"
            />
          </div>
          <button
            onClick={() => setDriverAlertOnly(v => !v)}
            aria-pressed={driverAlertOnly}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-all ${
              driverAlertOnly ? 'bg-accent border-accent text-white' : 'text-gray-500 border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            Con alertas
          </button>
        </div>

        {addDriverOpen && (
          <div className="mb-3 p-3 rounded-lg bg-gray-50/80 flex items-center gap-2 flex-wrap">
            <input
              placeholder="RUT"
              value={driverForm.rut}
              onChange={e => setDriverForm(v => ({ ...v, rut: e.target.value }))}
              className="text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 w-32"
            />
            <input
              placeholder="Nombre completo"
              value={driverForm.name}
              onChange={e => setDriverForm(v => ({ ...v, name: e.target.value }))}
              className="text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 flex-1"
            />
            <button
              onClick={handleAddDriver}
              disabled={submitting || !driverForm.rut || !driverForm.name}
              className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50"
            >
              {submitting ? <Loader2 size={13} className="animate-spin" /> : 'Guardar'}
            </button>
            <button onClick={() => setAddDriverOpen(false)} className="p-1.5 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          </div>
        )}

        {filteredDrivers.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-300">
            {driverQ || driverAlertOnly ? 'Sin resultados' : 'Sin conductores registrados'}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {filteredDrivers.map(d => (
              <DriverRosterCard key={d.id} driver={d} onOpen={() => setSelectedDriverId(d.id)} />
            ))}
          </div>
        )}
      </div>

      {/* ── Equipos ── */}
      <div className="bg-white rounded-xl border border-border p-4 md:p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Equipos ({tp.vehicles.length + tp.trailers.length})</h3>
          {canEdit && (
            <button
              onClick={() => setAddVehicleOpen(v => !v)}
              className="text-xs bg-accent hover:bg-accent/90 text-white font-bold px-3 py-1.5 rounded-lg shadow-sm transition"
            >
              + Equipo
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={vehicleQ}
              onChange={e => setVehicleQ(e.target.value)}
              placeholder="Filtrar por patente o tipo…"
              className="pl-8 pr-4 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/30 w-56 bg-white"
            />
          </div>
          <button
            onClick={() => setVehicleTypeFilter('todos')}
            aria-pressed={vehicleTypeFilter === 'todos'}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-all ${
              vehicleTypeFilter === 'todos' ? 'bg-accent border-accent text-white' : 'text-gray-500 border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            Todos
          </button>
          {(Object.keys(VEHICLE_CATEGORY_LABELS) as VehicleCategory[]).map(cat => (
            <button
              key={cat}
              onClick={() => setVehicleTypeFilter(cat)}
              aria-pressed={vehicleTypeFilter === cat}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-all ${
                vehicleTypeFilter === cat ? 'bg-accent border-accent text-white' : 'text-gray-500 border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              {VEHICLE_CATEGORY_LABELS[cat]}
            </button>
          ))}
          <button
            onClick={() => setVehicleAlertOnly(v => !v)}
            aria-pressed={vehicleAlertOnly}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-all ${
              vehicleAlertOnly ? 'bg-accent border-accent text-white' : 'text-gray-500 border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            Con alertas
          </button>
        </div>

        {addVehicleOpen && (
          <div className="mb-3 p-3 rounded-lg bg-gray-50/80 flex items-center gap-2 flex-wrap">
            <select
              value={vehicleForm.type}
              onChange={e => setVehicleForm(v => ({ ...v, type: e.target.value }))}
              className="text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 w-36 bg-white"
            >
              <option value="">Tipo…</option>
              {VEHICLE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input
              placeholder="Patente"
              value={vehicleForm.plate}
              onChange={e => setVehicleForm(v => ({ ...v, plate: e.target.value }))}
              className="text-sm border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 w-24 font-mono uppercase"
            />
            <button
              onClick={handleAddVehicle}
              disabled={submitting || !vehicleForm.plate}
              className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50"
            >
              {submitting ? <Loader2 size={13} className="animate-spin" /> : 'Guardar'}
            </button>
            <button onClick={() => setAddVehicleOpen(false)} className="p-1.5 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          </div>
        )}

        {filteredVehicles.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-300">
            {vehicleQ || vehicleAlertOnly ? 'Sin resultados' : 'Sin equipos registrados'}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {filteredVehicles.map(v => (
              <VehicleRosterCard key={v.id} vehicle={v} onOpen={() => setSelectedVehicleId(v.id)} />
            ))}
          </div>
        )}
      </div>

      {/* ── Documentos de la empresa ── */}
      <div className="bg-white rounded-xl border border-border p-4 md:p-5">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Documentos de la Empresa</h3>
        <TransporterDocumentsPanel
          tid={tp.id}
          documents={tp.documents}
          canEdit={canEdit}
          onDocumentsChange={docs => setTp(prev => prev ? { ...prev, documents: docs } : prev)}
        />
      </div>

      <DriverDetailPanel
        driver={selectedDriver}
        canEdit={canEdit}
        canAdmin={canAdmin}
        onClose={() => setSelectedDriverId(null)}
        onPatch={handlePatchDriver}
        onRemove={() => handleRemoveDriver(selectedDriver!.id)}
        onTransferClick={() => selectedDriver && setTransferTarget({ kind: 'driver', id: selectedDriver.id, label: `conductor ${selectedDriver.name}` })}
      />

      <VehicleDetailPanel
        vehicle={selectedVehicle}
        canEdit={canEdit}
        canAdmin={canAdmin}
        onClose={() => setSelectedVehicleId(null)}
        onPatch={handlePatchVehicle}
        onRemove={() => selectedVehicle!.isTrailer ? handleRemoveTrailer(selectedVehicle!.id) : handleRemoveVehicle(selectedVehicle!.id)}
        onTransferClick={selectedVehicle && !selectedVehicle.isTrailer
          ? () => setTransferTarget({ kind: 'vehicle', id: selectedVehicle.id, label: `equipo ${selectedVehicle.plate}` })
          : undefined}
      />

      {/* ── Edit Slide-Over ── */}
      <div
        className={`fixed inset-y-0 right-0 z-50 w-full sm:w-[440px] bg-white border-l border-border shadow-2xl flex flex-col transition-transform duration-300 ${
          editOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
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
        </div>
      </div>

      <TransferModal
        open={!!transferTarget}
        title={transferTarget ? `Transferir ${transferTarget.label}` : 'Transferir'}
        currentTransporterId={id}
        onClose={() => setTransferTarget(null)}
        onTransfer={handleConfirmTransfer}
      />
    </div>
  )
}
