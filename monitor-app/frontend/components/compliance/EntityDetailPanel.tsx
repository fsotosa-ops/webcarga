'use client'

import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { assetsApi } from '@/lib/api/assets'
import { carriersApi } from '@/lib/api/carriers'
import { complianceApi } from '@/lib/api/compliance'
import { driversApi } from '@/lib/api/drivers'
import { ChildrenList, type Hijo } from './ChildrenList'
import { DocumentList } from './DocumentList'
import { ZoomHeader, type Miga } from './ZoomHeader'
import type { ComplianceRecord } from '@/lib/types'

export type Seleccion = { tipo: 'CARRIER' | 'DRIVER' | 'ASSET'; id: string }

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

function DetalleEmpresa({ id, onSeleccionar }: { id: string; onSeleccionar: (s: Seleccion | null) => void }) {
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

  const registros = empresa.data.compliance_records ?? []
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
    </div>
  )
}

function DetalleEntidad({ tipo, id, onSeleccionar }: {
  tipo: 'DRIVER' | 'ASSET'; id: string; onSeleccionar: (s: Seleccion | null) => void
}) {
  const esConductor = tipo === 'DRIVER'

  const entidad = useQuery({
    queryKey: [esConductor ? 'driver-detail' : 'asset-detail', id],
    queryFn: () => (esConductor ? driversApi.get(id) : assetsApi.get(id)),
  })
  const documentos = useQuery({
    queryKey: [esConductor ? 'driver-compliance-records' : 'asset-compliance-records', id],
    queryFn: () => (esConductor
      ? driversApi.listComplianceRecords(id)
      : assetsApi.listComplianceRecords(id)),
  })

  if (entidad.isPending) return <Cargando />
  if (entidad.error || !entidad.data) return <NoSePudo />

  const datos = entidad.data as unknown as {
    full_name?: string; license_plate?: string; tax_id?: string | null
    asset_type?: string | null; carrier_id: string | null; carrier_name: string | null
  }
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
