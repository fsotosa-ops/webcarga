'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { PanelLateral } from '@/components/ui/PanelLateral'
import { Section } from '@/components/ui/Section'
import { KeyValueList } from '@/components/ui/KeyValueList'
import { StatusChip } from '@/components/ui/StatusChip'
import { DocumentStatusBar } from '@/components/ui/DocumentStatusBar'
import { Estado } from '@/components/ui/Estado'
import {
  entitySummaryKey, fetchEntitySummary,
  type AssetSummary, type CarrierSummary, type DriverSummary, type EntityKind,
} from '@/lib/api/entitySummary'
import { enablementStyle, fleetMemberStyle, isCarrierDeactivated, summaryStyle } from '@/lib/states'
import { assetHref, carrierHref, driverHref } from '@/lib/navegacion/directory'
import type { QuickViewTarget } from '@/lib/quickView'
import { getInitials } from '@/lib/utils/avatar'

const NOUN: Record<EntityKind, string> = { carrier: 'empresa', driver: 'conductor', asset: 'equipo' }
const KIND_LABEL: Record<EntityKind, string> = { carrier: 'Empresa', driver: 'Conductor', asset: 'Equipo' }
const ASSET_TYPE: Record<string, string> = { TRACTOCAMION: 'Tractocamión', RAMPLA: 'Rampla' }
const FULL_PAGE: Record<EntityKind, (id: string, returnTo?: string) => string> = {
  carrier: carrierHref, driver: driverHref, asset: assetHref,
}

interface EntityQuickViewProps {
  target:     QuickViewTarget
  canGoBack:  boolean
  /** Un nombre dentro del panel: cambia el panel a esa entidad. */
  onNavigate: (target: QuickViewTarget) => void
  onBack:     () => void
  onClose:    () => void
  /** Adónde vuelve la ficha completa (la URL del Cierre). */
  returnTo?:  string
}

/** La vista rápida de una empresa, un conductor o un equipo: un panel lateral de
 *  solo lectura que deja ver el Cierre detrás (HU 20261011/01; patrón de Linear,
 *  Samsara y Salesforce Quick View). La variante sale de `target.kind`. */
export function EntityQuickView({ target, canGoBack, onNavigate, onBack, onClose, returnTo }: EntityQuickViewProps) {
  const query = useQuery({
    queryKey: entitySummaryKey(target.kind, target.id),
    queryFn: () => fetchEntitySummary(target.kind, target.id),
    retry: false,
  })

  const title = (
    <span className="flex items-center gap-2 font-normal">
      {canGoBack && (
        <button type="button" onClick={onBack} aria-label="Volver"
                className="inline-flex items-center gap-1 text-dato font-semibold text-accion hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded">
          <ArrowLeft size={14} aria-hidden="true" />Volver
        </button>
      )}
      <span className="text-etiqueta text-informativo">{KIND_LABEL[target.kind]} · vista rápida</span>
    </span>
  )

  // La ficha de un conductor o equipo vive dentro de la de su empresa: sin
  // empresa no hay ficha a la que ir. Mientras carga no se sabe, y no se ofrece.
  const data = query.data
  const fullPage = target.kind === 'carrier' ? 'available'
    : !data ? 'unknown'
      : (data as DriverSummary | AssetSummary).carrier ? 'available' : 'none'

  const footer = (
    <div className="flex items-center gap-3">
      {fullPage === 'available' && (
        <Link href={FULL_PAGE[target.kind](target.id, returnTo)}
              className="rounded-md bg-accent px-3.5 py-2 text-dato font-semibold text-white hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          Abrir ficha completa
        </Link>
      )}
      {fullPage === 'none' && (
        <span className="text-dato text-informativo">Sin empresa asignada: no tiene ficha propia.</span>
      )}
      {/* En el teléfono no hay Esc: ahí se cierra con la ✕ de arriba. */}
      <span className="ml-auto hidden text-etiqueta text-informativo md:inline">Esc para cerrar</span>
    </div>
  )

  return (
    <PanelLateral titulo={title} label={`${KIND_LABEL[target.kind]} ${target.label}`} onCerrar={onClose} pie={footer} overlay="none">
      <Body target={target} query={query} onNavigate={onNavigate} />
    </PanelLateral>
  )
}

type SummaryQuery = ReturnType<typeof useQuery<DriverSummary | AssetSummary | CarrierSummary>>

