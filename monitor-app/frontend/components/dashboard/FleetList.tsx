'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { driversApi } from '@/lib/api/drivers'
import { assetsApi } from '@/lib/api/assets'
import { useAssetTypes } from '@/hooks/useAssetTypes'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { directoryKeys } from '@/lib/queries/directorio'
import { assetHref, carrierHref, driverHref } from '@/lib/navegacion/directory'
import { DOCUMENT_STATE_GROUP_LABELS, fleetMemberStyle, summaryStyle } from '@/lib/states'
import { ChipsDeFiltro, type Chip } from '@/components/ui/ChipsDeFiltro'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'
import { Estado } from '@/components/ui/Estado'
import { StatusChip } from '@/components/ui/StatusChip'
import type { DocumentsFilter, FleetListResponse, FleetListRow } from '@/lib/types'

export type FleetKind = 'driver' | 'asset'

const PAGE_SIZE = 50

/** Lo que cambia entre las dos listas. El resto es igual: una variante es una prop. */
const VARIANT = {
  driver: {
    title: 'Conductores', noun: ['conductor', 'conductores'], search: 'Nombre o RUT…', thirdFlag: 'without_origin',
    thirdLabel: 'Sin origen',
  },
  asset: {
    title: 'Equipos', noun: ['equipo', 'equipos'], search: 'Patente…', thirdFlag: 'without_type',
    thirdLabel: 'Tractos sin tipo',
  },
} as const

const DOCUMENT_OPTIONS: { id: DocumentsFilter; label: string }[] = [
  { id: 'pending',  label: 'Con pendientes' },
  { id: 'overdue',  label: DOCUMENT_STATE_GROUP_LABELS.OVERDUE },
  { id: 'expiring', label: DOCUMENT_STATE_GROUP_LABELS.EXPIRING },
  { id: 'missing',  label: DOCUMENT_STATE_GROUP_LABELS.MISSING },
]

/**
 * Directorio › Conductores y Directorio › Equipos (D4, Entrega C 14/10): una
 * lista por objeto. Los filtros viven en la URL, así Certificación abre esta
 * misma lista con `?documents=pending` y un enlace guardado conserva lo que se
 * miraba.
 */
