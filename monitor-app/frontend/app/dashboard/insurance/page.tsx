'use client'

import { Suspense, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { insuranceApi, type CarrierInsuranceState, type PolicyFilter } from '@/lib/api/insurance'
import { POLICY_STATE_LABELS, carrierInsuranceStyle } from '@/lib/states'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'
import { SegmentedControl, type SegmentedOption } from '@/components/ui/SegmentedControl'
import { Estado } from '@/components/ui/Estado'
import { CarriersInsuranceTable, PoliciesTable } from '@/components/insurance/PoliciesTable'

const LIMIT = 50

/** Los filtros por estado. Los de siempre se muestran aunque estén en cero; los
 *  raros (sin vigencia, renovadas, canceladas), solo si hay alguna. */
const POLICY_FILTERS: { id: PolicyFilter; label: string; always: boolean }[] = [
  { id: 'EXPIRED', label: POLICY_STATE_LABELS.EXPIRED, always: true },
  { id: 'EXPIRING', label: POLICY_STATE_LABELS.EXPIRING, always: true },
  { id: 'VALID', label: POLICY_STATE_LABELS.VALID, always: true },
  { id: 'UNPAID', label: 'Cuotas vencidas', always: true },
  { id: 'NO_FILE', label: 'Sin archivo', always: true },
  { id: 'NO_DATES', label: POLICY_STATE_LABELS.NO_DATES, always: false },
  { id: 'RENEWED', label: POLICY_STATE_LABELS.RENEWED, always: false },
  { id: 'CANCELLED', label: POLICY_STATE_LABELS.CANCELLED, always: false },
]
const CARRIER_FILTERS: { id: CarrierInsuranceState; always: boolean }[] = [
  { id: 'NO_POLICY', always: true }, { id: 'EXPIRED', always: true }, { id: 'EXPIRING', always: true },
  { id: 'VALID', always: true }, { id: 'NO_DATES', always: false },
]

export default function PolizasPage() {
  return <Suspense fallback={null}><PolizasPageInner /></Suspense>
}

/**
 * Seguros › Pólizas (Seguros E2, 15/10): el registro de pólizas, con el patrón de
 * Directorio y Certificación. Por póliza o agrupado por empresa (aparecen las
 * activas sin póliza). Los estados los calcula la base; los filtros viven en la URL.
 */
function PolizasPageInner() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const group = params.get('group') === 'carrier' ? 'carrier' : 'policy'
  const state = params.get('state') ?? ''
  const page = Math.max(1, Number(params.get('page')) || 1)
  const [q, setQ] = useState(params.get('q') ?? '')
  const qDebounced = useDebouncedValue(q, 300)
  const returnTo = params.toString() ? `${pathname}?${params.toString()}` : pathname

  function setParams(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(next)) { if (v) sp.set(k, v); else sp.delete(k) }
    if (!('page' in next)) sp.delete('page')
    const s = sp.toString()
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false })
  }

  useEffect(() => {
    if ((params.get('q') ?? '') !== qDebounced.trim()) setParams({ q: qDebounced.trim() || null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qDebounced])

  const query = { state, q: params.get('q') ?? '', page, limit: LIMIT }
  const policies = useQuery({
    queryKey: ['insurance', 'policies', query], queryFn: () => insuranceApi.listPolicies(query),
    enabled: group === 'policy', placeholderData: keepPreviousData,
  })
  const carriers = useQuery({
    queryKey: ['insurance', 'carriers', query], queryFn: () => insuranceApi.listCarriers(query),
    enabled: group === 'carrier', placeholderData: keepPreviousData,
  })
  const active = group === 'policy' ? policies : carriers
  const facets = active.data?.facets as Record<string, number> | undefined
  // Sin cifra mientras la consulta está en vuelo: un "0" ahí afirma algo falso.
  const badge = (id: string) => (facets ? String(facets[id] ?? 0) : undefined)

  const filtros: SegmentedOption<string>[] = [
    { id: 'all', label: 'Todas', badge: badge('total') },
    ...(group === 'policy'
      ? POLICY_FILTERS.filter(f => f.always || (facets?.[f.id] ?? 0) > 0).map(f => ({ id: f.id, label: f.label, badge: badge(f.id) }))
      : CARRIER_FILTERS.filter(f => f.always || (facets?.[f.id] ?? 0) > 0)
          .map(f => ({ id: f.id, label: carrierInsuranceStyle(f.id).label, badge: badge(f.id) }))),
  ]
  const totalPages = Math.max(1, Math.ceil((active.data?.count ?? 0) / LIMIT))
  const vacio = group === 'policy' ? 'No hay pólizas que coincidan' : 'No hay empresas que coincidan'

  return (
    <div className="space-y-4 p-4 md:p-6">
      <EncabezadoDePagina
        titulo="Pólizas"
        bajada={policies.data && group === 'policy'
          ? `${policies.data.facets.total} pólizas`
          : carriers.data && group === 'carrier' ? `${carriers.data.facets.total} empresas` : '…'}
      />

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-white px-3.5 py-2.5">
        <div className="relative shrink-0">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-informativo" aria-hidden="true" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Aseguradora, N° de póliza, empresa o RUT…"
            aria-label="Buscar pólizas"
            className="w-72 max-w-full rounded-lg border border-border bg-white py-1.5 pl-8 pr-3 text-xs placeholder:text-informativo focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>
        <SegmentedControl
          label="Agrupar por"
          options={[{ id: 'policy', label: 'Póliza' }, { id: 'carrier', label: 'Empresa' }]}
          value={group}
          onChange={g => setParams({ group: g === 'carrier' ? 'carrier' : null, state: null })}
        />
        <SegmentedControl label="Estado" options={filtros} value={state || 'all'}
                          onChange={id => setParams({ state: id === 'all' ? null : id })} />
      </div>

      {active.error ? (
        <Estado tipo="error" titulo="No se pudieron cargar las pólizas" detalle="Reintenta en unos segundos." />
      ) : active.isPending ? (
        <Estado tipo="cargando" />
      ) : (active.data?.data.length ?? 0) === 0 ? (
        <Estado tipo="vacio" titulo={vacio} />
      ) : (
        <div className={`transition-opacity ${active.isFetching ? 'opacity-60' : ''}`}>
          {group === 'policy'
            ? <PoliciesTable rows={policies.data!.data} returnTo={returnTo} />
            : <CarriersInsuranceTable rows={carriers.data!.data} returnTo={returnTo} />}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button type="button" onClick={() => setParams({ page: String(page - 1) })} disabled={page <= 1}
                  className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-informativo hover:border-accion disabled:cursor-not-allowed disabled:opacity-40">
            <ChevronLeft size={13} /> Anterior
          </button>
          <span className="text-xs text-informativo">Página {page} de {totalPages}</span>
          <button type="button" onClick={() => setParams({ page: String(page + 1) })} disabled={page >= totalPages}
                  className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-informativo hover:border-accion disabled:cursor-not-allowed disabled:opacity-40">
            Siguiente <ChevronRight size={13} />
          </button>
        </div>
      )}
    </div>
  )
}
