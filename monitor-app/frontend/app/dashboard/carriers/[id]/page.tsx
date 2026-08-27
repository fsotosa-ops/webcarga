'use client'

import { Suspense, useEffect, useState, useMemo } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronRight, PenLine, Check, X,
  Loader2, Search, Users, Truck, ShieldCheck, FileText,
} from 'lucide-react'
import { useCanEdit } from '@/hooks/useCanEdit'
import { useCanAdmin } from '@/hooks/useCanAdmin'
import { carriersApi } from '@/lib/api/carriers'
import { driversApi, type DriverPatchBody } from '@/lib/api/drivers'
import { assetsApi, type AssetPatchBody, type AssetType } from '@/lib/api/assets'
import { contactsApi } from '@/lib/api/contacts'
import type { Driver, Asset, OperationalStatus, ComplianceHealth } from '@/lib/types'
import { AlertStatTiles } from '@/components/dashboard/AlertStatTiles'
import { ContactCard, AddContactForm } from '@/components/dashboard/ContactCard'
import { InsuranceSummaryCard } from '@/components/dashboard/InsuranceSummaryCard'
import { CarrierDocumentsTab } from '@/components/dashboard/carriers/CarrierDocumentsTab'
import { DriverRosterCard } from '@/components/dashboard/DriverRosterCard'
import { VehicleRosterCard } from '@/components/dashboard/VehicleRosterCard'
import { DriverDetailPanel } from '@/components/dashboard/DriverDetailPanel'
import { VehicleDetailPanel } from '@/components/dashboard/VehicleDetailPanel'
import { TransferModal } from '@/components/dashboard/TransferModal'
import { AltaDeFlota } from '@/components/dashboard/AltaDeFlota'
import { BajaReasonModal } from '@/components/dashboard/BajaReasonModal'
import { DeleteCarrierModal } from '@/components/dashboard/DeleteCarrierModal'
import { InsurancePolicyModal, PolicyCreateForm, type PolicyFormState } from '@/components/dashboard/InsurancePolicyModal'
import { CompletionRing } from '@/components/dashboard/CompletionRing'
import { checklistCompletion } from '@/components/dashboard/DocumentChecklist'
import { complianceRecordsToChecklistItems } from '@/lib/utils/complianceChecklist'
import { expiryRelative, updatedRelative } from '@/lib/compliance'

const ROSTER_PAGE_SIZE = 9

type Tab = 'resumen' | 'documentos' | 'conductores' | 'equipos' | 'seguros' | 'contactos'

const OPERATIONAL_STATUS_OPTIONS: OperationalStatus[] = ['ACTIVE', 'INACTIVE', 'LEGACY_INACTIVE']
const ASSET_TYPE_OPTIONS: { value: AssetType; label: string }[] = [
  { value: 'TRACTOCAMION', label: 'Tracto' }, { value: 'RAMPLA', label: 'Rampla' },
]
const CONTACT_ROLE_OPTIONS = ['LEGAL_REP', 'OPERATIONS', 'FINANCE', 'DOCUMENTS']

// ── Campo editable de la empresa (solo business_name/operational_status
//    aceptan PATCH — ver schemas/carrier.py). Sin "revertir a valor del
//    pipeline": el modelo nuevo no tiene un un-override explícito, solo
//    is_manual_override a nivel de fila completa (H1.6). ──────────────
function EditableField({
  label, value, canEdit, onSave, options,
}: {
  label: string; value: string; canEdit: boolean
  onSave: (val: string) => Promise<void>
  options?: string[]
}) {
  const [editing, setEditing]   = useState(false)
  const [draft, setDraft]       = useState(value)
  const [saving, setSaving]     = useState(false)
  const [fieldErr, setFieldErr] = useState<string | null>(null)

  const handleSave = async () => {
    if (draft === value) { setEditing(false); return }
    setSaving(true); setFieldErr(null)
    try { await onSave(draft); setEditing(false) }
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
            {canEdit && (
              <button
                onClick={() => { setDraft(value); setEditing(true) }}
                className="p-1.5 rounded-lg border border-border/60 text-gray-400 hover:text-accent hover:border-accent hover:bg-accent/5 shrink-0"
              >
                <PenLine size={13} />
              </button>
            )}
          </div>
        )}
      </div>
      {fieldErr && <p className="text-xs text-red-500 mt-1 pl-[9.5rem]">{fieldErr}</p>}
    </div>
  )
}

