'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { locationsApi, type Shipper } from '@/lib/api/locations'
import { invalidateClients } from '@/lib/queries/clientes'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { LocationsTable } from '@/components/dashboard/LocationsTable'
import { INPUT, LoadState } from '@/app/dashboard/admin/settings/shared'

const LIMIT = 50

export type LocationFilters = { shipperId: string; q: string; page: number }
export const NO_LOCATION_FILTERS: LocationFilters = { shipperId: '', q: '', page: 1 }

/** Los lugares de carga con su búsqueda y sus páginas: "Todos los locales" del
 *  Tarifario y la pestaña Lugares de la ficha de un cliente. Con `shippers` se
 *  ofrece elegir el generador de carga; sin él, el cliente es el de `filters`.
 *  Los filtros los guarda quien lo usa (el Tarifario salta aquí desde "Por
 *  revisar" con la búsqueda puesta). */
export function LocationsBrowser({ filters, onFiltersChange, shippers, canEdit, emptyTitle }: {
  filters: LocationFilters
  onFiltersChange: (next: LocationFilters) => void
  shippers?: Shipper[]
  canEdit: boolean
  /** Qué decir sin lugares y sin búsqueda. */
  emptyTitle?: string
}) {
  const qc = useQueryClient()
  const q = useDebouncedValue(filters.q, 300)
  const query = useQuery({
    queryKey: ['tarifario-all', filters.shipperId, q, filters.page],
    queryFn: () => locationsApi.list({
      entity_type: 'SHIPPER', entity_id: filters.shipperId, q,
      include_rate: true, page: filters.page, limit: LIMIT,
    }),
  })
  const count = query.data?.count ?? 0
  const totalPages = Math.max(1, Math.ceil(count / LIMIT))
  // Cambiar un filtro vuelve a la primera página.
  const set = (patch: Partial<LocationFilters>) => onFiltersChange({ ...filters, page: 1, ...patch })

  return (
    <div className="space-y-3">
      <div className="bg-white border border-border rounded-2xl px-3.5 py-2.5 flex items-center gap-2 flex-wrap">
        {shippers && (
          <select value={filters.shipperId} onChange={e => set({ shipperId: e.target.value })} aria-label="Filtrar por generador de carga" className={INPUT + ' w-56'}>
            <option value="">Todos los generadores de carga</option>
            {shippers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <input value={filters.q} onChange={e => set({ q: e.target.value })} placeholder="Buscar por nombre o N° de local…" aria-label="Buscar local" className={INPUT + ' w-64'} />
      </div>

      <LoadState loading={query.isPending} error={query.error ? 'Error al cargar' : null} onRetry={() => query.refetch()} />
      {query.isSuccess && (
        <LocationsTable items={query.data.data} onChanged={() => invalidateClients(qc)} canEdit={canEdit}
          emptyTitle={!filters.q && emptyTitle ? emptyTitle : undefined} />
      )}

      {query.isSuccess && totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-3">
          <button onClick={() => set({ page: Math.max(1, filters.page - 1) })} disabled={filters.page <= 1}
            className="text-dato font-semibold px-3 py-1.5 rounded-lg border border-border text-informativo disabled:opacity-40">
            Anterior
          </button>
          <span className="text-dato text-informativo">Página {filters.page} de {totalPages} ({count} locales)</span>
          <button onClick={() => set({ page: Math.min(totalPages, filters.page + 1) })} disabled={filters.page >= totalPages}
            className="text-dato font-semibold px-3 py-1.5 rounded-lg border border-border text-informativo disabled:opacity-40">
            Siguiente
          </button>
        </div>
      )}
    </div>
  )
}
