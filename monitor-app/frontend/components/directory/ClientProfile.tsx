'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Ban, CircleCheck, Loader2, Pencil } from 'lucide-react'
import { shippersApi, type ShipperPatch, type ShipperRow } from '@/lib/api/locations'
import { ApiError } from '@/lib/api/client'
import { usePermiso } from '@/lib/authz/PermisosProvider'
import { clientKeys, invalidateClients } from '@/lib/queries/clientes'
import { CLIENTS, clientHref, returnLink } from '@/lib/navegacion/directory'
import { monitorClientHref } from '@/lib/navegacion/viaje'
import { lifecycleStyle } from '@/lib/states'
import { formatCount as cifra, placesLabel } from '@/lib/clients'
import { useTransporters } from '@/hooks/useTransporters'
import { Estado } from '@/components/ui/Estado'
import { Tabs } from '@/components/ui/Tabs'
import { PanelLateral } from '@/components/ui/PanelLateral'
import type { ActionsMenuItem } from '@/components/ui/ActionsMenu'
import { ProfileHeader } from '@/components/directory/ProfileHeader'
import { ProfileBreadcrumb } from '@/components/directory/ProfileBreadcrumb'
import { AsidePanel, ProfileLayout } from '@/components/directory/ProfileLayout'
import { DetailsBlock } from '@/components/directory/DetailsBlock'
import { CarriersTable } from '@/components/directory/CarriersTable'
import { TmsClientLinks } from '@/components/directory/TmsClientLinks'
import { ClientNamePanel } from '@/components/directory/ClientNamePanel'
import { LocationsBrowser, NO_LOCATION_FILTERS, type LocationFilters } from '@/components/dashboard/LocationsBrowser'
import { PageContainer } from '@/components/ui/PageContainer'
import { GestionDeclarada } from '@/components/compliance/GestionDeclarada'

type Section = 'lugares' | 'empresas'

/**
 * La ficha de un cliente (Configuración, Parte 3): sus lugares de carga (la
 * lista del Tarifario, con Origen), las empresas que lo atienden (la tabla del
 * Directorio) y, al costado, sus datos y cómo lo llaman los TMS. Con
 * `commercial.edit` se cambia el nombre y se desactiva o reactiva; sin él, se lee.
 */
