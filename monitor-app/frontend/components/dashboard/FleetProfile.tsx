'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Building2, Upload } from 'lucide-react'
import { driversApi, type DriverPatchBody } from '@/lib/api/drivers'
import { assetsApi, type AssetPatchBody } from '@/lib/api/assets'
import { carriersApi } from '@/lib/api/carriers'
import { entitySummaryKey, fetchEntitySummary, type AssetSummary, type DriverSummary } from '@/lib/api/entitySummary'
import { usePermiso } from '@/lib/authz/PermisosProvider'
import { CLOSURE_NOTICE, directoryKeys, invalidateDirectory, type DirectoryChange } from '@/lib/queries/directorio'
import { assetHref, driverHref, returnLink } from '@/lib/navegacion/directory'
import { monitorSearchHref } from '@/lib/navegacion/viaje'
import { blockingReason, fleetMemberStyle, isCarrierDeactivated, summaryStyle, type StateStyle } from '@/lib/states'
import { diaMes, isBlockingPending } from '@/lib/pending'
import { useAssetTypes } from '@/hooks/useAssetTypes'
import { Estado } from '@/components/ui/Estado'
import { Tabs, type TabOption } from '@/components/ui/Tabs'
import type { ActionsMenuItem } from '@/components/ui/ActionsMenu'
import { ProfileHeader } from '@/components/directory/ProfileHeader'
import { DetailsBlock, type DetailRow } from '@/components/directory/DetailsBlock'
import { DriverEditForm } from '@/components/directory/DriverEditForm'
import { AssetEditForm } from '@/components/directory/AssetEditForm'
import { DriverContacts } from '@/components/directory/DriverContacts'
import { EntityCell } from './EntityCell'
import { TransferModal } from './TransferModal'
import { DetailShell } from './DetailShell'
import { CorrectIdentityModal } from './CorrectIdentityModal'
import { BajaReasonModal } from './BajaReasonModal'
import { ConfirmarBaja } from '@/components/compliance/ConfirmarBaja'
import { EntityDocuments, useEntityPendingRows } from '@/components/compliance/EntityDocuments'
import type { AssignmentPeriod, EntityActivity } from '@/lib/types'

export type FleetKind = 'driver' | 'asset'
type Section = 'resumen' | 'documentos' | 'contactos'

const LIST = {
  driver: { href: '/dashboard/drivers', label: 'Conductores', noun: 'conductor' },
  asset:  { href: '/dashboard/assets',  label: 'Equipos',     noun: 'equipo' },
} as const

const NO_CARRIER: StateStyle = { label: 'Sin empresa', tone: 'neutral', icon: Building2 }

/**
 * La ficha propia de un conductor o un equipo (Entrega 1 de fichas, 15/10):
 * encabezado con la razón de lo que bloquea, secciones con la barra del kit y un
 * Resumen que es UN bloque de Detalles con "Editar" (cada dato, una vez). Existe
 * aunque no tenga empresa (C5).
 */
