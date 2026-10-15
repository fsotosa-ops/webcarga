'use client'

import { CorrectIdentityModal } from './CorrectIdentityModal'
import { certificationRequestsApi } from '@/lib/api/certificationRequests'
import { useSubirDocumento } from '@/hooks/useSubirDocumento'
import { useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { Check, Loader2, ArrowRightLeft, Trash2, ExternalLink } from 'lucide-react'
import type { Driver } from '@/lib/types'
import { driversApi, type DriverPatchBody } from '@/lib/api/drivers'
import { locationsApi } from '@/lib/api/locations'
import { contactsApi } from '@/lib/api/contacts'
import { invalidateDirectory } from '@/lib/queries/directorio'
import { DocumentChecklist } from './DocumentChecklist'
import { DetailShell, type DetailVariant } from './DetailShell'
import { documentStateCounts } from '@/lib/states'
import { CompletionRing } from './CompletionRing'
import { BajaReasonModal } from './BajaReasonModal'
import { ConfirmarBaja } from '@/components/compliance/ConfirmarBaja'
import { ContactCard, AddContactForm } from './ContactCard'
import { complianceRecordsToChecklistItems } from '@/lib/utils/complianceChecklist'
import { getInitials, getInitialColor } from '@/lib/utils/avatar'

const DRIVER_CONTACT_ROLE_OPTIONS = ['PERSONAL', 'EMERGENCIA', 'OTRO']

interface Props {
  driver:          Driver | null
  /** Null en la ficha propia de alguien sin empresa (D4). */
  carrierId:       string | null
  /** Para nombrar la empresa en la confirmación de "Quitar del roster". */
  carrierName?:    string
  canEdit:         boolean
  /** Subir o reemplazar documentos (`documents.upload`) y reasignarlos
   *  (`documents.review`): permisos de Certificación, no de editar la ficha. */
  canUploadDocuments: boolean
  canReviewDocuments: boolean
  /** Pedir a Certificación lo pendiente (`certification.request`, Entrega B). */
  canRequestDocuments?: boolean
  /** Corregir RUT o patente con motivo (`directory.identity`, D3). */
  canCorrectIdentity?: boolean
  /** Dar de baja y reactivar (`directory.fleet_status`): Operaciones lo tiene
   *  aunque no edite la ficha (D-e, 12/10). */
  canChangeFleetStatus: boolean
  /** Eliminar un contacto (`directory.delete`). */
  canDeleteContacts: boolean
  /** `dialog` sobre la ficha de su empresa; `page` en su ficha propia (D4). */
  variant?:        DetailVariant
  /** Lo que la ficha propia agrega a la derecha: dónde trabaja y su actividad. */
  extra?:          ReactNode
  /** Solo en el modal. */
  onClose?:        () => void
  onPatch:         (id: string, body: DriverPatchBody) => Promise<void>
  /** Sin empresa no hay roster del que quitar. */
  onRemove?:       () => Promise<void>
  onTransferClick?: () => void
}

/** Modal de detalle de un conductor — se abre al hacer click en su tarjeta
 *  del roster. El checklist de documentación se carga acá mismo (no lo trae
 *  el roster, que solo expone el agregado) vía GET /drivers/{id}/compliance-records.
 *  Solo lectura desde Ronda 88 — subir/editar documentos se hace en
 *  Certificación, ver TransporterDocumentsPanel. */
export function DriverDetailPanel({ driver, carrierId, carrierName, canEdit, canChangeFleetStatus, canDeleteContacts, canUploadDocuments, canReviewDocuments, canRequestDocuments = false, canCorrectIdentity = false, variant = 'dialog', extra, onClose, onPatch, onRemove, onTransferClick }: Props) {
  const open = !!driver
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState({ full_name: '', home_location_id: '' })
  const [saving, setSaving] = useState(false)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [bajaModalOpen, setBajaModalOpen] = useState(false)

  const subirDocumento = useSubirDocumento()
  const [correcting, setCorrecting] = useState(false)

  const complianceQuery = useQuery({
    queryKey: ['driver-compliance-records', driver?.id],
    queryFn: () => driversApi.listComplianceRecords(driver!.id),
    enabled: !!driver,
  })

  const contactsQuery = useQuery({
    queryKey: ['driver-contacts', driver?.id],
    queryFn: () => driversApi.listContacts(driver!.id),
    enabled: !!driver,
  })

  // El desplegable de origen habitual sale del CATÁLOGO, no de lo que el conductor haya
  // recorrido: se le puede asignar un CD al que todavía no fue nunca.
  const cdsQuery = useQuery({
    queryKey: ['origenes'],
    queryFn: () => locationsApi.list({ origin: true, operational_status: 'ACTIVE', limit: 200 }),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  useEffect(() => {
    if (!driver) return
    // El borrador se resincroniza desde el prop en cada apertura. Un useState
    // inicial se queda con el valor viejo, y ese bug ya apareció cuatro veces
    // en este repo.
    setDraft({ full_name: driver.full_name, home_location_id: driver.home_location_id ?? '' })
    setErr(null)
  }, [driver])

  function invalidateContacts() {
    if (driver) queryClient.invalidateQueries({ queryKey: ['driver-contacts', driver.id] })
  }
  async function afterContactChange() {
    invalidateContacts()
    // El teléfono de la vista rápida sale del contacto principal.
    if (driver) await invalidateDirectory(queryClient, { entity: 'driver', id: driver.id, type: 'contact' })
  }

  async function handleSaveContact(contactId: string, patch: { first_name?: string; last_name?: string; phone?: string; email?: string }) {
    await contactsApi.patch(contactId, patch)
    await afterContactChange()
  }
  async function handleDeleteContact(contactId: string) {
    await contactsApi.delete(contactId)
    await afterContactChange()
  }
  async function handleAddContact(body: { contact_role: string; first_name?: string; last_name?: string; phone?: string; email?: string }) {
    if (!driver) return
    await driversApi.createContact(driver.id, body)
    await afterContactChange()
  }

  async function handleSaveDatos() {
    if (!driver) return
    setSaving(true); setErr(null)
    try {
      // home_location_id viaja SIEMPRE: '' significa "quítaselo", y omitirlo
      // significaría "no lo toques". Son cosas distintas.
      await onPatch(driver.id, {
        full_name: draft.full_name,
        home_location_id: draft.home_location_id,
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeactivate() {
    await onPatch(driver!.id, { operational_status: 'INACTIVE' })
  }

  async function handleReactivate() {
    await onPatch(driver!.id, { operational_status: 'ACTIVE' })
  }

  if (!open) return null

  const items = complianceRecordsToChecklistItems(complianceQuery.data ?? [])
  const ok = documentStateCounts(items).UP_TO_DATE
  const total = items.length

  return (
    <>
      <DetailShell variant={variant} label={`Detalle de ${driver.full_name}`} onClose={onClose}>
        <div className="sm:w-[320px] shrink-0 bg-gray-50 border-b sm:border-b-0 sm:border-r border-border overflow-y-auto p-5">
          <div className="flex items-center gap-3 mb-5">
            <div
              className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
              style={{ backgroundColor: getInitialColor(driver.full_name) }}
            >
              {getInitials(driver.full_name)}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-text-primary truncate">{driver.full_name}</p>
              <p className="text-[11px] text-gray-400 font-mono">{driver.tax_id}</p>
              {canCorrectIdentity && (
                <button type="button" onClick={() => setCorrecting(true)}
                        className="text-etiqueta font-semibold text-accion hover:underline">
                  Corregir RUT
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 mb-5">
            <CompletionRing ok={ok} total={total} />
            <p className="text-[11px] text-gray-500">{ok} de {total}<br />documentos al día</p>
          </div>

          <div className="space-y-1 mb-2">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Nombre</label>
            <input
              aria-label="Nombre"
              value={draft.full_name}
              disabled={!canEdit}
              onChange={e => setDraft(d => ({ ...d, full_name: e.target.value }))}
              className="w-full text-xs border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white disabled:bg-gray-50"
            />
          </div>
          <div className="space-y-1 mb-2">
            <label
              htmlFor="cd-base"
              className="text-[10px] font-bold text-informativo uppercase tracking-wide"
            >
              Origen habitual
            </label>
            {/* Si el catálogo no carga, NO se dibuja un desplegable vacío que
                parezca "no hay CD": se dice qué pasó. */}
            {cdsQuery.isError ? (
              <p className="text-[11px] text-status-incidente">
                No se pudieron cargar los orígenes.
              </p>
            ) : (
              <select
                id="cd-base"
                aria-label="Origen habitual"
                value={draft.home_location_id}
                disabled={!canEdit || cdsQuery.isLoading}
                onChange={e => setDraft(d => ({ ...d, home_location_id: e.target.value }))}
                className="w-full text-xs border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30 bg-white disabled:opacity-60"
              >
                <option value="">Sin asignar</option>
                {(cdsQuery.data?.data ?? []).map(cd => (
                  <option key={cd.id} value={cd.id}>{cd.name}</option>
                ))}
              </select>
            )}
            {driver.home_location_shipper && draft.home_location_id === driver.home_location_id && (
              <p className="text-[11px] text-informativo">{driver.home_location_shipper}</p>
            )}
            {/* PROPONE, nunca escribe. El botón dice el CD concreto: quien lo
                aprieta tiene que poder leer qué va a quedar guardado sin abrir
                el desplegable. */}
            {canEdit && driver.suggested_home_location && !draft.home_location_id && (
              <div className="pt-1">
                <p className="text-[11px] text-informativo">
                  Salió {driver.suggested_home_location.viajes} de{' '}
                  {driver.suggested_home_location.total} veces desde{' '}
                  {driver.suggested_home_location.name} en los últimos 90 días.
                </p>
                <button
                  type="button"
                  onClick={() => setDraft(d => ({
                    ...d, home_location_id: driver.suggested_home_location!.id,
                  }))}
                  className="mt-1 text-[11px] font-semibold text-accion hover:underline"
                >
                  Asignar {driver.suggested_home_location.name}
                </button>
              </div>
            )}
            {canEdit && !driver.suggested_home_location && !driver.home_location_id && (
              <p className="text-[11px] text-informativo">
                Sus viajes no señalan un CD claro. Elige uno.
              </p>
            )}
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={handleSaveDatos}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/90 disabled:opacity-50"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Guardar
            </button>
          )}
          {err && <p className="text-xs text-red-500 mt-1">{err}</p>}

          <div className="mt-5 space-y-2">
            {canEdit && onTransferClick && (
              <button
                type="button"
                onClick={onTransferClick}
                className="flex items-center justify-center gap-1.5 w-full text-sm font-semibold text-gray-600 border border-border hover:border-accent hover:text-accent rounded-lg px-4 py-2.5 transition-colors"
              >
                <ArrowRightLeft size={14} /> {carrierId ? 'Transferir a otra empresa' : 'Asignar a una empresa'}
              </button>
            )}
            {canChangeFleetStatus && (
              driver.operational_status === 'INACTIVE' ? (
                <button
                  type="button"
                  onClick={handleReactivate}
                  className="flex items-center justify-center gap-1.5 w-full text-sm font-semibold text-gray-600 border border-border hover:border-accent hover:text-accent rounded-lg px-4 py-2.5 transition-colors"
                >
                  Reactivar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setBajaModalOpen(true)}
                  className="flex items-center justify-center gap-1.5 w-full text-sm font-semibold text-red-500 border border-red-200 hover:bg-red-50 rounded-lg px-4 py-2.5 transition-colors"
                >
                  Dar de baja
                </button>
              )
            )}
            {canEdit && onRemove && (
              <button
                type="button"
                onClick={() => setConfirmingRemove(true)}
                className="flex items-center justify-center gap-1.5 w-full text-sm font-semibold text-red-500 border border-red-200 hover:bg-red-50 rounded-lg px-4 py-2.5 transition-colors"
              >
                <Trash2 size={14} />
                Quitar del roster
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0 overflow-y-auto p-6">
          {extra}
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Documentación</p>
          </div>
          {complianceQuery.isPending ? (
            <p className="text-xs text-gray-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Cargando…</p>
          ) : (
            /* HU-04: la ficha vuelve a poder cargar. La capacidad ya estaba
               en DocumentChecklist — quedó apagada en la Ronda 88, cuando la
               carga se centralizó en Certificación. */
            <DocumentChecklist
              items={items}
              canUpload={canUploadDocuments}
              canReview={canReviewDocuments}
              hideCounter
              /* EL MISMO hook que Certificación. Antes esto llamaba a
                 la puerta de la Bandeja, que sube ANTES de clasificar: cada
                 rechazo por falta de fecha dejaba el archivo varado en la
                 bandeja y el requisito vacío. Dos implementaciones de
                 "subir un documento a un requisito" es como este módulo
                 terminó con dos caminos que se estorbaban. */
              onUpload={async (recordId, file, datos) => {
                await subirDocumento(recordId, file, datos)
                await complianceQuery.refetch()
              }}
              carrierId={carrierId ?? undefined}
              onReassigned={() => complianceQuery.refetch()}
              /* Operaciones no sube: pide (Entrega B). */
              onRequest={canRequestDocuments ? async item => {
                await certificationRequestsApi.create({ entity_type: 'DRIVER', entity_id: driver!.id, requirement_id: item.requirement_id })
                await complianceQuery.refetch()
              } : undefined}
            />
          )}

          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-3 mt-6">Contactos</p>
          {contactsQuery.isPending ? (
            <p className="text-xs text-gray-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Cargando…</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(contactsQuery.data ?? []).map(c => (
                <ContactCard
                  key={c.id}
                  contact={c}
                  canEdit={canEdit}
                  canDelete={canDeleteContacts}
                  onSaved={patch => handleSaveContact(c.id, patch)}
                  onDeleted={() => handleDeleteContact(c.id)}
                />
              ))}
              {canEdit && <AddContactForm roleOptions={DRIVER_CONTACT_ROLE_OPTIONS} onAdd={handleAddContact} />}
              {(contactsQuery.data ?? []).length === 0 && !canEdit && (
                <p className="text-xs text-gray-300 italic">Sin contactos registrados</p>
              )}
            </div>
          )}
        </div>
      </DetailShell>
      {correcting && driver && (
        <CorrectIdentityModal
          field="RUT"
          current={driver.tax_id}
          hint="El RUT viejo queda en la auditoría."
          onClose={() => setCorrecting(false)}
          onConfirm={async (value, reason) => {
            await driversApi.correctRut(driver.id, value, reason)
            await invalidateDirectory(queryClient, { entity: 'driver', id: driver.id, type: 'update' })
          }}
        />
      )}

      {bajaModalOpen && (
        <BajaReasonModal
          label={`conductor ${driver.full_name}`}
          onClose={() => setBajaModalOpen(false)}
          onConfirm={handleDeactivate}
        />
      )}
      <ConfirmarBaja
        abierto={confirmingRemove}
        variant="remove"
        nombreSujeto={driver.full_name}
        nombreEmpresa={carrierName ?? 'esta empresa'}
        onCancelar={() => setConfirmingRemove(false)}
        onConfirmar={async () => { await onRemove?.(); setConfirmingRemove(false) }}
      />
    </>
  )
}
