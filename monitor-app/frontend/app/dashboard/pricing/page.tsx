'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { locationsApi, shippersApi, type Shipper } from '@/lib/api/locations'
import { LocationCreateForm } from '@/components/dashboard/LocationCreateForm'
import { LocationsTable } from '@/components/dashboard/LocationsTable'
import { LocationsPendingTab } from '@/components/dashboard/LocationsPendingTab'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { INPUT, LoadState } from '../admin/configuracion/shared'

type Tab = 'pending' | 'all'
const LIMIT = 50

/** Tarifario robustecido (2026-07-27) — reemplaza el gate "elegí un
 *  generador de carga primero" (spec 2026-07-22) por dos tabs: "Por
 *  revisar" (triage, default) y "Todos los locales" (gestión completa,
 *  generador de carga como filtro opcional). Ver
 *  docs/superpowers/specs/2026-07-27-tarifario-robustecimiento-design.md. */
export default function TarifarioPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('pending')
  const [shippers, setShippers] = useState<Shipper[]>([])
  const [shipperId, setShipperId] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const qDebounced = useDebouncedValue(q, 300)

  useEffect(() => { shippersApi.list().then(setShippers).catch(() => setShippers([])) }, [])
  useEffect(() => { setPage(1) }, [shipperId, qDebounced])

  const pendingQuery = useQuery({
    queryKey: ['tarifario-pending'],
    queryFn: () => locationsApi.list({ needs_manual_classification: true, limit: 200 }),
  })
  const pendingItems = pendingQuery.data?.data ?? []

  const allQuery = useQuery({
    queryKey: ['tarifario-all', shipperId, qDebounced, page],
    queryFn: () => locationsApi.list({
      entity_type: 'SHIPPER', entity_id: shipperId, q: qDebounced,
      include_rate: true, page, limit: LIMIT,
    }),
    enabled: tab === 'all',
  })
  const allItems = allQuery.data?.data ?? []
  const allCount = allQuery.data?.count ?? 0
  const totalPages = Math.max(1, Math.ceil(allCount / LIMIT))

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['tarifario-pending'] })
    queryClient.invalidateQueries({ queryKey: ['tarifario-all'] })
  }

  function shipperName(entityId: string) {
    return shippers.find(s => s.id === entityId)?.name ?? '—'
  }

  return (
    <div className="p-4 md:p-6 space-y-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-mulish font-bold text-xl text-text-primary">Tarifario</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Local, formato, dirección, clasificación y tarifa vigente — la zona se clasifica sola desde los viajes del TMS.
          </p>
        </div>
        <LocationCreateForm shippers={shippers} onCreated={invalidate} />
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit flex-wrap">
        <button
          onClick={() => setTab('pending')}
          aria-pressed={tab === 'pending'}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
            tab === 'pending' ? 'bg-white text-text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Por revisar <span className="ml-1 text-gray-400">{pendingItems.length}</span>
        </button>
        <button
          onClick={() => setTab('all')}
          aria-pressed={tab === 'all'}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
            tab === 'all' ? 'bg-white text-text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
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
              onSelect={loc => { setQ(loc.name); setTab('all') }}
            />
          )}
        </>
      )}

      {tab === 'all' && (
        <>
          <div className="bg-white border border-border rounded-2xl px-3.5 py-2.5 flex items-center gap-2 flex-wrap">
            <select value={shipperId} onChange={e => setShipperId(e.target.value)} aria-label="Filtrar por generador de carga" className={INPUT + ' w-56'}>
              <option value="">Todos los generadores de carga</option>
              {shippers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nombre o N° de local…" aria-label="Buscar local" className={INPUT + ' w-64'} />
          </div>

          <LoadState loading={allQuery.isPending} error={allQuery.error ? 'Error al cargar' : null} onRetry={() => allQuery.refetch()} />
          {!allQuery.isPending && <LocationsTable items={allItems} onChanged={invalidate} />}

          {!allQuery.isPending && totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-3">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-border text-gray-500 disabled:opacity-40">
                Anterior
              </button>
              <span className="text-xs text-gray-400">Página {page} de {totalPages} ({allCount} locales)</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-border text-gray-500 disabled:opacity-40">
                Siguiente
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