export function FleetList({ kind }: { kind: FleetKind }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const v = VARIANT[kind]

  const flag = params.get('flag')
  const documents = params.get('documents') as DocumentsFilter | null
  const page = Math.max(1, Number(params.get('page')) || 1)
  const [q, setQ] = useState(params.get('q') ?? '')
  const qDebounced = useDebouncedValue(q, 300)

  function setParams(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString())
    for (const [k, value] of Object.entries(next)) {
      if (value) sp.set(k, value)
      else sp.delete(k)
    }
    if (!('page' in next)) sp.delete('page')
    const qs = sp.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  // La búsqueda escrita pasa a la URL ya calmada, y vuelve a la primera página.
  useEffect(() => {
    if ((params.get('q') ?? '') !== qDebounced.trim()) setParams({ q: qDebounced.trim() || null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qDebounced])

  const listParams = { q: params.get('q') ?? '', flag, documents, offset: (page - 1) * PAGE_SIZE, pageSize: PAGE_SIZE }
  const query = useQuery<FleetListResponse>({
    queryKey: directoryKeys.fleetList(kind, listParams),
    queryFn: () => kind === 'driver'
      ? driversApi.list(listParams as Parameters<typeof driversApi.list>[0])
      : assetsApi.list(listParams as Parameters<typeof assetsApi.list>[0]),
    placeholderData: keepPreviousData,
  })
  const { labelOf } = useAssetTypes()

  const data = query.data
  const facets = data?.facets
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE))
  const chips: Chip[] = [
    { id: 'without_carrier', etiqueta: 'Sin empresa', n: facets?.without_carrier },
    { id: 'inactive', etiqueta: 'Dados de baja', n: facets?.inactive },
    { id: v.thirdFlag, etiqueta: v.thirdLabel, n: facets?.[v.thirdFlag] },
  ]

  return (
    <div className="p-4 md:p-6 space-y-4">
      <EncabezadoDePagina
        titulo={v.title}
        bajada={facets ? `${facets.all.toLocaleString('es-CL')} ${facets.all === 1 ? v.noun[0] : v.noun[1]}` : '…'}
      />

      <div className="bg-white border border-border rounded-2xl px-3.5 py-2.5 flex items-center gap-3 flex-wrap">
        <div className="relative shrink-0">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-informativo pointer-events-none" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={v.search}
            aria-label={`Buscar ${v.noun[1]}`}
            className="pl-8 pr-3 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30 w-64 bg-white placeholder:text-informativo"
          />
        </div>
        <ChipsDeFiltro opciones={chips} activo={flag} onElegir={id => setParams({ flag: id })} />
        <select
          aria-label="Documentos"
          value={documents ?? ''}
          onChange={e => setParams({ documents: e.target.value || null })}
          className="text-xs border border-border rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20"
        >
          <option value="">Documentos: todos</option>
          {DOCUMENT_OPTIONS.map(o => <option key={o.id} value={o.id}>Documentos: {o.label.toLowerCase()}</option>)}
        </select>
      </div>

      {query.error ? (
        <Estado tipo="error" titulo={`No se pudieron cargar los ${v.noun[1]}`} detalle="Reintenta en unos segundos." />
      ) : query.isPending ? (
        <Estado tipo="cargando" />
      ) : data!.rows.length === 0 ? (
        <Estado tipo="vacio" titulo="Sin resultados" />
      ) : (
        <div className={`bg-white rounded-2xl border border-border overflow-x-auto transition-opacity ${query.isFetching ? 'opacity-60' : ''}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-etiqueta font-bold text-informativo uppercase tracking-wide bg-bg-main">
                <th className="px-3 py-3 text-left">{kind === 'driver' ? 'Conductor' : 'Patente'}</th>
                <th className="px-3 py-3 text-left">{kind === 'driver' ? 'RUT' : 'Tipo'}</th>
                <th className="px-3 py-3 text-left">Empresa hoy</th>
                <th className="px-3 py-3 text-left w-32">Estado</th>
                <th className="px-3 py-3 text-left w-32">Documentos</th>
              </tr>
            </thead>
            <tbody>
              {data!.rows.map(row => <Row key={row.id} kind={kind} row={row} typeLabel={labelOf(row.asset_type)} toDocuments={!!documents} />)}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setParams({ page: String(page - 1) })}
            disabled={page <= 1}
            className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg border border-border text-informativo hover:border-accion disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={13} /> Anterior
          </button>
          <span className="text-xs text-informativo">Página {page} de {totalPages}</span>
          <button
            onClick={() => setParams({ page: String(page + 1) })}
            disabled={page >= totalPages}
            className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg border border-border text-informativo hover:border-accion disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Siguiente <ChevronRight size={13} />
          </button>
        </div>
      )}
    </div>
  )
}

function Row({ kind, row, typeLabel, toDocuments }: { kind: FleetKind; row: FleetListRow; typeLabel: string; toDocuments: boolean }) {
  // Filtrando por documentos (la cola de Certificación) se llega a la ficha en
  // su pestaña Documentos, que es lo que se vino a trabajar.
  const profile = kind === 'driver' ? driverHref(row.id) : assetHref(row.id)
  const href = toDocuments ? `${profile}?tab=documentos` : profile
  const lifecycle = fleetMemberStyle(kind, row.operational_status, row.carrier?.operational_status)
  const docs = summaryStyle(row.compliance_summary, row.operational_status === 'ACTIVE')
  return (
    <tr className="border-b border-border/60 last:border-0 hover:bg-bg-main">
      <td className="px-3 py-2.5">
        <Link href={href} prefetch={false} className={`font-semibold text-text-primary hover:text-accent ${kind === 'asset' ? 'font-mono' : ''}`}>
          {kind === 'driver' ? row.full_name : row.license_plate}
        </Link>
      </td>
      <td className={`px-3 py-2.5 text-xs text-informativo ${kind === 'driver' ? 'font-mono' : ''}`}>
        {kind === 'driver' ? row.tax_id : <>{typeLabel}{row.operation_type ? ` · ${row.operation_type}` : ''}</>}
      </td>
      <td className="px-3 py-2.5 text-xs">
        {row.carrier
          ? <Link href={carrierHref(row.carrier.id)} prefetch={false} className="text-text-primary hover:text-accent">{row.carrier.name}</Link>
          : <span className="text-warning">Sin empresa</span>}
      </td>
      <td className="px-3 py-2.5"><StatusChip tone={lifecycle.tone} icon={lifecycle.icon}>{lifecycle.label}</StatusChip></td>
      <td className="px-3 py-2.5"><StatusChip tone={docs.tone} icon={docs.icon}>{docs.label}</StatusChip></td>
    </tr>
  )
}
