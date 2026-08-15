'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { assetsApi } from '@/lib/api/assets'
import { carriersApi } from '@/lib/api/carriers'
import { complianceApi } from '@/lib/api/compliance'
import { driversApi } from '@/lib/api/drivers'
import { contactsApi } from '@/lib/api/contacts'
import { AddContactForm, ContactCard } from '@/components/dashboard/ContactCard'
import { InsuranceSummaryCard } from '@/components/dashboard/InsuranceSummaryCard'
import { useCanEdit } from '@/hooks/useCanEdit'
import { ChildrenList, type Hijo } from './ChildrenList'
import { DocumentList } from './DocumentList'
import { ZoomHeader, type Miga } from './ZoomHeader'
import type { ComplianceRecord } from '@/lib/types'

export type Seleccion = { tipo: 'CARRIER' | 'DRIVER' | 'ASSET'; id: string }

/** Lo que el panel necesita de un conductor o de un vehículo. */
type DetalleComun = {
  full_name?:    string
  license_plate?: string
  tax_id?:       string | null
  asset_type?:   string | null
  carrier_id:    string | null
  carrier_name:  string | null
}

interface Props {
  seleccion:     Seleccion | null
  onSeleccionar: (sel: Seleccion | null) => void
}

/** El detalle embebido — el mismo panel para los tres niveles.
 *
 *  La gramática no cambia con la distancia: quién es, cuánto le falta, qué
 *  tiene adentro y qué documentos son suyos. Bajar de nivel **cambia el panel,
 *  no la página**: por eso las migas y la flota son botones, no enlaces. */
export function EntityDetailPanel({ seleccion, onSeleccionar }: Props) {
  if (!seleccion) {
    return (
      <div className="flex items-center justify-center h-full min-h-[240px] p-6">
        <p className="text-xs text-gray-500 text-center max-w-[280px]">
          Selecciona una empresa, un conductor o un vehículo de la lista para ver
          su documentación aquí.
        </p>
      </div>
    )
  }

  return seleccion.tipo === 'CARRIER'
    ? <DetalleEmpresa id={seleccion.id} onSeleccionar={onSeleccionar} />
    : <DetalleEntidad tipo={seleccion.tipo} id={seleccion.id} onSeleccionar={onSeleccionar} />
}

function Cargando() {
  return (
    <p className="text-[11px] text-gray-500 p-4 flex items-center gap-1.5">
      <Loader2 size={12} className="motion-safe:animate-spin" /> Cargando…
    </p>
  )
}

function NoSePudo() {
  return (
    <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 m-4">
      No se pudo cargar este detalle. Puede que ya no exista.
    </p>
  )
}

function cuenta(records: ComplianceRecord[]) {
  const cubiertos = records.filter(
    r => r.status === 'APPROVED' || r.status === 'APPROVED_MANUAL',
  ).length
  return { cubiertos, total: records.length }
}

const ROLES_CONTACTO = ['LEGAL_REP', 'OPERATIONS', 'FINANCE', 'DOCUMENTS']