export function ClientProfile({ id }: { id: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const qc = useQueryClient()
  const canEdit = usePermiso('commercial.edit')
  // Los tipos de operación deciden el alcance de sus viajes en el Cierre: son de Operaciones.
  const canEditOperationTypes = usePermiso('operations.configure')
  const [panel, setPanel] = useState<'name' | 'deactivate' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [locationFilters, setLocationFilters] = useState<LocationFilters>({ ...NO_LOCATION_FILTERS, shipperId: id })
  const section: Section = searchParams.get('tab') === 'empresas' ? 'empresas' : 'lugares'
  const back = returnLink(searchParams.get('next'))

  const client = useQuery({ queryKey: clientKeys.detail(id), queryFn: () => shippersApi.get(id), retry: false })

  async function patch(body: ShipperPatch) {
    await shippersApi.patch(id, body)
    await invalidateClients(qc)
  }

  async function reactivate() {
    setActionError(null)
    try {
      await patch({ status: 'ACTIVE' })
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'No se pudo guardar')
    }
  }

  function goTo(next: Section) {
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'lugares') params.delete('tab'); else params.set('tab', next)
    const s = params.toString()
    router.replace(s ? `${CLIENTS}/${id}?${s}` : `${CLIENTS}/${id}`, { scroll: false })
  }

  if (client.isError) {
    const notFound = client.error instanceof ApiError && client.error.status === 404
    return (
      <PageContainer>
        {notFound
          ? <Estado tipo="vacio" titulo="Este cliente no existe">
              <Link href={CLIENTS} className="text-dato font-medium text-accion hover:underline">Volver a Clientes</Link>
            </Estado>
          : <Estado tipo="error" titulo="No se pudo cargar el cliente" />}
      </PageContainer>
    )
  }
  if (client.isPending) return <Estado tipo="cargando" />

  const c = client.data
  const active = c.status === 'ACTIVE'
  const menuItems: ActionsMenuItem[] = canEdit ? [
    { id: 'name', label: 'Cambiar nombre', icon: Pencil, onSelect: () => setPanel('name') },
    active
      ? { id: 'deactivate', label: 'Desactivar cliente', icon: Ban, destructive: true, onSelect: () => setPanel('deactivate') }
      : { id: 'reactivate', label: 'Reactivar cliente', icon: CircleCheck, onSelect: () => { void reactivate() } },
  ] : []

  return (
    <PageContainer>
      <ProfileBreadcrumb module="Directorio" list={{ href: CLIENTS, label: 'Clientes' }} title={c.name} back={back} />
      <ProfileHeader
        title={c.name}
        chips={[lifecycleStyle('shipper', c.status)]}
        primaryAction={
          <Link href={monitorClientHref(id)} prefetch={false}
            className="inline-flex items-center gap-1 text-dato font-medium text-accion hover:underline">
            Ver en el Monitor <ArrowRight size={13} aria-hidden />
          </Link>
        }
        menuItems={menuItems}
      />
      {actionError && <p role="alert" className="text-dato text-status-incidente">{actionError}</p>}

      <Tabs label="Secciones del cliente" value={section} onChange={goTo} tabs={[
        { id: 'lugares', label: 'Lugares', count: c.locations },
        { id: 'empresas', label: 'Empresas', count: c.carriers },
      ]} />

      <ProfileLayout aside={<>
        <DetailsBlock canEdit={false} rows={[
          { label: 'Estado', value: lifecycleStyle('shipper', c.status).label },
          { label: 'Tipos de operación', value: (
            <span className="flex flex-col gap-0.5">
              <GestionDeclarada
                declarado={c.operation_types} canEdit={canEditOperationTypes}
                guardar={tipos => shippersApi.patch(id, { operation_types: tipos })}
                onGuardado={() => invalidateClients(qc)}
                vacio="Sin definir" nombre="los tipos de operación" />
              <span className="text-etiqueta text-informativo">
                {c.operation_types?.length === 1
                  ? 'Sus viajes cuentan con este tipo en el Cierre.'
                  : 'Cada viaje toma el tipo de su tracto.'}
              </span>
            </span>
          ) },
          { label: 'Lugares', value: placesLabel(c) },
          { label: 'Empresas', value: cifra(c.carriers) },
          { label: 'Viajes (30 días)', value: cifra(c.trips_30d) },
        ]} />
        <AsidePanel title="Cómo lo llaman los TMS">
          <TmsClientLinks shipperId={id} />
        </AsidePanel>
      </>}>
        {section === 'lugares'
          ? <LocationsBrowser filters={locationFilters} onFiltersChange={setLocationFilters} canEdit={canEdit}
              empty={{ titulo: 'Este cliente todavía no tiene lugares',
                       detalle: 'Llegan solos con los viajes del TMS, o se agregan en el Tarifario.' }} />
          : <ClientCarriers client={c} />}
      </ProfileLayout>

      {panel === 'name' && (
        <ClientNamePanel titulo="Cambiar nombre" accion="Guardar nombre" inicial={c.name}
          onGuardar={async name => { await patch({ name }); setPanel(null) }} onCerrar={() => setPanel(null)} />
      )}
      {panel === 'deactivate' && (
        <DeactivatePanel name={c.name} onDeactivate={() => patch({ status: 'INACTIVE' })} onClose={() => setPanel(null)} />
      )}
    </PageContainer>
  )
}

/** Confirmar la desactivación, diciendo qué pasa y qué no. El error se ve aquí,
 *  en el panel abierto, y el botón no se aprieta dos veces mientras guarda. */
function DeactivatePanel({ name, onDeactivate, onClose }: {
  name: string; onDeactivate: () => Promise<void>; onClose: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function deactivate() {
    setSaving(true)
    setError(null)
    try {
      await onDeactivate()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
      setSaving(false)
    }
  }
  return (
    <PanelLateral titulo={`Desactivar ${name}`} onCerrar={onClose} pie={
      <button type="button" onClick={() => { void deactivate() }} disabled={saving}
        className="inline-flex items-center gap-1.5 rounded-md bg-status-incidente px-3 py-1.5 text-dato font-semibold text-white hover:bg-status-incidente/90 disabled:opacity-50">
        {saving ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Ban size={12} aria-hidden />} Desactivar
      </button>
    }>
      <p className="text-dato text-text-primary">
        Deja de ofrecerse para vincular nombres del TMS. No se borran sus lugares, sus empresas ni sus viajes,
        y se puede reactivar.
      </p>
      {error && <p role="alert" className="mt-2 text-dato text-status-incidente">{error}</p>}
    </PanelLateral>
  )
}

/** Las empresas con vínculo activo a este cliente, con la tabla del Directorio. */
function ClientCarriers({ client }: { client: ShipperRow }) {
  const carriers = useTransporters({ shipper_id: client.id, limit: 100 })
  if (carriers.isError) return <Estado tipo="error" titulo="No se pudieron cargar las empresas" />
  if (carriers.isPending) return <Estado tipo="cargando" />
  if (carriers.data.data.length === 0) {
    return <Estado tipo="vacio" titulo="Ninguna empresa atiende todavía a este cliente"
      detalle="Se vincula desde la ficha de la empresa, en Clientes." />
  }
  return <CarriersTable items={carriers.data.data} returnTo={clientHref(client.id) + '?tab=empresas'} />
}