export default function EmpresaDetailPage() {
  return (
    <Suspense fallback={null}>
      <EmpresaDetailPageInner />
    </Suspense>
  )
}

/** Ronda 43 (Hallazgo F): recibe driver_name/tractor_plate de la landing de
 *  Empresas (handleAddCarrier) cuando la empresa se creó desde el flujo
 *  guiado de "Sin identificar" — pre-carga y abre "+ Conductor"/"+ Equipo"
 *  directo, sin que el usuario tenga que re-tipear lo que ya reportó el TMS. */
function EmpresaDetailPageInner() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const handoffDriverName   = searchParams.get('driver_name')
  const handoffTractorPlate = searchParams.get('tractor_plate')
  const requestedTab        = searchParams.get('tab') as Tab | null
  // Deep-link desde Certificación: abre directo el panel de ese conductor o
  // vehículo, que es donde se carga su documentación.
  const requestedDriverId   = searchParams.get('driver')
  const requestedAssetId    = searchParams.get('asset')
  const canEdit = useCanEdit()
  const canAdmin = useCanAdmin()
  const [editOpen, setEditOpen]   = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>(
    requestedTab ?? (handoffDriverName ? 'conductores' : handoffTractorPlate ? 'equipos' : 'resumen'),
  )
  const [exportingDocs, setExportingDocs] = useState(false)
  const [exportErr, setExportErr]         = useState<string | null>(null)

  const [selectedDriverId,  setSelectedDriverId]  = useState<string | null>(requestedDriverId)
  const [selectedAssetId,   setSelectedAssetId]   = useState<string | null>(requestedAssetId)
  const [driverQ,  setDriverQ]  = useState('')
  const [driverHealthFilter, setDriverHealthFilter] = useState<ComplianceHealth | ''>('')
  const [driverShowAll, setDriverShowAll] = useState(false)
  const [assetQ,   setAssetQ]   = useState('')
  const [assetTypeFilter, setAssetTypeFilter] = useState<AssetType | 'todos'>('todos')
  const [assetHealthFilter, setAssetHealthFilter] = useState<ComplianceHealth | ''>('')
  const [assetShowAll, setAssetShowAll] = useState(false)

  const [addDriverOpen,  setAddDriverOpen]  = useState(!!handoffDriverName)
  const [addAssetOpen,   setAddAssetOpen]   = useState(!!handoffTractorPlate)
  /** Los dos catálogos de clasificación de vehículos. Sólo se piden cuando el
   *  formulario de alta está abierto: son datos de un caso puntual, no de la
   *  ficha. */

  const [addPolicyOpen,  setAddPolicyOpen]  = useState(false)
  const [policyForm,     setPolicyForm]     = useState<PolicyFormState>({
    insurance_company: '', policy_number: '', valid_from: '', valid_to: '', expiration_alert_days: '30',
    has_endorsement: false, endorsement_number: '',
  })
  const [submitting,     setSubmitting]     = useState(false)

  const [transferTarget, setTransferTarget] = useState<{ kind: 'driver' | 'asset'; id: string; label: string } | null>(null)
  const [bajaModalOpen, setBajaModalOpen] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null)


  const carrierQuery = useQuery({ queryKey: ['carrier-detail', id], queryFn: () => carriersApi.get(id) })

  // La propuesta de gestión a partir de lo que la empresa declaró se fue con
  // el formulario a `AltaDeFlota` (2026-08-27), junto con los catálogos de
  // subtipo y gestión: viven donde se usan, y así las dos pantallas que dan de
  // alta se comportan igual sin que nadie tenga que acordarse de las dos.

  const driversQuery = useQuery({ queryKey: ['carrier-drivers', id], queryFn: () => carriersApi.listDrivers(id) })
  const assetsQuery  = useQuery({ queryKey: ['carrier-assets-roster', id], queryFn: () => carriersApi.listAssets(id) })
  const policiesQuery = useQuery({ queryKey: ['carrier-policies', id], queryFn: () => carriersApi.listPolicies(id) })
  const shippersQuery = useQuery({ queryKey: ['carrier-shippers', id], queryFn: () => carriersApi.listShippers(id) })

  const selectedDriverQuery = useQuery({
    queryKey: ['driver-detail', selectedDriverId],
    queryFn: () => driversApi.get(selectedDriverId!),
    enabled: !!selectedDriverId,
  })
  const selectedAssetQuery = useQuery({
    queryKey: ['asset-detail', selectedAssetId],
    queryFn: () => assetsApi.get(selectedAssetId!),
    enabled: !!selectedAssetId,
  })

  const carrier = carrierQuery.data
  const drivers = driversQuery.data ?? []
  const assets  = assetsQuery.data ?? []
  const policies = policiesQuery.data ?? []

  function invalidateCarrier() { queryClient.invalidateQueries({ queryKey: ['carrier-detail', id] }) }
  function invalidateDrivers() { queryClient.invalidateQueries({ queryKey: ['carrier-drivers', id] }) }
  function invalidateAssets()  { queryClient.invalidateQueries({ queryKey: ['carrier-assets-roster', id] }) }
  function invalidatePolicies(){ queryClient.invalidateQueries({ queryKey: ['carrier-policies', id] }) }

  async function handleSaveBusinessName(value: string) {
    await carriersApi.patch(id, { business_name: value })
    invalidateCarrier()
  }
  async function handleChangeOperationalStatus(value: string) {
    await carriersApi.patch(id, { operational_status: value as OperationalStatus })
    invalidateCarrier()
  }
  async function handleDeactivateCarrier() {
    await carriersApi.patch(id, { operational_status: 'INACTIVE' })
    invalidateCarrier()
  }
  async function handleReactivateCarrier() {
    await carriersApi.patch(id, { operational_status: 'ACTIVE' })
    invalidateCarrier()
  }
  async function handleDeleteCarrier() {
    await carriersApi.delete(id)
    router.push('/dashboard/carriers')
  }

  async function handlePatchDriver(driverId: string, body: DriverPatchBody) {
    await driversApi.patch(driverId, body)
    queryClient.invalidateQueries({ queryKey: ['driver-detail', driverId] })
    invalidateDrivers()
  }
  async function handleRemoveDriver(driverId: string) {
    await carriersApi.unassignDriver(id, driverId)
    setSelectedDriverId(null)
    invalidateDrivers()
  }

  async function handlePatchAsset(assetId: string, body: AssetPatchBody) {
    await assetsApi.patch(assetId, body)
    queryClient.invalidateQueries({ queryKey: ['asset-detail', assetId] })
    invalidateAssets()
  }
  async function handleRemoveAsset(assetId: string) {
    await carriersApi.unassignAsset(id, assetId)
    setSelectedAssetId(null)
    invalidateAssets()
  }

  async function handleConfirmTransfer(toCarrierId: string) {
    if (!transferTarget) return
    if (transferTarget.kind === 'driver') {
      await carriersApi.assignDriver(toCarrierId, transferTarget.id)
      setSelectedDriverId(null)
      invalidateDrivers()
    } else {
      await carriersApi.assignAsset(toCarrierId, transferTarget.id)
      setSelectedAssetId(null)
      invalidateAssets()
    }
    setTransferTarget(null)
  }

  async function handleAddPolicy() {
    if (!policyForm.insurance_company) return
    setSubmitting(true)
    try {
      await carriersApi.createPolicy(id, {
        insurance_company: policyForm.insurance_company,
        policy_number: policyForm.policy_number || undefined,
        valid_from: policyForm.valid_from || undefined,
        valid_to: policyForm.valid_to || undefined,
        expiration_alert_days: policyForm.expiration_alert_days ? Number(policyForm.expiration_alert_days) : undefined,
        has_endorsement: policyForm.has_endorsement,
        endorsement_number: policyForm.endorsement_number || undefined,
      })
      setPolicyForm({
        insurance_company: '', policy_number: '', valid_from: '', valid_to: '', expiration_alert_days: '30',
        has_endorsement: false, endorsement_number: '',
      })
      setAddPolicyOpen(false)
      invalidatePolicies()
    } finally { setSubmitting(false) }
  }

  async function handleSaveContact(contactId: string, patch: { first_name?: string; last_name?: string; phone?: string; email?: string }) {
    await contactsApi.patch(contactId, patch)
    invalidateCarrier()
  }
  async function handleDeleteContact(contactId: string) {
    await contactsApi.delete(contactId)
    invalidateCarrier()
  }
  async function handleAddContact(body: { contact_role: string; first_name?: string; last_name?: string; phone?: string; email?: string }) {
    await carriersApi.createContact(id, body)
    invalidateCarrier()
  }

  // HU-08 (Fase 0): export en bloque de documentos — pedido de Fabián en la
  // reunión del 20/07 ("¿puedo bajar toda esta documentación de una vez?").
  async function handleExportDocuments() {
    setExportingDocs(true); setExportErr(null)
    try {
      const blob = await carriersApi.exportDocuments(id)
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = `${carrier?.business_name ?? 'empresa'}_documentos.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(objectUrl)
    } catch (e) {
      setExportErr(e instanceof Error ? e.message : 'No se pudo exportar la documentación')
    } finally {
      setExportingDocs(false)
    }
  }

  const driverFacets = useMemo(() => ({
    '': drivers.length,
    PENDING: drivers.filter(d => d.compliance_health === 'PENDING').length,
    OK: drivers.filter(d => d.compliance_health === 'OK').length,
  }), [drivers])

  const assetFacets = useMemo(() => ({
    '': assets.length,
    PENDING: assets.filter(a => a.compliance_health === 'PENDING').length,
    OK: assets.filter(a => a.compliance_health === 'OK').length,
  }), [assets])

  const filteredDrivers = useMemo(() => drivers.filter(d => {
    const matchesQ = !driverQ || d.full_name.toLowerCase().includes(driverQ.toLowerCase()) || d.tax_id.includes(driverQ)
    const matchesHealth = !driverHealthFilter || d.compliance_health === driverHealthFilter
    return matchesQ && matchesHealth
  }), [drivers, driverQ, driverHealthFilter])

  const filteredAssets = useMemo(() => assets.filter(a => {
    const matchesQ = !assetQ || a.license_plate.toLowerCase().includes(assetQ.toLowerCase())
    const matchesType = assetTypeFilter === 'todos' || a.asset_type === assetTypeFilter
    const matchesHealth = !assetHealthFilter || a.compliance_health === assetHealthFilter
    return matchesQ && matchesType && matchesHealth
  }), [assets, assetQ, assetTypeFilter, assetHealthFilter])

  useEffect(() => { setDriverShowAll(false) }, [driverQ, driverHealthFilter])
  useEffect(() => { setAssetShowAll(false) }, [assetQ, assetTypeFilter, assetHealthFilter])

  const visibleDrivers = driverShowAll ? filteredDrivers : filteredDrivers.slice(0, ROSTER_PAGE_SIZE)
  const visibleAssets  = assetShowAll  ? filteredAssets  : filteredAssets.slice(0, ROSTER_PAGE_SIZE)

  // Resumen: score de documentación + top de problemas obligatorios (el
  // detalle completo vive en la tab Documentos, no acá — evita el banner
  // saturado que listaba los 12+ items de una).
  const complianceRecords = carrier?.compliance_records ?? []
  const checklistItems = useMemo(() => complianceRecordsToChecklistItems(complianceRecords), [complianceRecords])
  const { ok: docsOk, total: docsTotal } = checklistCompletion(checklistItems)
  const mandatoryProblems = useMemo(() => complianceRecords.filter(r =>
    r.requirement_level === 'LEGAL_MANDATORY'
    && (r.is_expired || r.status === 'MISSING' || r.status === 'EXPIRED' || r.status === 'REJECTED'),
  ), [complianceRecords])

  const selectedDriver: Driver | null = selectedDriverId ? selectedDriverQuery.data ?? null : null
  const selectedAsset:  Asset  | null = selectedAssetId  ? selectedAssetQuery.data  ?? null : null

  if (carrierQuery.isPending) return (
    <div className="p-6 flex items-center gap-2 text-sm text-gray-400">
      <Loader2 size={16} className="animate-spin" /> Cargando…
    </div>
  )
  if (carrierQuery.error || !carrier) return (
    <div className="p-6 text-sm text-red-500">
      {carrierQuery.error instanceof Error ? carrierQuery.error.message : 'No encontrado'}
      <a href="/dashboard/carriers" className="block mt-2 text-accent hover:underline text-xs">← Volver</a>
    </div>
  )

  return (
    <div className="p-4 md:p-6 space-y-5 relative">
      {editOpen && (
        <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setEditOpen(false)} />
      )}

      <nav className="flex items-center gap-1.5 text-sm text-gray-400">
        <a href="/dashboard/carriers" className="hover:text-accent transition-colors shrink-0">Empresas</a>
        <ChevronRight size={13} />
        <span className="text-text-primary font-medium truncate">{carrier.business_name || id}</span>
      </nav>

      <div className="bg-white rounded-xl border border-border p-4 md:p-5">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="font-mulish font-black text-xl md:text-2xl text-text-primary leading-tight">
                {carrier.business_name || '—'}
              </h1>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <p className="text-xs text-gray-500">
                  Tax ID: <span className="font-mono text-gray-700 bg-gray-50 px-1.5 py-0.5 rounded border border-border/60">{carrier.tax_id}</span>
                </p>
                {carrier.legacy_admin_id && (
                  <p className="text-xs text-gray-500">
                    ID legacy admin: <span className="font-mono text-gray-700 bg-gray-50 px-1.5 py-0.5 rounded border border-border/60">{carrier.legacy_admin_id}</span>
                  </p>
                )}
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                  {carrier.operational_status}
                </span>
                {carrier.is_manual_override && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-500">Editado manualmente</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {shippersQuery.data?.map(s => (
                  <span key={s.id} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                    {s.name}
                  </span>
                ))}
                {shippersQuery.data?.length === 0 && (
                  <span className="text-[10px] text-gray-300 italic">Sin generador de carga vinculado</span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {canEdit && (
                <button
                  onClick={() => setEditOpen(true)}
                  className="bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-bold transition border border-border shadow-sm shrink-0"
                >
                  Editar Empresa
                </button>
              )}
              {canAdmin && (
                <button
                  onClick={() => carrier.operational_status !== 'ACTIVE' ? handleReactivateCarrier() : setBajaModalOpen(true)}
                  className={`px-4 py-2 rounded-lg text-sm font-bold transition border shadow-sm shrink-0 ${
                    carrier.operational_status !== 'ACTIVE'
                      ? 'bg-white hover:bg-gray-50 text-gray-700 border-border'
                      : 'bg-white hover:bg-red-50 text-red-500 border-red-200'
                  }`}
                >
                  {carrier.operational_status !== 'ACTIVE' ? 'Reactivar' : 'Dar de baja'}
                </button>
              )}
              {canAdmin && (
                <button
                  onClick={() => setDeleteModalOpen(true)}
                  className="bg-white hover:bg-red-50 text-red-600 px-4 py-2 rounded-lg text-sm font-bold transition border border-red-200 shadow-sm shrink-0"
                >
                  Eliminar
                </button>
              )}
            </div>
        </div>
      </div>

      {/* ── Tabs — una sección visible a la vez, cero scroll entre ellas ── */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit max-w-full overflow-x-auto">
        {([
          { id: 'resumen' as const,     label: 'Resumen',     icon: FileText,    count: null },
          { id: 'documentos' as const,  label: 'Documentos',  icon: FileText,    count: mandatoryProblems.length || null },
          { id: 'conductores' as const, label: 'Conductores', icon: Users,       count: drivers.length },
          { id: 'equipos' as const,     label: 'Equipos',     icon: Truck,       count: assets.length },
          { id: 'seguros' as const,     label: 'Seguros',     icon: ShieldCheck, count: policies.length },
          { id: 'contactos' as const,   label: 'Contactos',   icon: Users,       count: carrier.contacts.length },
        ]).map(t => {
          const active = activeTab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              aria-pressed={active}
              className={`shrink-0 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                active ? 'bg-white text-text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
              {t.count != null && (
                <span className={`ml-1.5 ${t.id === 'documentos' ? 'text-red-500 font-bold' : 'text-gray-400'}`}>{t.count}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Resumen: vista compacta, sin la lista completa de alertas ── */}
      {activeTab === 'resumen' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-border p-4 md:p-5">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Documentación</h3>
            <div className="flex items-center gap-3">
              <CompletionRing ok={docsOk} total={docsTotal} />
              <div>
                <p className="text-sm font-semibold text-text-primary">{docsOk} de {docsTotal} al día</p>
                {mandatoryProblems.length > 0 ? (
                  <p className="text-xs text-red-500 font-semibold">{mandatoryProblems.length} obligatorio{mandatoryProblems.length > 1 ? 's' : ''} pendiente{mandatoryProblems.length > 1 ? 's' : ''}</p>
                ) : (
                  <p className="text-xs text-green-600 font-semibold">Sin pendientes obligatorios</p>
                )}
              </div>
            </div>
            {mandatoryProblems.length > 0 && (
              <ul className="mt-3 space-y-1">
                {mandatoryProblems.slice(0, 3).map(r => {
                  const relative = expiryRelative(r.expiration_date, r.is_expired) ?? updatedRelative(r.updated_at)
                  return (
                    <li key={r.id} className="text-xs text-gray-500 truncate">
                      • {r.name}{relative && <span className="text-gray-400"> · {relative}</span>}
                    </li>
                  )
                })}
              </ul>
            )}
            <button onClick={() => setActiveTab('documentos')} className="mt-3 text-xs font-semibold text-accent hover:underline">
              Ver documentos →
            </button>
          </div>

          <InsuranceSummaryCard carrierId={carrier.id} taxId={carrier.tax_id} />

          <button
            onClick={() => setActiveTab('conductores')}
            className="bg-white rounded-xl border border-border p-4 md:p-5 flex items-center justify-between text-left hover:border-gray-300 transition-colors"
          >
            <div>
              <p className="text-2xl font-bold text-text-primary leading-none">{drivers.length}</p>
              <p className="text-xs text-gray-400 mt-1">Conductores</p>
            </div>
            <Users size={22} className="text-gray-300" />
          </button>

          <button
            onClick={() => setActiveTab('equipos')}
            className="bg-white rounded-xl border border-border p-4 md:p-5 flex items-center justify-between text-left hover:border-gray-300 transition-colors"
          >
            <div>
              <p className="text-2xl font-bold text-text-primary leading-none">{assets.length}</p>
              <p className="text-xs text-gray-400 mt-1">Equipos</p>
            </div>
            <Truck size={22} className="text-gray-300" />
          </button>
        </div>
      )}

      {/* ── Documentos ── */}
      {activeTab === 'documentos' && (
        <CarrierDocumentsTab
          carrierId={id}
          carrierName={carrier.business_name}
          records={carrier.compliance_records}
          onExport={handleExportDocuments}
          exporting={exportingDocs}
          exportError={exportErr}
        />
      )}

      {/* ── Contactos ── */}
      {activeTab === 'contactos' && (
      <div className="bg-white rounded-xl border border-border p-4 md:p-5">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Contactos</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {carrier.contacts.map(c => (
            <ContactCard
              key={c.id}
              contact={c}
              canEdit={canEdit}
              onSaved={patch => handleSaveContact(c.id, patch)}
              onDeleted={() => handleDeleteContact(c.id)}
            />
          ))}
          {canEdit && <AddContactForm roleOptions={CONTACT_ROLE_OPTIONS} onAdd={handleAddContact} />}
          {carrier.contacts.length === 0 && !canEdit && (
            <p className="text-xs text-gray-300 italic">Sin contactos registrados</p>
          )}
        </div>
      </div>
      )}

      {/* ── Conductores ── */}
      {activeTab === 'conductores' && (
      <div className="bg-white rounded-xl border border-border p-4 md:p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Conductores ({drivers.length})</h3>
          {canEdit && (
            <button
              onClick={() => setAddDriverOpen(v => !v)}
              className="text-xs bg-accent hover:bg-accent/90 text-white font-bold px-3 py-1.5 rounded-lg shadow-sm transition"
            >
              + Conductor
            </button>
          )}
        </div>

        <div className="mb-3 max-w-md">
          <AlertStatTiles
            tiles={[
              { id: '', label: 'Todos', value: driverFacets[''], tone: 'neutral' },
              { id: 'PENDING', label: 'Pendientes', value: driverFacets.PENDING, tone: 'danger' },
              { id: 'OK', label: 'Al día', value: driverFacets.OK, tone: 'success' },
            ]}
            active={driverHealthFilter}
            onSelect={id => setDriverHealthFilter(id as ComplianceHealth | '')}
          />
        </div>

        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={driverQ}
              onChange={e => setDriverQ(e.target.value)}
              placeholder="Filtrar por nombre o tax_id…"
              className="pl-8 pr-4 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/30 w-56 bg-white"
            />
          </div>
        </div>

        {/* El formulario ya no vive escrito acá: lo comparte con la ficha de
            Certificación (`AltaDeFlota`), que es donde la minuta del 25/08 lo
            pedía y donde no existía. Dos copias del mismo formulario es la
            forma en que un arreglo así vuelve: se agrega un campo en una y la
            otra se queda corta sin que nada avise. El botón "+ Conductor" de
            la cabecera sigue siendo el disparador — modo controlado. */}
        {addDriverOpen && (
          <div className="mb-3">
            <AltaDeFlota
              carrierId={id}
              tipo="conductor"
              prefill={handoffDriverName ?? undefined}
              abierto={addDriverOpen}
              onAbiertoChange={setAddDriverOpen}
              onCreado={invalidateDrivers}
            />
          </div>
        )}

        {filteredDrivers.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-300">
            {driverQ ? 'Sin resultados' : 'Sin conductores registrados'}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {visibleDrivers.map(d => (
                <DriverRosterCard key={d.id} driver={d} onOpen={() => setSelectedDriverId(d.id)} />
              ))}
            </div>
            {!driverShowAll && filteredDrivers.length > ROSTER_PAGE_SIZE && (
              <button
                onClick={() => setDriverShowAll(true)}
                className="mt-3 w-full text-xs font-semibold text-accent border border-dashed border-accent/40 hover:bg-accent/5 rounded-lg py-2.5 transition-colors"
              >
                Mostrar los {filteredDrivers.length - ROSTER_PAGE_SIZE} restantes
              </button>
            )}
          </>
        )}
      </div>
      )}

      {/* ── Equipos ── */}
      {activeTab === 'equipos' && (
      <div className="bg-white rounded-xl border border-border p-4 md:p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Equipos ({assets.length})</h3>
          {canEdit && (
            <button
              onClick={() => setAddAssetOpen(v => !v)}
              className="text-xs bg-accent hover:bg-accent/90 text-white font-bold px-3 py-1.5 rounded-lg shadow-sm transition"
            >
              + Equipo
            </button>
          )}
        </div>

        <div className="mb-3 max-w-md">
          <AlertStatTiles
            tiles={[
              { id: '', label: 'Todos', value: assetFacets[''], tone: 'neutral' },
              { id: 'PENDING', label: 'Pendientes', value: assetFacets.PENDING, tone: 'danger' },
              { id: 'OK', label: 'Al día', value: assetFacets.OK, tone: 'success' },
            ]}
            active={assetHealthFilter}
            onSelect={id => setAssetHealthFilter(id as ComplianceHealth | '')}
          />
        </div>

        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={assetQ}
              onChange={e => setAssetQ(e.target.value)}
              placeholder="Filtrar por patente…"
              className="pl-8 pr-4 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/30 w-56 bg-white"
            />
          </div>
          <button
            onClick={() => setAssetTypeFilter('todos')}
            aria-pressed={assetTypeFilter === 'todos'}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-all ${
              assetTypeFilter === 'todos' ? 'bg-accent border-accent text-white' : 'text-gray-500 border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            Todos
          </button>
          {ASSET_TYPE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setAssetTypeFilter(opt.value)}
              aria-pressed={assetTypeFilter === opt.value}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-all ${
                assetTypeFilter === opt.value ? 'bg-accent border-accent text-white' : 'text-gray-500 border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {addAssetOpen && (
          <div className="mb-3">
            <AltaDeFlota
              carrierId={id}
              tipo="equipo"
              gestionesDeclaradas={carrierQuery.data?.management_types}
              prefill={handoffTractorPlate ?? undefined}
              abierto={addAssetOpen}
              onAbiertoChange={setAddAssetOpen}
              onCreado={invalidateAssets}
            />
          </div>
        )}

        {filteredAssets.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-300">
            {assetQ || assetTypeFilter !== 'todos' ? 'Sin resultados' : 'Sin equipos registrados'}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {visibleAssets.map(a => (
                <VehicleRosterCard key={a.id} vehicle={a} onOpen={() => setSelectedAssetId(a.id)} />
              ))}
            </div>
            {!assetShowAll && filteredAssets.length > ROSTER_PAGE_SIZE && (
              <button
                onClick={() => setAssetShowAll(true)}
                className="mt-3 w-full text-xs font-semibold text-accent border border-dashed border-accent/40 hover:bg-accent/5 rounded-lg py-2.5 transition-colors"
              >
                Mostrar los {filteredAssets.length - ROSTER_PAGE_SIZE} restantes
              </button>
            )}
          </>
        )}
      </div>
      )}

      {/* ── Pólizas de seguro ── */}
      {activeTab === 'seguros' && (
      <div className="bg-white rounded-xl border border-border p-4 md:p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Pólizas ({policies.length})</h3>
          <div className="flex items-center gap-3">
            <Link
              href={`/dashboard/insurance?q=${encodeURIComponent(carrier.tax_id)}`}
              className="text-xs font-semibold text-accent hover:underline"
            >
              Ver en Seguros →
            </Link>
            {canEdit && (
              <button
                onClick={() => setAddPolicyOpen(v => !v)}
                className="text-xs bg-accent hover:bg-accent/90 text-white font-bold px-3 py-1.5 rounded-lg shadow-sm transition"
              >
                + Póliza
              </button>
            )}
          </div>
        </div>

        {addPolicyOpen && (
          <div className="mb-3 p-3 rounded-lg bg-gray-50/80 max-w-sm">
            <PolicyCreateForm
              form={policyForm}
              onChange={setPolicyForm}
              onSubmit={handleAddPolicy}
              onCancel={() => setAddPolicyOpen(false)}
              submitting={submitting}
              compact
            />
          </div>
        )}

        {policies.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-300">Sin pólizas registradas</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {policies.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedPolicyId(p.id)}
                className="flex items-center justify-between border border-border rounded-xl px-3 py-2.5 text-left hover:border-gray-300 hover:shadow-sm transition-all bg-white"
              >
                <div className="min-w-0">
                  <p className="text-xs font-bold text-text-primary truncate">{p.insurance_company}</p>
                  <p className="text-[10px] text-gray-400 truncate">Póliza {p.policy_number ?? '—'}</p>
                </div>
                {p.overdue_installments > 0 && (
                  <span className="text-[10px] font-semibold text-red-600 shrink-0">{p.overdue_installments} vencida{p.overdue_installments > 1 ? 's' : ''}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      )}

      <DriverDetailPanel
        driver={selectedDriver}
        carrierId={id}
        canEdit={canEdit}
        canAdmin={canAdmin}
        onClose={() => setSelectedDriverId(null)}
        onPatch={handlePatchDriver}
        onRemove={() => handleRemoveDriver(selectedDriver!.id)}
        onTransferClick={() => selectedDriver && setTransferTarget({ kind: 'driver', id: selectedDriver.id, label: `conductor ${selectedDriver.full_name}` })}
      />

      <VehicleDetailPanel
        asset={selectedAsset}
        carrierId={id}
        canEdit={canEdit}
        canAdmin={canAdmin}
        onClose={() => setSelectedAssetId(null)}
        onPatch={handlePatchAsset}
        onRemove={() => handleRemoveAsset(selectedAsset!.id)}
        onTransferClick={() => selectedAsset && setTransferTarget({ kind: 'asset', id: selectedAsset.id, label: `equipo ${selectedAsset.license_plate}` })}
        drivers={drivers}
      />

      <InsurancePolicyModal
        carrierId={selectedPolicyId ? id : null}
        displayName={carrier.business_name || carrier.tax_id}
        initialPolicyId={selectedPolicyId}
        onClose={() => setSelectedPolicyId(null)}
        canAdmin={canAdmin}
        canEdit={canEdit}
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
            <span className="text-xs text-gray-400 w-32 shrink-0">Carrier ID</span>
            <span className="text-xs font-mono text-gray-400 select-all break-all">{carrier.id}</span>
          </div>

          <EditableField label="Razón Social" value={carrier.business_name} canEdit={canEdit} onSave={handleSaveBusinessName} />
          <EditableField label="Estado operativo" value={carrier.operational_status} canEdit={canEdit} onSave={handleChangeOperationalStatus} options={OPERATIONAL_STATUS_OPTIONS} />
        </div>
      </div>

      <TransferModal
        open={!!transferTarget}
        title={transferTarget ? `Transferir ${transferTarget.label}` : 'Transferir'}
        currentCarrierId={id}
        onClose={() => setTransferTarget(null)}
        onTransfer={handleConfirmTransfer}
      />

      {bajaModalOpen && (
        <BajaReasonModal
          label={carrier.business_name || 'esta empresa'}
          onClose={() => setBajaModalOpen(false)}
          onConfirm={handleDeactivateCarrier}
        />
      )}

      {deleteModalOpen && (
        <DeleteCarrierModal
          label={carrier.business_name || 'esta empresa'}
          onClose={() => setDeleteModalOpen(false)}
          onConfirm={handleDeleteCarrier}
        />
      )}
    </div>
  )
}
