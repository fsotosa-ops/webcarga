'use client'

import { Suspense, useEffect, useState, useMemo } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, Search, Upload } from 'lucide-react'
import { carriersApi } from '@/lib/api/carriers'
import type { AssetType } from '@/lib/api/assets'
import { contactsApi } from '@/lib/api/contacts'
import { Tabs } from '@/components/ui/Tabs'
import { ProfileHeader } from '@/components/directory/ProfileHeader'
import { DetailsBlock } from '@/components/directory/DetailsBlock'
import { CarrierEditForm, InsuranceLine } from '@/components/directory/CarrierDetails'
import { SEVERITY_ORDER, documentStateStyle, enablementStyle, lifecycleStyle, carrierBlockingReason, type ComplianceSummary, type DocumentState } from '@/lib/states'
import { canonicalPlate, canonicalRut, plateSearchKey, rutDigits, rutSearchKey } from '@/lib/identity'
import { AlertStatTiles } from '@/components/dashboard/AlertStatTiles'
import { ContactCard, AddContactForm } from '@/components/dashboard/ContactCard'
import { CarrierDocumentsTab } from '@/components/dashboard/carriers/CarrierDocumentsTab'
import { DriverRosterCard } from '@/components/dashboard/DriverRosterCard'
import { VehicleRosterCard } from '@/components/dashboard/VehicleRosterCard'
import { DirectoryNotice } from '@/components/dashboard/DirectoryNotice'
import { FleetProfile } from '@/components/dashboard/FleetProfile'
import { AltaDeFlota } from '@/components/dashboard/AltaDeFlota'
import { BajaReasonModal } from '@/components/dashboard/BajaReasonModal'
import { ReactivateCarrierModal } from '@/components/dashboard/ReactivateCarrierModal'
import { CarrierClientsModal } from '@/components/dashboard/CarrierClientsModal'
import { DeleteCarrierModal } from '@/components/dashboard/DeleteCarrierModal'
import { InsurancePolicyModal, PolicyCreateForm, type PolicyFormState } from '@/components/dashboard/InsurancePolicyModal'
import { usePermiso } from '@/lib/authz/PermisosProvider'
import { GestionDeclarada } from '@/components/compliance/GestionDeclarada'
import { complianceApi } from '@/lib/api/compliance'
import { clavesCertificacion } from '@/lib/queries/certificacion'
import { useAssetTypes } from '@/hooks/useAssetTypes'
import { returnLink } from '@/lib/navegacion/directory'
import { CLOSURE_NOTICE, directoryKeys, invalidateDirectory, type DirectoryChange } from '@/lib/queries/directorio'

const ROSTER_PAGE_SIZE = 9

type Tab = 'resumen' | 'documentos' | 'conductores' | 'equipos' | 'seguros' | 'contactos'