function DetalleEmpresa({ id, onSeleccionar }: { id: string; onSeleccionar: (s: Seleccion | null) => void }) {
  const canEdit = useCanEdit()
  const empresa = useQuery({ queryKey: ['carrier-detail', id], queryFn: () => carriersApi.get(id) })

  // La flota sale de la MISMA consulta que la lista transversal, acotada a
  // esta empresa: así el "N de M" de un conductor es idéntico desde los dos
  // lados. El roster no sirve — sólo trae un indicador OK/PENDIENTE.
  const conductores = useQuery({
    queryKey: ['certification-status', 'driver', id],
    queryFn: () => complianceApi.listStatus({ group: 'driver', carrierId: id, limit: 500 }),
  })
  const vehiculos = useQuery({
    queryKey: ['certification-status', 'asset', id],
    queryFn: () => complianceApi.listStatus({ group: 'asset', carrierId: id, limit: 500 }),
  })

  if (empresa.isPending) return <Cargando />
  if (empresa.error || !empresa.data) return <NoSePudo />

  const registros = (empresa.data.compliance_records ?? []) as ComplianceRecord[]
  const { cubiertos, total } = cuenta(registros)

  const flota: Hijo[] = [
    ...(conductores.data?.rows ?? []).map(r => ({
      id: r.entity_id, nombre: r.entity_name, tipo: 'DRIVER' as const,
      cubiertos: r.satisfied_count, total: r.total_count,
    })),
    ...(vehiculos.data?.rows ?? []).map(r => ({
      id: r.entity_id, nombre: r.entity_name, tipo: 'ASSET' as const,
      cubiertos: r.satisfied_count, total: r.total_count,
    })),
  ]

  return (
    <div className="p-4 space-y-5">
      <ZoomHeader
        migas={[{ label: 'Certificación', onIr: () => onSeleccionar(null) }, { label: empresa.data.business_name }]}
        titulo={empresa.data.business_name}
        subtitulo={empresa.data.tax_id}
        cubiertos={cubiertos}
        total={total}
      />

      <ChildrenList
        titulo="Su flota"
        filas={flota}
        onAbrir={(tipo, hijoId) => onSeleccionar({ tipo, id: hijoId })}
      />

      <section className="space-y-1.5">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Sus documentos</h3>
        <DocumentList
          records={registros}
          carrierId={id}
          entityType="CARRIER"
          entityId={id}
          onChanged={() => empresa.refetch()}
        />
      </section>

      {/* Seguros y Contactos eran dos tabs de la ficha. Son "lo suyo", igual
          que los documentos, así que van como secciones del mismo panel —
          plegadas, porque no son el trabajo diario. */}
      <Plegable titulo="Seguros">
        <InsuranceSummaryCard carrierId={id} taxId={empresa.data.tax_id} />
      </Plegable>

      <Plegable titulo={`Contactos (${empresa.data.contacts?.length ?? 0})`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {(empresa.data.contacts ?? []).map(c => (
            <ContactCard
              key={c.id}
              contact={c}
              canEdit={canEdit}
              onSaved={async patch => { await contactsApi.patch(c.id, patch); empresa.refetch() }}
              onDeleted={async () => { await contactsApi.delete(c.id); empresa.refetch() }}
            />
          ))}
          {canEdit && (
            <AddContactForm
              roleOptions={ROLES_CONTACTO}
              onAdd={async body => { await carriersApi.createContact(id, body); empresa.refetch() }}
            />
          )}
          {!(empresa.data.contacts ?? []).length && !canEdit && (
            <p className="text-[11px] text-gray-500">Sin contactos registrados</p>
          )}
        </div>
      </Plegable>
    </div>
  )
}

/** Secciones que no son el trabajo diario: están, pero no ocupan la vista. */
function Plegable({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <section className="border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setAbierto(v => !v)}
        aria-expanded={abierto}
        className="w-full flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 hover:text-accent transition-colors cursor-pointer"
      >
        <ChevronDown size={12} className={`transition-transform ${abierto ? 'rotate-180' : ''}`} />
        {titulo}
      </button>
      {abierto && <div className="mt-2">{children}</div>}
    </section>
  )
}

function DetalleEntidad({ tipo, id, onSeleccionar }: {
  tipo: 'DRIVER' | 'ASSET'; id: string; onSeleccionar: (s: Seleccion | null) => void
}) {
  const esConductor = tipo === 'DRIVER'

  // El tipo de retorno difiere entre conductor y vehículo; lo que este panel
  // necesita es el subconjunto común, así que se unifica acá.
  const entidad = useQuery<DetalleComun>({
    queryKey: [esConductor ? 'driver-detail' : 'asset-detail', id],
    queryFn: async () => (esConductor
      ? await driversApi.get(id)
      : await assetsApi.get(id)) as unknown as DetalleComun,
  })
  const documentos = useQuery({
    queryKey: [esConductor ? 'driver-compliance-records' : 'asset-compliance-records', id],
    queryFn: () => (esConductor
      ? driversApi.listComplianceRecords(id)
      : assetsApi.listComplianceRecords(id)),
  })

  if (entidad.isPending) return <Cargando />
  if (entidad.error || !entidad.data) return <NoSePudo />

  const datos = entidad.data
  const titulo = (esConductor ? datos.full_name : datos.license_plate) ?? '—'
  const registros = (documentos.data ?? []) as ComplianceRecord[]
  const { cubiertos, total } = cuenta(registros)

  // La empresa sale del propio detalle (Task 1), así entrar directo desde la
  // lista de conductores tiene el mismo contexto que bajar desde su empresa.
  const migas: Miga[] = [
    { label: 'Certificación', onIr: () => onSeleccionar(null) },
    ...(datos.carrier_id && datos.carrier_name
      ? [{ label: datos.carrier_name, onIr: () => onSeleccionar({ tipo: 'CARRIER', id: datos.carrier_id! }) }]
      : []),
    { label: titulo },
  ]

  return (
    <div className="p-4 space-y-5">
      <ZoomHeader
        migas={migas}
        titulo={titulo}
        subtitulo={esConductor ? (datos.tax_id ?? undefined) : (datos.asset_type ?? undefined)}
        cubiertos={cubiertos}
        total={total}
      />

      <section className="space-y-1.5">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Sus documentos</h3>
        {documentos.isPending ? <Cargando /> : (
          <DocumentList
            records={registros}
            carrierId={datos.carrier_id}
            entityType={tipo}
            entityId={id}
            onChanged={() => documentos.refetch()}
          />
        )}
      </section>
    </div>
  )
}
