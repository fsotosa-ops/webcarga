'use client'

import { Suspense, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { insuranceApi, type PolicyFilter } from '@/lib/api/insurance'
import { POLICY_STATE_LABELS } from '@/lib/states'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'
import { SegmentedControl, type SegmentedOption } from '@/components/ui/SegmentedControl'
import { Estado } from '@/components/ui/Estado'
import { PoliciesTable } from '@/components/insurance/PoliciesTable'
import { PageContainer } from '@/components/ui/PageContainer'
import { inputClass } from '@/components/ui/Field'

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

const cuenta = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

export default function PolizasPage() {
  return <Suspense fallback={null}><PolizasPageInner /></Suspense>
}

/**
 * Seguros › Pólizas (Seguros E2, 15/10): el registro de pólizas, una fila por póliza,
 * para las tareas puntuales (renovar, extender). La vista por empresa es Seguros ›
 * Empresas (17/10). Los estados los calcula la base; los filtros viven en la URL.
 */
function PolizasPageInner() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
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
    placeholderData: keepPreviousData,
  })
  const facets = policies.data?.facets as Record<string, number> | undefined
  // Sin cifra mientras la consulta está en vuelo: un "0" ahí afirma algo falso.
  const badge = (id: string) => (facets ? String(facets[id] ?? 0) : undefined)

  const filtros: SegmentedOption<string>[] = [
    { id: 'all', label: 'Todas', badge: badge('total') },
    ...POLICY_FILTERS.filter(f => f.always || (facets?.[f.id] ?? 0) > 0).map(f => ({ id: f.id, label: f.label, badge: badge(f.id) })),
  ]
  const totalPages = Math.max(1, Math.ceil((policies.data?.count ?? 0) / LIMIT))

  return (
    <PageContainer>
      <EncabezadoDePagina
        titulo="Pólizas"
        bajada={policies.data ? cuenta(policies.data.facets.total, 'póliza', 'pólizas') : '…'}
      />

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-white px-3.5 py-2.5">
        <div className="relative shrink-0">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-informativo" aria-hidden="true" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Aseguradora, N° de póliza, empresa o RUT…"
            aria-label="Buscar pólizas"
            className={`${inputClass({ size: 'sm' })} w-72 max-w-full pl-8`}
          />
        </div>
        <SegmentedControl label="Estado" options={filtros} value={state || 'all'}
                          onChange={id => setParams({ state: id === 'all' ? null : id })} />
      </div>

      {policies.error ? (
        <Estado tipo="error" titulo="No se pudieron cargar las pólizas" detalle="Reintenta en unos segundos." />
      ) : policies.isPending ? (
        <Estado tipo="cargando" />
      ) : policies.data.data.length === 0 ? (
        <Estado tipo="vacio" titulo="No hay pólizas que coincidan" />
      ) : (
        <div className={`transition-opacity ${policies.isFetching ? 'opacity-60' : ''}`}>
          <PoliciesTable rows={policies.data.data} returnTo={returnTo} />
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
    </PageContainer>
  )
}