const CONTACT_ROLE_OPTIONS = ['LEGAL_REP', 'OPERATIONS', 'FINANCE', 'DOCUMENTS']


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
  // Llegando desde otra pantalla (la vista rápida del Cierre) con `?next=`.
  const backLink            = returnLink(searchParams.get('next'))
  const canEdit = usePermiso('directory.edit')
  const canAdmin = usePermiso('directory.delete')
  // Cada botón con el permiso de SU endpoint (bloque 0, 0.3): ninguno responde 403.
  const canEditPolicies = usePermiso('policies.edit')
  const canDeletePolicies = usePermiso('policies.delete')
  // Los documentos son de Certificación: subirlos se decide con
  // SUS permisos, los mismos que exige la API (L5, 11/10).
  const canUploadDocuments = usePermiso('documents.upload')
  const [activeTab, setActiveTab] = useState<Tab>(
    requestedTab ?? (handoffDriverName ? 'conductores' : handoffTractorPlate ? 'equipos' : 'resumen'),
  )
  const [exportingDocs, setExportingDocs] = useState(false)
  const [exportErr, setExportErr]         = useState<string | null>(null)

  const [selectedDriverId,  setSelectedDriverId]  = useState<string | null>(requestedDriverId)
  const [selectedAssetId,   setSelectedAssetId]   = useState<string | null>(requestedAssetId)
  const [driverQ,  setDriverQ]  = useState('')
  const [driverHealthFilter, setDriverHealthFilter] = useState<DocumentState | ''>('')
  const [driverShowAll, setDriverShowAll] = useState(false)
  const [assetQ,   setAssetQ]   = useState('')
  const [assetTypeFilter, setAssetTypeFilter] = useState<AssetType | 'todos'>('todos')
  const { types: assetTypes, labelOf: assetTypeLabel } = useAssetTypes()
  const [assetHealthFilter, setAssetHealthFilter] = useState<DocumentState | ''>('')
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

  const [bajaModalOpen, setBajaModalOpen] = useState(false)
  const [reactivateOpen, setReactivateOpen] = useState(false)
  const [clientsOpen, setClientsOpen] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null)


  const carrierQuery = useQuery({ queryKey: directoryKeys.carrierDetail(id), queryFn: () => carriersApi.get(id) })

  // La propuesta de gestión a partir de lo que la empresa declaró se fue con
  // el formulario a `AltaDeFlota` (2026-08-27), junto con los catálogos de
  // subtipo y gestión: viven donde se usan, y así las dos pantallas que dan de
  // alta se comportan igual sin que nadie tenga que acordarse de las dos.

  const driversQuery = useQuery({ queryKey: directoryKeys.carrierDrivers(id), queryFn: () => carriersApi.listDrivers(id) })
  // El tipo de operación derivado de la flota (el chip de GestionDeclarada): el
  // mismo resumen que usa la pestaña Documentos, así que comparten caché.
  const summaryQuery = useQuery({ queryKey: clavesCertificacion.resumen(id), queryFn: () => complianceApi.summary(id) })
  const derivedOperation = summaryQuery.data?.carrier_operation_types.join(' + ') || null
  const assetsQuery  = useQuery({ queryKey: directoryKeys.carrierAssets(id), queryFn: () => carriersApi.listAssets(id) })
  const policiesQuery = useQuery({ queryKey: ['carrier-policies', id], queryFn: () => carriersApi.listPolicies(id) })
  const shippersQuery = useQuery({ queryKey: ['carrier-shippers', id], queryFn: () => carriersApi.listShippers(id) })
  const activeShippers = (shippersQuery.data ?? []).filter(s => s.status === 'ACTIVE')
  // D2 (P4): lo que toca la baja, recién al abrir la confirmación y siempre fresco.
  const impactQuery = useQuery({
    queryKey: ['carrier-deactivation-impact', id],
    queryFn: () => carriersApi.deactivationImpact(id),
    enabled: bajaModalOpen,
    staleTime: 0,
  })

  const carrier = carrierQuery.data
  const drivers = driversQuery.data ?? []
  const assets  = assetsQuery.data ?? []
  const policies = policiesQuery.data ?? []

  function invalidatePolicies(){ queryClient.invalidateQueries({ queryKey: ['carrier-policies', id] }) }
  const [notice, setNotice] = useState<string | null>(null)
  // "Activar" no tiene diálogo propio: si falla, se dice (revisión final de la Entrega 1).
  const [activateError, setActivateError] = useState<string | null>(null)
  /** Todo cambio pasa por acá: una sola lista de qué queda obsoleto, y el aviso
   *  cuando el cambio llega al Cierre (que se recalcula en el servidor). */
  async function afterChange(change: DirectoryChange, done?: string) {
    const { affectsClosure } = await invalidateDirectory(queryClient, change)
    const partes = [done, affectsClosure ? CLOSURE_NOTICE : null].filter(Boolean)
    setNotice(partes.length ? partes.join(' ') : null)
  }

  async function handleSaveBusinessName(value: string) {
    await carriersApi.patch(id, { business_name: value })
    await afterChange({ entity: 'carrier', id, type: 'update' })
  }
  async function handleDeactivateCarrier() {
    await carriersApi.patch(id, { operational_status: 'INACTIVE' })
    await afterChange({ entity: 'carrier', id, type: 'update' })
  }
  /** Activar una empresa en onboarding: no tiene flota que elegir. */
  async function handleActivateCarrier() {
    await carriersApi.patch(id, { operational_status: 'ACTIVE' })
    await afterChange({ entity: 'carrier', id, type: 'update' })
  }
  /** Reactivar una dada de baja eligiendo qué flota vuelve (D2, P3). */
  async function handleReactivateCarrier(body: { driver_ids: string[]; asset_ids: string[] }) {
    await carriersApi.reactivate(id, body)
    await afterChange({ entity: 'carrier', id, type: 'assignment' })
  }
  async function handleAddClient(shipperId: string) {
    await carriersApi.addShipper(id, shipperId)
    await queryClient.invalidateQueries({ queryKey: ['carrier-shippers', id] })
  }
  async function handleEndClient(shipperId: string) {
    await carriersApi.endShipper(id, shipperId)
    await queryClient.invalidateQueries({ queryKey: ['carrier-shippers', id] })
  }
  async function handleDeleteCarrier() {
    await carriersApi.delete(id)
    // Primero se sale de la ficha y después se quitan sus consultas: quitarlas
    // con la ficha montada la hace releer una empresa que ya no existe (404).
    router.push('/dashboard/carriers')
    await afterChange({ entity: 'carrier', id, type: 'delete' })
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
    await afterChange({ entity: 'carrier', id, type: 'contact' })
  }
  async function handleDeleteContact(contactId: string) {
    await contactsApi.delete(contactId)
    await afterChange({ entity: 'carrier', id, type: 'contact' })
  }
  async function handleAddContact(body: { contact_role: string; first_name?: string; last_name?: string; phone?: string; email?: string }) {
    await carriersApi.createContact(id, body)
    await afterChange({ entity: 'carrier', id, type: 'contact' })
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

  // El roster se reparte por el peor estado que manda la API (D1 §6.1): una
  // sola respuesta para "cómo está con sus documentos".
  const facetsOf = (rows: { compliance_summary: ComplianceSummary }[]) => ({
    '': rows.length,
    ...Object.fromEntries(SEVERITY_ORDER.map(s => [s, rows.filter(r => r.compliance_summary.worst_state === s).length])),
  }) as Record<'' | DocumentState, number>
  const driverFacets = useMemo(() => facetsOf(drivers), [drivers])
  const assetFacets  = useMemo(() => facetsOf(assets), [assets])

  const filteredDrivers = useMemo(() => drivers.filter(d => {
    const q = driverQ.trim()
    // RUT con o sin puntos (D1 §7.2): igualdad canónica, o la clave parcial del
    // backend (dígitos y K, 4 o más, sin otras letras) contra el RUT guardado.
    const rut = rutSearchKey(q)
    const cq = canonicalRut(q)
    const matchesRut = (cq !== null && cq === canonicalRut(d.tax_id))
      || (rut !== '' && rutDigits(d.tax_id).includes(rut))
    const matchesQ = !q || d.full_name.toLowerCase().includes(q.toLowerCase()) || matchesRut
    const matchesState = !driverHealthFilter || d.compliance_summary.worst_state === driverHealthFilter
    return matchesQ && matchesState
  }), [drivers, driverQ, driverHealthFilter])

  const filteredAssets = useMemo(() => assets.filter(a => {
    const pk = plateSearchKey(assetQ)
    const matchesQ = !assetQ || (canonicalPlate(assetQ) !== null && canonicalPlate(assetQ) === canonicalPlate(a.license_plate))
      || (pk !== '' && plateSearchKey(a.license_plate).includes(pk))
    const matchesType = assetTypeFilter === 'todos' || a.asset_type === assetTypeFilter
    const matchesState = !assetHealthFilter || a.compliance_summary.worst_state === assetHealthFilter
    return matchesQ && matchesType && matchesState
  }), [assets, assetQ, assetTypeFilter, assetHealthFilter])

  useEffect(() => { setDriverShowAll(false) }, [driverQ, driverHealthFilter])
  useEffect(() => { setAssetShowAll(false) }, [assetQ, assetTypeFilter, assetHealthFilter])

  const visibleDrivers = driverShowAll ? filteredDrivers : filteredDrivers.slice(0, ROSTER_PAGE_SIZE)
  const visibleAssets  = assetShowAll  ? filteredAssets  : filteredAssets.slice(0, ROSTER_PAGE_SIZE)

  // La ficha pinta lo que manda la API (D1 §6.2): la cifra de la empresa es
  // `compliance_summary`, y la lista de abajo son las filas que la bloquean.
  const summary = carrier?.compliance_summary


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

  // ONBOARDING -> ACTIVE es un alta (directory.edit); cualquier otro cambio del
  // estado de la empresa pide directory.delete.
  const life = lifecycleStyle('carrier', carrier.operational_status)
  const enabled = enablementStyle(carrier.compliance_summary, carrier.operational_status === 'ACTIVE')
  const canChangeCarrierStatus = carrier.operational_status === 'ONBOARDING' ? canEdit : canAdmin

  return (
    <div className="p-4 md:p-6 space-y-5 relative">
      {backLink && (
        <Link href={backLink.href}
              className="inline-flex items-center gap-1.5 text-dato font-semibold text-accion hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded">
          <ArrowLeft size={14} aria-hidden="true" />{backLink.label}
        </Link>
      )}
      <nav aria-label="Ruta" className="flex items-center gap-1.5 text-xs text-informativo">
        <Link href="/dashboard/carriers" className="shrink-0 hover:text-accion">Directorio</Link>
        <span aria-hidden>›</span>
        <span className="truncate font-semibold text-text-primary">{carrier.business_name || id}</span>
      </nav>

      {/* El encabezado de las tres fichas (Entrega 1 de fichas, 15/10): quién es,
          cómo está y por qué no puede operar; lo demás, en Detalles y en el ⋯. */}
      <ProfileHeader
        title={carrier.business_name || '—'}
        chips={[life, enabled]}
        reason={carrierBlockingReason(carrier.compliance_summary, carrier.operational_status)}
        onSeeDocuments={() => setActiveTab('documentos')}
        primaryAction={canUploadDocuments ? (
          <button type="button" onClick={() => setActiveTab('documentos')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-dato font-semibold text-white hover:bg-accent/90">
            <Upload size={14} aria-hidden="true" /> Subir documentos
          </button>
        ) : undefined}
        menuItems={[
          ...(canEdit && shippersQuery.data ? [{ id: 'clients', label: 'Editar clientes', onSelect: () => setClientsOpen(true) }] : []),
          ...(canChangeCarrierStatus ? [carrier.operational_status === 'ACTIVE'
            ? { id: 'baja', label: 'Dar de baja', destructive: true, onSelect: () => setBajaModalOpen(true) }
            : carrier.operational_status === 'ONBOARDING'
              ? { id: 'activate', label: 'Activar', onSelect: () => {
                  setActivateError(null)
                  handleActivateCarrier().catch(e => setActivateError(e instanceof Error ? e.message : 'No se pudo activar.'))
                } }
              : { id: 'reactivate', label: 'Reactivar', onSelect: () => setReactivateOpen(true) }] : []),
          ...(canAdmin ? [{ id: 'delete', label: 'Eliminar', destructive: true, onSelect: () => setDeleteModalOpen(true) }] : []),
        ]}
      />
      {activateError && <p role="alert" className="text-dato text-status-incidente">{activateError}</p>}

      {/* ── Tabs — una sección visible a la vez, cero scroll entre ellas ── */}
      <Tabs
        label="Secciones de la empresa"
        value={activeTab}
        onChange={setActiveTab}
        tabs={[
          { id: 'resumen',     label: 'Resumen' },
          { id: 'documentos',  label: 'Documentos',  count: summary ? (summary.own.overdue + summary.own.missing) || null : null, urgent: true },
          { id: 'conductores', label: 'Conductores', count: drivers.length },
          { id: 'equipos',     label: 'Equipos',     count: assets.length },
          { id: 'seguros',     label: 'Seguros',     count: policies.length },
          { id: 'contactos',   label: 'Contactos',   count: carrier.contacts.length },
        ]}
      />

      {/* ── Resumen: UN bloque de Detalles (Entrega 1 de fichas, 15/10). Los
          pendientes viven en Documentos; la flota, en sus pestañas. ── */}
      {activeTab === 'resumen' && (
        <DetailsBlock
          canEdit={canEdit}
          rows={[
            { label: 'RUT', value: <span className="font-identificador tabular-nums">{carrier.tax_id}</span> },
            { label: 'Tipo de operación', value: (
              <span className="flex flex-wrap items-center gap-2">
                {summaryQuery.data
                  ? <span>{derivedOperation ?? 'Sin determinar'} <span className="text-informativo">(según su flota)</span></span>
                  : <span className="text-informativo">Cargando…</span>}
                <GestionDeclarada
                  carrierId={id}
                  declarado={carrier.management_types}
                  derivado={derivedOperation}
                  canEdit={canEdit && carrier.operational_status === 'ACTIVE'}
                  onGuardado={() => afterChange({ entity: 'carrier', id, type: 'update' })}
                />
              </span>
            ) },
            { label: 'Clientes', value: shippersQuery.data
              ? (activeShippers.length ? activeShippers.map(sh => sh.name).join(', ') : <span className="text-informativo">Sin clientes</span>)
              : <span className="text-informativo">Cargando…</span> },
            { label: 'Seguros', value: <InsuranceLine policies={policiesQuery.data} taxId={carrier.tax_id} /> },
          ]}
          renderForm={close => (
            <CarrierEditForm
              businessName={carrier.business_name}
              legacyAdminId={carrier.legacy_admin_id}
              onSave={async name => { await handleSaveBusinessName(name) }}
              onClose={close}
            />
          )}
        />
      )}

      {/* ── Documentos ── */}
      {activeTab === 'documentos' && (
        <CarrierDocumentsTab
          carrierId={id}
          carrier={carrier}
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
              canDelete={canAdmin}
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

        <div className="mb-3 max-w-xl">
          <AlertStatTiles
            tiles={[
              { id: '', label: 'Todos', value: driverFacets[''], tone: 'neutral' },
              ...SEVERITY_ORDER.map(s => ({
                id: s, label: documentStateStyle(s).label, value: driverFacets[s],
                tone: s === 'OVERDUE' ? 'danger' as const : s === 'UP_TO_DATE' ? 'success' as const : 'neutral' as const,
              })),
            ]}
            active={driverHealthFilter}
            onSelect={id => setDriverHealthFilter(id as DocumentState | '')}
          />
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
              onCreado={() => afterChange({ entity: 'driver', type: 'create', carrierIds: [id] })}
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
                <DriverRosterCard key={d.id} driver={d} carrierStatus={carrier.operational_status} onOpen={() => setSelectedDriverId(d.id)} />
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

        <div className="mb-3 max-w-xl">
          <AlertStatTiles
            tiles={[
              { id: '', label: 'Todos', value: assetFacets[''], tone: 'neutral' },
              ...SEVERITY_ORDER.map(s => ({
                id: s, label: documentStateStyle(s).label, value: assetFacets[s],
                tone: s === 'OVERDUE' ? 'danger' as const : s === 'UP_TO_DATE' ? 'success' as const : 'neutral' as const,
              })),
            ]}
            active={assetHealthFilter}
            onSelect={id => setAssetHealthFilter(id as DocumentState | '')}
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
          {assetTypes.map(opt => (
            <button
              key={opt.code}
              onClick={() => setAssetTypeFilter(opt.code)}
              aria-pressed={assetTypeFilter === opt.code}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-all ${
                assetTypeFilter === opt.code ? 'bg-accent border-accent text-white' : 'text-gray-500 border-gray-200 bg-white hover:border-gray-300'
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
              onCreado={() => afterChange({ entity: 'asset', type: 'create', carrierIds: [id] })}
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
                <VehicleRosterCard key={a.id} vehicle={a} typeLabel={assetTypeLabel(a.asset_type)} carrierStatus={carrier.operational_status} onOpen={() => setSelectedAssetId(a.id)} />
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
            {canEditPolicies && (
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

      {/* El conductor o el equipo, sobre la ficha de su empresa: ES su ficha propia,
          en modal (Entrega 1 de fichas, 15/10). Una sola implementación de Detalles. */}
      {selectedDriverId && <FleetProfile kind="driver" id={selectedDriverId} variant="dialog" onClose={() => setSelectedDriverId(null)} />}
      {selectedAssetId && <FleetProfile kind="asset" id={selectedAssetId} variant="dialog" onClose={() => setSelectedAssetId(null)} />}

      <InsurancePolicyModal
        carrierId={selectedPolicyId ? id : null}
        displayName={carrier.business_name || carrier.tax_id}
        initialPolicyId={selectedPolicyId}
        onClose={() => setSelectedPolicyId(null)}
        canAdmin={canDeletePolicies}
        canEdit={canEditPolicies}
      />

      {bajaModalOpen && (
        <BajaReasonModal
          label={carrier.business_name || 'esta empresa'}
          onClose={() => setBajaModalOpen(false)}
          onConfirm={handleDeactivateCarrier}
          impact={impactQuery.data ?? null}
        />
      )}

      {reactivateOpen && (
        <ReactivateCarrierModal
          label={carrier.business_name || 'esta empresa'}
          drivers={drivers.map(d => ({ id: d.id, label: d.full_name }))}
          assets={assets.map(a => ({ id: a.id, label: a.license_plate }))}
          onClose={() => setReactivateOpen(false)}
          onConfirm={handleReactivateCarrier}
        />
      )}

      {clientsOpen && (
        <CarrierClientsModal
          label={carrier.business_name || 'esta empresa'}
          clients={shippersQuery.data ?? []}
          onClose={() => setClientsOpen(false)}
          onAdd={handleAddClient}
          onEnd={handleEndClient}
        />
      )}

      {deleteModalOpen && (
        <DeleteCarrierModal
          label={carrier.business_name || 'esta empresa'}
          onClose={() => setDeleteModalOpen(false)}
          onConfirm={handleDeleteCarrier}
        />
      )}
      <DirectoryNotice message={notice} onClose={() => setNotice(null)} />
    </div>
  )
}

