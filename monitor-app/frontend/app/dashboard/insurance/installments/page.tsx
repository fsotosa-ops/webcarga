'use client'

import { Suspense, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { insuranceApi, type InstallmentFilter } from '@/lib/api/insurance'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Estado } from '@/components/ui/Estado'
import { InstallmentsTable } from '@/components/insurance/InstallmentsTable'
import { PageContainer } from '@/components/ui/PageContainer'
import { inputClass } from '@/components/ui/Field'

const FILTERS: { id: InstallmentFilter; label: string; empty: string }[] = [
  { id: 'OVERDUE', label: 'Vencidas', empty: 'No hay cuotas vencidas' },
  { id: 'DUE_30', label: 'Próximos 30 días', empty: 'No hay cuotas que venzan en los próximos 30 días' },
  { id: 'PAID', label: 'Pagadas', empty: 'No hay cuotas pagadas' },
  { id: 'ALL', label: 'Todas', empty: 'No hay cuotas cargadas' },
]

export default function CuotasPage() {
  return <Suspense fallback={null}><CuotasPageInner /></Suspense>
}

/** Seguros › Cuotas (Seguros E2, 15/10): la cola de pagos de todas las pólizas.
 *  Abre en las vencidas; se marcan pagadas en lote. El estado lo calcula la base. */
function CuotasPageInner() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const state = (FILTERS.find(f => f.id === params.get('state'))?.id ?? 'OVERDUE') as InstallmentFilter
  const [q, setQ] = useState(params.get('q') ?? '')
  const qDebounced = useDebouncedValue(q, 300)
  const returnTo = params.toString() ? `${pathname}?${params.toString()}` : pathname

  function setParams(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(next)) { if (v) sp.set(k, v); else sp.delete(k) }
    const s = sp.toString()
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false })
  }
  useEffect(() => {
    if ((params.get('q') ?? '') !== qDebounced.trim()) setParams({ q: qDebounced.trim() || null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qDebounced])

  const query = { state, q: params.get('q') ?? '', limit: 300 }
  const list = useQuery({
    queryKey: ['insurance', 'installments', query], queryFn: () => insuranceApi.listInstallments(query), placeholderData: keepPreviousData,
  })
  const facets = list.data?.facets
  const empty = FILTERS.find(f => f.id === state)!.empty

  return (
    <PageContainer>
      <EncabezadoDePagina titulo="Cuotas" bajada="Lo que hay que pagar, de todas las pólizas." />
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-white px-3.5 py-2.5">
        <div className="relative shrink-0">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-informativo" aria-hidden="true" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Empresa, aseguradora o N° de póliza…" aria-label="Buscar cuotas"
                 className={`${inputClass({ size: 'sm' })} w-72 max-w-full pl-8`} />
        </div>
        <SegmentedControl
          label="Cuotas"
          options={FILTERS.map(f => ({ id: f.id, label: f.label, badge: facets ? String(facets[f.id] ?? 0) : undefined }))}
          value={state}
          onChange={id => setParams({ state: id === 'OVERDUE' ? null : id })}
        />
      </div>
      {list.error ? (
        <Estado tipo="error" titulo="No se pudieron cargar las cuotas" detalle="Reintenta en unos segundos." />
      ) : list.isPending ? (
        <Estado tipo="cargando" />
      ) : (
        <div className={`transition-opacity ${list.isFetching ? 'opacity-60' : ''}`}>
          <InstallmentsTable rows={list.data!.data} showPolicy returnTo={returnTo} busy={list.isFetching}
                             empty={<Estado tipo="vacio" titulo={empty} />} />
          {list.data!.count > list.data!.data.length && (
            <p className="mt-2 text-etiqueta text-informativo tabular-nums">Mostrando {list.data!.data.length} de {list.data!.count}</p>
          )}
        </div>
      )}
    </PageContainer>
  )
}