function Body({ target, query, onNavigate }: {
  target: QuickViewTarget; query: SummaryQuery; onNavigate: (t: QuickViewTarget) => void
}) {
  if (query.isError) {
    const notFound = (query.error as { status?: number }).status === 404
    return notFound
      ? <Estado tipo="vacio" titulo="No se encontró en el directorio" />
      : (
        <Estado tipo="error" titulo={`No se pudo cargar la información del ${NOUN[target.kind]}.`} detalle="El Cierre no cambió.">
          <button type="button" onClick={() => query.refetch()}
                  className="rounded-md border border-border bg-white px-3 py-1.5 text-dato font-semibold text-text-primary hover:bg-bg-main">
            Reintentar
          </button>
        </Estado>
      )
  }

  const data = query.data
  return (
    <div>
      <Identity target={target} data={data} />
      {!data ? <LoadingSections /> : (
        target.kind === 'driver' ? <DriverSections data={data as DriverSummary} onNavigate={onNavigate} />
          : target.kind === 'asset' ? <AssetSections data={data as AssetSummary} onNavigate={onNavigate} />
            : <CarrierSections data={data as CarrierSummary} />
      )}
    </div>
  )
}

function isActive(status: string | undefined) {
  return status === 'ACTIVE'
}

/** Quién es: se dibuja al instante con lo que trae la fila, y se completa al llegar los datos. */
function Identity({ target, data }: { target: QuickViewTarget; data?: DriverSummary | AssetSummary | CarrierSummary }) {
  const name = !data ? target.label
    : target.kind === 'driver' ? (data as DriverSummary).full_name
      : target.kind === 'asset' ? (data as AssetSummary).license_plate
        : (data as CarrierSummary).business_name
  const subtitle = !data ? null
    : target.kind === 'asset'
      ? [ASSET_TYPE[(data as AssetSummary).asset_type] ?? (data as AssetSummary).asset_type,
         (data as AssetSummary).manufacture_year].filter(Boolean).join(' · ')
      : (data as DriverSummary | CarrierSummary).tax_id ? `RUT ${(data as DriverSummary | CarrierSummary).tax_id}` : null

  return (
    <div className="flex items-start gap-3 pb-4">
      <span aria-hidden="true"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent/15 text-dato font-bold text-accent">
        {getInitials(name)}
      </span>
      <div className="min-w-0">
        <h2 className={`text-lectura font-bold leading-snug text-text-primary ${target.kind === 'asset' ? 'font-identificador tabular-nums' : ''}`}>
          {name}
        </h2>
        {subtitle && <p className="text-dato text-informativo tabular-nums">{subtitle}</p>}
        {data && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {target.kind === 'asset' && (data as AssetSummary).operation_type && (
              <StatusChip tone="action">{(data as AssetSummary).operation_type}</StatusChip>
            )}
            {(() => {
              const carrierStatus = target.kind === 'carrier' ? null : (data as DriverSummary | AssetSummary).carrier?.operational_status
              const life = fleetMemberStyle(target.kind, data.operational_status, carrierStatus)
              const active = isActive(data.operational_status) && !isCarrierDeactivated(carrierStatus)
              const second = target.kind === 'carrier'
                ? enablementStyle(data.compliance_summary, active)
                : summaryStyle(data.compliance_summary, active)
              return (<>
                <StatusChip tone={life.tone} icon={life.icon}>{life.label}</StatusChip>
                <StatusChip tone={second.tone} icon={second.icon}>{second.label}</StatusChip>
              </>)
            })()}
          </div>
        )}
      </div>
    </div>
  )
}

function LoadingSections() {
  return (
    <div role="status" aria-label="Cargando">
      {['Dónde trabaja', 'Documentación'].map(title => (
        <Section key={title} title={title}>
          <div className="space-y-2" aria-hidden="true">
            <div className="h-3 w-4/5 animate-pulse rounded bg-border" />
            <div className="h-3 w-3/5 animate-pulse rounded bg-border" />
          </div>
        </Section>
      ))}
    </div>
  )
}

/** Un nombre que cambia el panel a esa entidad: azul, porque se puede hacer clic. */
function EntityButton({ target, onNavigate, mono = false }: {
  target: QuickViewTarget; onNavigate: (t: QuickViewTarget) => void; mono?: boolean
}) {
  return (
    <button type="button" onClick={() => onNavigate(target)} aria-label={`Ver ${NOUN[target.kind]} ${target.label}`}
            className={`text-left text-accion underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded ${mono ? 'font-identificador tabular-nums' : ''}`}>
      {target.label}
    </button>
  )
}

function Missing({ children }: { children: ReactNode }) {
  return <span className="text-informativo">{children}</span>
}