export function FleetProfile({ kind, id, variant = 'page', onClose }: {
  kind: FleetKind
  id: string
  /** `dialog`: la misma ficha sobre la de su empresa (Entrega 1 de fichas): no
   *  lee la sección de la URL (es la de la empresa) y ofrece la ficha completa. */
  variant?: 'page' | 'dialog'
  onClose?: () => void
}) {
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const back = returnLink(searchParams.get('next'))
  const sectionTabs: TabOption<Section>[] = [
    { id: 'resumen', label: 'Resumen' },
    { id: 'documentos', label: 'Documentos' },
    ...(kind === 'driver' ? [{ id: 'contactos' as const, label: 'Contactos' }] : []),
  ]
  const requested = variant === 'page' ? searchParams.get('tab') : null
  const [tab, setTab] = useState<Section>(sectionTabs.find(t => t.id === requested)?.id ?? 'resumen')
  const [modal, setModal] = useState<'transfer' | 'identity' | 'baja' | 'remove' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Lo que se hace desde el ⋯ sin diálogo propio (Reactivar) dice si falló:
  // en silencio parecía hecho (revisión final de la Entrega 1).
  const [actionError, setActionError] = useState<string | null>(null)
  const { labelOf } = useAssetTypes()

  const canEdit = usePermiso('directory.edit')
  const canAdmin = usePermiso('directory.delete')
  const canRequestDocuments = usePermiso('certification.request')
  const canCorrectIdentity = usePermiso('directory.identity')
  const canChangeFleetStatus = usePermiso('directory.fleet_status')
  const canUploadDocuments = usePermiso('documents.upload')

  const summaryQuery = useQuery({
    queryKey: entitySummaryKey(kind, id), queryFn: () => fetchEntitySummary(kind, id), retry: false,
  })
  const driverQuery = useQuery({
    queryKey: directoryKeys.driverDetail(id), queryFn: () => driversApi.get(id), enabled: kind === 'driver', retry: false,
  })
  const assetQuery = useQuery({
    queryKey: directoryKeys.assetDetail(id), queryFn: () => assetsApi.get(id), enabled: kind === 'asset', retry: false,
  })
  // Lo que bloquea, para el encabezado: las mismas filas que la sección Documentos.
  const pendingRowsQuery = useEntityPendingRows(id)
  const historyQuery = useQuery({
    queryKey: directoryKeys.assignments(kind, id),
    queryFn: () => (kind === 'driver' ? driversApi.assignments(id) : assetsApi.assignments(id)),
  })
  const activityQuery = useQuery({
    queryKey: directoryKeys.activity(kind, id),
    queryFn: () => (kind === 'driver' ? driversApi.activity(id) : assetsApi.activity(id)),
  })
  const summary = summaryQuery.data as DriverSummary | AssetSummary | undefined
  const carrierId = summary?.carrier?.id ?? null
  // El conductor habitual de un tracto se elige entre los conductores de su empresa.
  const carrierDriversQuery = useQuery({
    queryKey: directoryKeys.carrierDrivers(carrierId ?? ''),
    queryFn: () => carriersApi.listDrivers(carrierId!),
    enabled: kind === 'asset' && !!carrierId && canEdit,
  })

  const entity = kind === 'driver' ? driverQuery : assetQuery
  if (entity.isError || summaryQuery.isError) {
    const err = (entity.error ?? summaryQuery.error) as { status?: number }
    return err?.status === 404
      ? <Estado tipo="vacio" titulo="No se encontró en el directorio" />
      : <Estado tipo="error" titulo={`No se pudo abrir el ${LIST[kind].noun}`} detalle="Reintenta en unos segundos." />
  }
  if (!entity.data) return <Estado tipo="cargando" />

  const driver = driverQuery.data
  const asset = assetQuery.data
  const title = kind === 'driver' ? driver!.full_name : asset!.license_plate
  const monitorQuery = kind === 'driver' ? driver!.tax_id : asset!.license_plate
  // El resumen manda: es lo que dicen la vista rápida y las listas.
  const status = summary?.operational_status ?? entity.data.operational_status

  // ── Encabezado ──────────────────────────────────────────────────────────────
  const carrierStatus = summary?.carrier?.operational_status ?? null
  const active = status === 'ACTIVE' && !isCarrierDeactivated(carrierStatus)
  const chips = summary
    ? [fleetMemberStyle(kind, summary.operational_status, carrierStatus),
       summaryStyle(summary.compliance_summary, active),
       ...(summary.carrier ? [] : [NO_CARRIER])]
    : null
  const reason = summary
    ? blockingReason(pendingRowsQuery.data?.rows.filter(isBlockingPending).map(r => ({ name: r.document_name, document_state: r.document_state })),
        summary.compliance_summary, active)
    : null

  async function afterChange(change: DirectoryChange, done?: string) {
    const { affectsClosure } = await invalidateDirectory(queryClient, change)
    await queryClient.invalidateQueries({ queryKey: entitySummaryKey(kind, id) })
    setNotice([done, affectsClosure ? CLOSURE_NOTICE : null].filter(Boolean).join(' ') || null)
  }
  async function patch(body: DriverPatchBody | AssetPatchBody) {
    if (kind === 'driver') await driversApi.patch(id, body as DriverPatchBody)
    else await assetsApi.patch(id, body as AssetPatchBody)
    await afterChange({ entity: kind, id, type: 'update', carrierIds: [carrierId] })
  }

  const menuItems: ActionsMenuItem[] = [
    ...(canEdit ? [{ id: 'transfer', label: carrierId ? 'Transferir a otra empresa' : 'Asignar a una empresa', onSelect: () => setModal('transfer') }] : []),
    ...(canCorrectIdentity ? [{ id: 'identity', label: kind === 'driver' ? 'Corregir RUT' : 'Corregir patente', onSelect: () => setModal('identity') }] : []),
    ...(canChangeFleetStatus
      ? [status === 'INACTIVE'
          ? { id: 'reactivate', label: 'Reactivar', onSelect: () => {
              setActionError(null)
              patch({ operational_status: 'ACTIVE' }).catch(e => setActionError(e instanceof Error ? e.message : 'No se pudo reactivar.'))
            } }
          : { id: 'baja', label: 'Dar de baja', destructive: true, onSelect: () => setModal('baja') }]
      : []),
    ...(canEdit && carrierId ? [{ id: 'remove', label: 'Quitar de la empresa', destructive: true, onSelect: () => setModal('remove') }] : []),
  ]
  // En Documentos la sección ya tiene su subida y sus pedidos: no se repite arriba.
  const primaryAction = (canUploadDocuments || canRequestDocuments) && tab !== 'documentos' ? (
    <button type="button" onClick={() => setTab('documentos')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-dato font-semibold text-white hover:bg-accent/90">
      <Upload size={14} aria-hidden="true" /> {canUploadDocuments ? 'Subir documentos' : 'Pedir a Certificación'}
    </button>
  ) : undefined

  // ── Detalles ────────────────────────────────────────────────────────────────
  const empresa: ReactNode = summary?.carrier
    ? <><EntityCell kind="carrier" id={summary.carrier.id} label={summary.carrier.name} />
        {historyLine(historyQuery.data) && <span className="text-informativo"> {historyLine(historyQuery.data)}</span>}</>
    : <span className="text-informativo">—</span>
  const rows: DetailRow[] = kind === 'driver'
    ? [
        { label: 'RUT', value: <span className="font-identificador tabular-nums">{driver!.tax_id}</span> },
        { label: 'Empresa', value: empresa },
        { label: 'Tracto habitual', value: <EntityCell kind="asset" id={(summary as DriverSummary | undefined)?.usual_tractor?.id} label={(summary as DriverSummary | undefined)?.usual_tractor?.plate} empty="Sin tracto habitual" mono /> },
        { label: 'Origen habitual', value: driver!.home_location_name ?? <span className="text-informativo">Sin asignar</span> },
      ]
    : [
        { label: 'Tipo', value: `${labelOf(asset!.asset_type)}${asset!.fleet_service_type_label ? ` · ${asset!.fleet_service_type_label}` : ''}` },
        { label: 'Tipo de operación', value: asset!.webcarga_operation_type_label ?? <span className="text-status-incidente">Sin clasificar</span> },
        { label: 'Año', value: asset!.manufacture_year ?? <span className="text-informativo">—</span> },
        { label: 'Conductor habitual', value: <EntityCell kind="driver" id={(summary as AssetSummary | undefined)?.usual_driver?.id} label={(summary as AssetSummary | undefined)?.usual_driver?.name} empty="Sin conductor habitual" /> },
        { label: 'Empresa', value: empresa },
      ]
  const activity = activityQuery.data
  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-2 text-dato">
      <span>{activityLine(activity)}</span>
      <Link href={monitorSearchHref(monitorQuery)} prefetch={false} className="font-medium text-accion hover:underline">
        Ver en el Monitor <ArrowRight size={13} className="inline" aria-hidden="true" />
      </Link>
    </div>
  )

  const fullHref = (kind === 'driver' ? driverHref : assetHref)(id, variant === 'dialog' ? currentUrl() : undefined)
  const content = (
    <div className="space-y-4 p-4 md:p-6">
      {variant === 'dialog' ? (
        <Link href={fullHref} prefetch={false} className="inline-flex items-center gap-1 text-dato font-medium text-accion hover:underline">
          Abrir ficha completa <ArrowRight size={13} aria-hidden="true" />
        </Link>
      ) : (
        <nav aria-label="Ruta" className="flex items-center gap-1.5 text-xs text-informativo">
          {back
            ? <Link href={back.href} className="hover:text-accion">{back.label}</Link>
            : <>Directorio <span aria-hidden>›</span> <Link href={LIST[kind].href} className="hover:text-accion">{LIST[kind].label}</Link></>}
          <span aria-hidden>›</span> <span className="font-semibold text-text-primary">{title}</span>
        </nav>
      )}
      <ProfileHeader title={title} chips={chips} reason={reason} onSeeDocuments={() => setTab('documentos')}
                     primaryAction={primaryAction} menuItems={menuItems} />
      {notice && <p role="status" className="text-dato text-resuelto">{notice}</p>}
      {actionError && <p role="alert" className="text-dato text-status-incidente">{actionError}</p>}

      <Tabs label={`Secciones del ${LIST[kind].noun}`} tabs={sectionTabs} value={tab} onChange={setTab} />

      {tab === 'resumen' && (
        <DetailsBlock rows={rows} canEdit={canEdit} footer={footer}
          renderForm={close => kind === 'driver'
            ? <DriverEditForm driver={driver!} onSave={patch} onClose={close} />
            : <AssetEditForm asset={asset!} carrierId={carrierId} drivers={carrierDriversQuery.data ?? []} onSave={patch} onClose={close} />} />
      )}
      {tab === 'documentos' && (
        <EntityDocuments entityType={kind === 'driver' ? 'DRIVER' : 'ASSET'} entityId={id} carrierId={carrierId} />
      )}
      {tab === 'contactos' && kind === 'driver' && <DriverContacts driverId={id} canEdit={canEdit} canDelete={canAdmin} />}

      <TransferModal
        open={modal === 'transfer'}
        title={`${carrierId ? 'Transferir' : 'Asignar'} ${LIST[kind].noun} ${title}`}
        currentCarrierId={carrierId}
        onClose={() => setModal(null)}
        onTransfer={async (toCarrierId, toCarrierName) => {
          if (kind === 'driver') await carriersApi.assignDriver(toCarrierId, id)
          else await carriersApi.assignAsset(toCarrierId, id)
          await afterChange({ entity: kind, id, type: 'assignment', carrierIds: [carrierId, toCarrierId] }, `Listo: quedó en ${toCarrierName}.`)
          setModal(null)
        }}
      />
      {modal === 'identity' && (
        <CorrectIdentityModal
          field={kind === 'driver' ? 'RUT' : 'patente'}
          current={kind === 'driver' ? driver!.tax_id : asset!.license_plate}
          hint={kind === 'driver'
            ? 'El RUT viejo queda en la auditoría.'
            : 'Es el mismo equipo: la patente anterior queda como alias, y los viajes que lleguen con ella lo siguen encontrando.'}
          onClose={() => setModal(null)}
          onConfirm={async (value, reason) => {
            if (kind === 'driver') await driversApi.correctRut(id, value, reason)
            else await assetsApi.correctPlate(id, value, reason)
            await afterChange({ entity: kind, id, type: 'update' })
          }}
        />
      )}
      {modal === 'baja' && (
        <BajaReasonModal label={`${LIST[kind].noun} ${title}`} onClose={() => setModal(null)}
                         onConfirm={() => patch({ operational_status: 'INACTIVE' })} />
      )}
      <ConfirmarBaja
        abierto={modal === 'remove'}
        variant="remove"
        nombreSujeto={title}
        nombreEmpresa={summary?.carrier?.name ?? 'esta empresa'}
        onCancelar={() => setModal(null)}
        onConfirmar={async () => {
          if (!carrierId) return
          if (kind === 'driver') await carriersApi.unassignDriver(carrierId, id)
          else await carriersApi.unassignAsset(carrierId, id)
          await afterChange({ entity: kind, id, type: 'assignment', carrierIds: [carrierId] })
          setModal(null)
        }}
      />
    </div>
  )

  return variant === 'dialog'
    ? <DetailShell variant="dialog" label={`${LIST[kind].noun} ${title}`} onClose={onClose}>
        <div className="min-w-0 flex-1 overflow-y-auto">{content}</div>
      </DetailShell>
    : content
}

