'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { locationsApi } from '@/lib/api/locations'
import { useClients } from '@/hooks/useClients'
import { invalidateClients } from '@/lib/queries/clientes'
import { LocationCreateForm } from '@/components/dashboard/LocationCreateForm'
import { LocationsBrowser, NO_LOCATION_FILTERS, type LocationFilters } from '@/components/dashboard/LocationsBrowser'
import { LocationsPendingTab } from '@/components/dashboard/LocationsPendingTab'
import { LoadState } from '../admin/settings/shared'
import { EncabezadoDePagina } from '@/components/ui/EncabezadoDePagina'
import { usePermiso } from '@/lib/authz/PermisosProvider'
import { PageContainer } from '@/components/ui/PageContainer'

type Tab = 'pending' | 'all'

/** Tarifario robustecido (2026-07-27) — reemplaza el gate que exigia un
 *  generador de carga antes de operar (spec 2026-07-22) por dos tabs: "Por
 *  revisar" (triage, default) y "Todos los locales" (gestión completa,
 *  generador de carga como filtro opcional). Ver
 *  docs/superpowers/specs/2026-07-27-tarifario-robustecimiento-design.md. */
export default function TarifarioPage() {
  return <Suspense fallback={null}><Tarifario /></Suspense>
}

function Tarifario() {
  const queryClient = useQueryClient()
  const canEdit = usePermiso('commercial.edit')
  // `?origen=1` (ex Configuración › Orígenes) abre los lugares de origen.
  const desdeOrigenes = useSearchParams().get('origen') === '1'
  const [tab, setTab] = useState<Tab>(desdeOrigenes ? 'all' : 'pending')
  const shippers = useClients().data ?? []
  const [filters, setFilters] = useState<LocationFilters>({ ...NO_LOCATION_FILTERS, origin: desdeOrigenes })

  const pendingQuery = useQuery({
    queryKey: ['tarifario-pending'],
    queryFn: () => locationsApi.list({ needs_manual_classification: true, limit: 200 }),
  })
  const pendingItems = pendingQuery.data?.data ?? []

  const invalidate = () => invalidateClients(queryClient)

  function shipperName(entityId: string) {
    return shippers.find(s => s.id === entityId)?.name ?? '—'
  }

  return (
    <PageContainer>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <EncabezadoDePagina
            titulo="Tarifario"
            bajada="Local, formato, dirección, clasificación y tarifa vigente — la zona se clasifica sola desde los viajes del TMS."
          />
        </div>
        {canEdit && <LocationCreateForm shippers={shippers} onCreated={invalidate} />}
      </div>

      <div className="flex gap-1 bg-bg-main rounded-xl p-1 w-fit flex-wrap">
        <button
          onClick={() => setTab('pending')}
          aria-pressed={tab === 'pending'}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
            tab === 'pending' ? 'bg-white text-text-primary shadow-sm' : 'text-informativo hover:text-text-primary'
          }`}
        >
          Por revisar <span className="ml-1 text-informativo">{pendingItems.length}</span>
        </button>
        <button
          onClick={() => setTab('all')}
          aria-pressed={tab === 'all'}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
            tab === 'all' ? 'bg-white text-text-primary shadow-sm' : 'text-informativo hover:text-text-primary'
          }`}
        >
          Todos los locales
        </button>
      </div>

      {tab === 'pending' && (
        <>
          <LoadState loading={pendingQuery.isPending} error={pendingQuery.error ? 'Error al cargar' : null} onRetry={() => pendingQuery.refetch()} />
          {!pendingQuery.isPending && (
            <LocationsPendingTab
              items={pendingItems}
              shipperName={shipperName}
              onChanged={invalidate}
              onSelect={loc => { setFilters({ ...NO_LOCATION_FILTERS, q: loc.name }); setTab('all') }}
              canEdit={canEdit}
            />
          )}
        </>
      )}

      {tab === 'all' && (
        <LocationsBrowser filters={filters} onFiltersChange={setFilters} shippers={shippers} canEdit={canEdit} />
      )}
    </PageContainer>
  )
}