function Phone({ phone }: { phone: string | null }) {
  if (!phone) return <Missing>Sin teléfono</Missing>
  return (
    <a href={`tel:${phone.replace(/\s+/g, '')}`}
       className="text-accion tabular-nums underline decoration-dotted underline-offset-2 hover:decoration-solid">
      {phone}
    </a>
  )
}

function InactiveNotice({ noun }: { noun: string }) {
  return (
    <p className="mt-3 rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-dato text-warning">
      Este {noun} está de baja. Para que vuelva a operar, reactívalo desde su ficha.
    </p>
  )
}

function DriverSections({ data, onNavigate }: { data: DriverSummary; onNavigate: (t: QuickViewTarget) => void }) {
  return (
    <>
      <Section title="Dónde trabaja">
        <KeyValueList items={[
          { label: 'Empresa', value: data.carrier
            ? <EntityButton target={{ kind: 'carrier', id: data.carrier.id, label: data.carrier.name }} onNavigate={onNavigate} />
            : <Missing>Sin empresa asignada</Missing> },
          { label: 'Origen habitual', value: data.home_location
            ? [data.home_location.name, data.home_location.shipper].filter(Boolean).join(' · ')
            : <Missing>Sin origen habitual</Missing> },
          { label: 'Tracto habitual', value: data.usual_tractor
            ? <EntityButton target={{ kind: 'asset', id: data.usual_tractor.id, label: data.usual_tractor.plate }} onNavigate={onNavigate} mono />
            : <Missing>Sin tracto habitual</Missing> },
        ]} />
        {!isActive(data.operational_status) && <InactiveNotice noun="conductor" />}
      </Section>
      <Section title="Contacto">
        <KeyValueList items={[{ label: 'Teléfono', value: <Phone phone={data.phone} /> }]} />
      </Section>
      <Section title="Documentación"><DocumentStatusBar documents={data.documents} counts={data.compliance_summary.own} /></Section>
    </>
  )
}

function AssetSections({ data, onNavigate }: { data: AssetSummary; onNavigate: (t: QuickViewTarget) => void }) {
  return (
    <>
      <Section title="Dónde trabaja">
        <KeyValueList items={[
          { label: 'Empresa', value: data.carrier
            ? <EntityButton target={{ kind: 'carrier', id: data.carrier.id, label: data.carrier.name }} onNavigate={onNavigate} />
            : <Missing>Sin empresa asignada</Missing> },
          { label: 'Conductor habitual', value: data.usual_driver
            ? <EntityButton target={{ kind: 'driver', id: data.usual_driver.id, label: data.usual_driver.name }} onNavigate={onNavigate} />
            : <Missing>Sin conductor habitual</Missing> },
        ]} />
        {!isActive(data.operational_status) && <InactiveNotice noun="equipo" />}
      </Section>
      <Section title="Documentación"><DocumentStatusBar documents={data.documents} counts={data.compliance_summary.own} /></Section>
    </>
  )
}

function CarrierSections({ data }: { data: CarrierSummary }) {
  const contact = data.primary_contact
  return (
    <>
      <Section title="Para quién trabaja">
        {data.shippers.length === 0 ? <p className="text-dato"><Missing>Sin clientes vinculados</Missing></p> : (
          <ul className="flex flex-wrap gap-1.5">
            {data.shippers.map(s => <li key={s.id}><StatusChip tone="neutral">{s.name}</StatusChip></li>)}
          </ul>
        )}
      </Section>
      <Section title="Dotación">
        <KeyValueList items={[
          { label: 'Conductores', value: `${data.active_drivers} ${data.active_drivers === 1 ? 'activo' : 'activos'}` },
          { label: 'Equipos', value: `${data.active_assets} ${data.active_assets === 1 ? 'activo' : 'activos'}` },
        ]} />
        {!isActive(data.operational_status) && (
          <p className="mt-3 rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-dato text-warning">
            Esta empresa está de baja. Para que vuelva a operar, reactívala desde su ficha.
          </p>
        )}
      </Section>
      <Section title="Contacto">
        <KeyValueList items={[{
          label: 'Principal',
          value: !contact ? <Missing>Sin contacto</Missing> : (
            <span>{contact.name ?? 'Sin nombre'}{contact.phone && <> · <Phone phone={contact.phone} /></>}</span>
          ),
        }]} />
      </Section>
      <Section title="Documentación de la empresa">
        <DocumentStatusBar documents={data.documents} counts={data.compliance_summary.own} fleet={data.compliance_summary.fleet} />
      </Section>
    </>
  )
}
