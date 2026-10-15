'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Building2 } from 'lucide-react'
import { driversApi, type DriverPatchBody } from '@/lib/api/drivers'
import { assetsApi, type AssetPatchBody } from '@/lib/api/assets'
import { carriersApi } from '@/lib/api/carriers'
import { usePermiso } from '@/lib/authz/PermisosProvider'
import { CLOSURE_NOTICE, directoryKeys, invalidateDirectory, type DirectoryChange } from '@/lib/queries/directorio'
import { carrierHref, returnLink } from '@/lib/navegacion/directory'
import { monitorSearchHref } from '@/lib/navegacion/viaje'
import { fmtDate } from '@/lib/utils/datetime'
import { DriverDetailPanel } from './DriverDetailPanel'
import { VehicleDetailPanel } from './VehicleDetailPanel'
import { TransferModal } from './TransferModal'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'
import { Estado } from '@/components/ui/Estado'
import { StatusChip } from '@/components/ui/StatusChip'
import { Tabs, type TabOption } from '@/components/ui/Tabs'
import { fleetMemberStyle } from '@/lib/states'
import type { AssignmentPeriod, EntityActivity } from '@/lib/types'

export type FleetKind = 'driver' | 'asset'

/** Las pestañas de la maqueta aprobada (Entrega C): Resumen · Documentos · Dónde
 *  trabaja · Actividad · Contactos. El equipo no tiene contactos. */
export type ProfileTab = 'resumen' | 'documentos' | 'historial' | 'actividad' | 'contactos'

function profileTabs(kind: FleetKind): TabOption<ProfileTab>[] {
  return [
    { id: 'resumen', label: 'Resumen' },
    { id: 'documentos', label: 'Documentos' },
    { id: 'historial', label: 'Dónde trabaja' },
    { id: 'actividad', label: 'Actividad' },
    ...(kind === 'driver' ? [{ id: 'contactos' as const, label: 'Contactos' }] : []),
  ]
}

const LIST = {
  driver: { href: '/dashboard/drivers', label: 'Conductores', noun: 'conductor' },
  asset:  { href: '/dashboard/assets',  label: 'Equipos',     noun: 'equipo' },
} as const

/**
 * La ficha propia de un conductor o un equipo (D4, Entrega C 14/10). Es el mismo
 * panel que se abre sobre la ficha de su empresa, en su variante página, más lo
 * que solo tiene sentido aquí: dónde trabajó y qué hizo. Existe aunque no tenga
 * empresa: antes eso era un callejón sin salida.
 */
