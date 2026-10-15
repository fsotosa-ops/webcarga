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
import { Estado } from '@/components/ui/Estado'
import type { AssignmentPeriod, EntityActivity } from '@/lib/types'

export type FleetKind = 'driver' | 'asset'

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
  const back = returnLink(useSearchParams().get('next'))
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

  const extra = (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-6">
      <WhereWorks history={historyQuery.data ?? []} />
      <Activity activity={activityQuery.data} loading={activityQuery.isPending} monitorHref={monitorSearchHref(monitorQuery)} />
    </div>
  )
  const shared = {
    carrierId, carrierName: current?.carrier_name, variant: 'page' as const, extra, canEdit, canChangeFleetStatus,
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
      {notice && <p role="status" className="text-xs text-resuelto">{notice}</p>}

      {kind === 'driver' ? (
        <DriverDetailPanel
          {...shared}
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
          asset={assetQuery.data!}
          drivers={carrierDriversQuery.data ?? []}
          onPatch={async (assetId: string, body: AssetPatchBody) => {
            await assetsApi.patch(assetId, body)
            await afterChange({ entity: 'asset', id: assetId, type: 'update', carrierIds: [carrierId] })
          }}
        />
      )}

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