/** La URL desde la que se abrió el modal: la ficha completa vuelve ahí. */
function currentUrl(): string {
  return typeof window === 'undefined' ? '' : `${window.location.pathname}${window.location.search}`
}

/** "desde 20/09 · antes Riquelme Hnos.": dónde trabaja, dentro de Detalles
 *  (app.fleet_assignment_periods, D2). El historial empieza con D2: lo anterior
 *  es un período sin fecha de inicio. */
function historyLine(history: AssignmentPeriod[] | undefined): string | null {
  if (!history || history.length === 0) return null
  const current = history.find(p => p.current)
  const previous = history.find(p => !p.current)
  const parts = [
    current?.valid_from ? `desde ${diaMes(current.valid_from)}` : null,
    previous ? `antes ${previous.carrier_name}` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

/** Actividad: un resumen que lleva al Monitor, no una copia de su tabla. */
function activityLine(activity: EntityActivity | undefined): ReactNode {
  if (!activity) return <span className="text-informativo">Cargando…</span>
  if (!activity.last_trip_date) return <span className="text-informativo">Sin viajes</span>
  return (
    <>
      <span className="text-informativo">Último viaje</span> {diaMes(activity.last_trip_date)}
      {activity.last_trip_client ? ` · ${activity.last_trip_client}` : ''} ·{' '}
      <span className="font-semibold tabular-nums">{activity.trips_30d}</span> <span className="text-informativo">en 30 días</span>
    </>
  )
}