export function FleetProfile({ kind, id }: { kind: FleetKind; id: string }) {
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const back = returnLink(searchParams.get('next'))
  const tabs = profileTabs(kind)
  const requestedTab = searchParams.get('tab')
  const [tab, setTab] = useState<ProfileTab>(tabs.find(t => t.id === requestedTab)?.id ?? 'resumen')
  const [transferOpen, setTransferOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const canEdit = usePermiso('directory.edit')
  const canAdmin = usePermiso('directory.delete')
  const canRequestDocuments = usePermiso('certification.request')
  const canCorrectIdentity = usePermiso('directory.identity')
  const canChangeFleetStatus = usePermiso('directory.fleet_status')
  const canUploadDocuments = usePermiso('documents.upload')
  const canReviewDocuments = usePermiso('documents.review')

  const driverQuery = useQuery({
    queryKey: directoryKeys.driverDetail(id), queryFn: () => driversApi.get(id), enabled: kind === 'driver', retry: false,
  })
  const assetQuery = useQuery({
    queryKey: directoryKeys.assetDetail(id), queryFn: () => assetsApi.get(id), enabled: kind === 'asset', retry: false,
  })
  const historyQuery = useQuery({
    queryKey: directoryKeys.assignments(kind, id),
    queryFn: () => (kind === 'driver' ? driversApi.assignments(id) : assetsApi.assignments(id)),
  })
  const activityQuery = useQuery({
    queryKey: directoryKeys.activity(kind, id),
    queryFn: () => (kind === 'driver' ? driversApi.activity(id) : assetsApi.activity(id)),
  })
  const current = historyQuery.data?.find(p => p.current) ?? null
  const carrierId = current?.carrier_id ?? null
  // El conductor habitual de un tracto se elige entre los conductores de su empresa.
  const carrierDriversQuery = useQuery({
    queryKey: directoryKeys.carrierDrivers(carrierId ?? ''),
    queryFn: () => carriersApi.listDrivers(carrierId!),
    enabled: kind === 'asset' && !!carrierId,
  })

  const entity = kind === 'driver' ? driverQuery : assetQuery
  if (entity.isError) {
    const notFound = (entity.error as { status?: number }).status === 404
    return notFound
      ? <Estado tipo="vacio" titulo="No se encontró en el directorio" />
      : <Estado tipo="error" titulo={`No se pudo abrir el ${LIST[kind].noun}`} detalle="Reintenta en unos segundos." />
  }
  if (!entity.data || historyQuery.isPending) return <Estado tipo="cargando" />

  const title = kind === 'driver' ? driverQuery.data!.full_name : assetQuery.data!.license_plate
  const lifecycle = fleetMemberStyle(kind, entity.data.operational_status, current?.carrier_status)
  const monitorQuery = kind === 'driver' ? driverQuery.data!.tax_id : assetQuery.data!.license_plate

  async function afterChange(change: DirectoryChange, done?: string) {
    const { affectsClosure } = await invalidateDirectory(queryClient, change)
    setNotice([done, affectsClosure ? CLOSURE_NOTICE : null].filter(Boolean).join(' ') || null)
  }
  async function handleRemove() {
    if (!carrierId) return
    if (kind === 'driver') await carriersApi.unassignDriver(carrierId, id)
    else await carriersApi.unassignAsset(carrierId, id)
    await afterChange({ entity: kind, id, type: 'assignment', carrierIds: [carrierId] })
  }
  async function handleTransfer(toCarrierId: string, toCarrierName: string) {
    if (kind === 'driver') await carriersApi.assignDriver(toCarrierId, id)
    else await carriersApi.assignAsset(toCarrierId, id)
    await afterChange(
      { entity: kind, id, type: 'assignment', carrierIds: [carrierId, toCarrierId] },
      `Listo: quedó en ${toCarrierName}.`,
    )
    setTransferOpen(false)
  }

  const shared = {
    carrierId, carrierName: current?.carrier_name, variant: 'page' as const, canEdit, canChangeFleetStatus,
    canUploadDocuments, canReviewDocuments, canRequestDocuments, canCorrectIdentity,
    onRemove: carrierId ? handleRemove : undefined,
    onTransferClick: canEdit ? () => setTransferOpen(true) : undefined,
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <nav aria-label="Ruta" className="text-xs text-informativo flex items-center gap-1.5">
        {back
          ? <Link href={back.href} className="hover:text-accion">{back.label}</Link>
          : <>Directorio <span aria-hidden>›</span> <Link href={LIST[kind].href} className="hover:text-accion">{LIST[kind].label}</Link></>}
        <span aria-hidden>›</span> <span className="text-text-primary font-semibold">{title}</span>
      </nav>
      <EncabezadoDePagina
        titulo={title}
        bajada={
          <span className="flex flex-wrap items-center gap-2">
            <StatusChip tone={lifecycle.tone} icon={lifecycle.icon}>{lifecycle.label}</StatusChip>
            {current && (
              <Link href={carrierHref(current.carrier_id)} prefetch={false} className="inline-flex items-center gap-1 text-informativo hover:text-accion">
                <Building2 size={13} /> {current.carrier_name}
              </Link>
            )}
          </span>
        }
      />
      {notice && <p role="status" className="text-xs text-resuelto">{notice}</p>}

      <Tabs label={`Secciones del ${LIST[kind].noun}`} tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'historial' && <WhereWorks history={historyQuery.data ?? []} />}
      {tab === 'actividad' && (
        <Activity activity={activityQuery.data} loading={activityQuery.isPending} monitorHref={monitorSearchHref(monitorQuery)} />
      )}

      {tab !== 'historial' && tab !== 'actividad' && (kind === 'driver' ? (
        <DriverDetailPanel
          {...shared}
          section={tab}
          driver={driverQuery.data!}
          canDeleteContacts={canAdmin}
          onPatch={async (driverId: string, body: DriverPatchBody) => {
            await driversApi.patch(driverId, body)
            await afterChange({ entity: 'driver', id: driverId, type: 'update', carrierIds: [carrierId] })
          }}
        />
      ) : (
        <VehicleDetailPanel
          {...shared}
          section={tab === 'contactos' ? 'resumen' : tab}
          asset={assetQuery.data!}
          drivers={carrierDriversQuery.data ?? []}
          onPatch={async (assetId: string, body: AssetPatchBody) => {
            await assetsApi.patch(assetId, body)
            await afterChange({ entity: 'asset', id: assetId, type: 'update', carrierIds: [carrierId] })
          }}
        />
      ))}

      <TransferModal
        open={transferOpen}
        title={`${carrierId ? 'Transferir' : 'Asignar'} ${LIST[kind].noun} ${title}`}
        currentCarrierId={carrierId}
        onClose={() => setTransferOpen(false)}
        onTransfer={handleTransfer}
      />
    </div>
  )
}

/** Dónde trabaja: la empresa de hoy y las anteriores (app.fleet_assignment_periods, D2). */
function WhereWorks({ history }: { history: AssignmentPeriod[] }) {
  return (
    <section className="rounded-xl border border-border p-4">
      <h3 className="text-etiqueta font-bold text-informativo uppercase tracking-wide mb-2">Dónde trabaja</h3>
      {history.length === 0 ? (
        <p className="text-dato text-warning">Sin empresa asignada.</p>
      ) : (
        <ul className="space-y-1.5">
          {history.map(p => (
            <li key={`${p.carrier_id}-${p.valid_from}`} className="flex items-center gap-2 text-dato">
              <Building2 size={13} className="text-informativo shrink-0" />
              <Link href={carrierHref(p.carrier_id)} prefetch={false} className={`hover:text-accion ${p.current ? 'font-semibold text-text-primary' : 'text-informativo'}`}>
                {p.carrier_name}
              </Link>
              <span className="text-informativo text-xs">{periodLabel(p)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function periodLabel(p: AssignmentPeriod): string {
  // El historial empieza con D2: lo anterior es un período sin fecha de inicio.
  const from = p.valid_from ? fmtDate(p.valid_from) : null
  if (p.current) return from ? `desde ${from}` : 'actual'
  const until = p.valid_until ? fmtDate(p.valid_until) : ''
  return from ? `${from} – ${until}` : `hasta ${until}`
}

/** Actividad: un resumen que enlaza al Monitor, no una copia de su tabla (patrón Samsara/Fleetio). */
function Activity({ activity, loading, monitorHref }: { activity?: EntityActivity; loading: boolean; monitorHref: string }) {
  return (
    <section className="rounded-xl border border-border p-4">
      <h3 className="text-etiqueta font-bold text-informativo uppercase tracking-wide mb-2">Actividad</h3>
      {loading || !activity ? (
        <p className="text-dato text-informativo">Cargando…</p>
      ) : (
        <div className="space-y-1 text-dato">
          <p>
            Último viaje:{' '}
            {activity.last_trip_date
              ? <span className="font-semibold">{fmtDate(activity.last_trip_date)}{activity.last_trip_client ? ` · ${activity.last_trip_client}` : ''}</span>
              : <span className="text-informativo">sin viajes</span>}
          </p>
          <p>Viajes en los últimos 30 días: <span className="font-semibold tabular-nums">{activity.trips_30d}</span></p>
        </div>
      )}
      <Link href={monitorHref} prefetch={false} className="mt-2 inline-flex items-center gap-1 text-dato font-semibold text-accion hover:underline">
        Ver viajes en el Monitor <ArrowRight size={13} />
      </Link>
    </section>
  )
}
