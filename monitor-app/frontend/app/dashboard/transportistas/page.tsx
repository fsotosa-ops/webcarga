'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Building2, ChevronRight, Search, Loader2 } from 'lucide-react'
import type { CarrierListItem, OperationalStatus } from '@/lib/types'
import { useTransporters } from '@/hooks/useTransporters'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { TransporterCard } from '@/components/dashboard/TransporterCard'
import { TransporterSlideOver } from '@/components/dashboard/TransporterSlideOver'
import { ViewToggle, type ViewMode } from '@/components/dashboard/ViewToggle'
import { formatExpiry } from '@/lib/compliance'
import { matchesTab, countByTab, type TransporterTab } from '@/lib/utils/transporterFilters'

const LIMIT = 100
const VIEW_MODE_STORAGE_KEY = 'empresas:vista'
const VIEW_LABELS = { tablero: 'Tarjetas', tabla: 'Tabla' }

const TABS: { id: TransporterTab; label: string }[] = [
  { id: 'active', label: 'Activas' },
  { id: 'legacy', label: 'Legacy' },
]

const STATUS_LABELS: Record<OperationalStatus, string> = {
  ACTIVE: 'Activa', INACTIVE: 'Inactiva', LEGACY_INACTIVE: 'Legacy',
}

export default function EmpresasTransportePage() {
  const [q, setQ]                 = useState('')
  const [tab, setTab]             = useState<TransporterTab>('active')
  const [viewMode, setViewMode]   = useState<ViewMode>('tablero')
  const [selected, setSelected]   = useState<CarrierListItem | null>(null)
  const qDebounced = useDebouncedValue(q, 300)

  const query = useTransporters({ q: qDebounced, limit: LIMIT })
  const items = useMemo(() => query.data?.data ?? [], [query.data])
  const total = query.data?.count ?? 0
  const loading  = query.isPending
  const fetching = query.isFetching
  const error = query.error ? (query.error instanceof Error ? query.error.message : 'Error cargando empresas') : null

  const tabCounts = useMemo(() => countByTab(items), [items])
  const visibleItems = useMemo(() => items.filter(i => matchesTab(i, tab)), [items, tab])

  useEffect(() => {
    const saved = localStorage.getItem(VIEW_MODE_STORAGE_KEY)
    if (saved === 'tabla' || saved === 'tablero') setViewMode(saved)
  }, [])

  function handleViewModeChange(v: ViewMode) {
    setViewMode(v)
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, v)
  }

  const emptyLabel = q ? 'Sin resultados' : `Sin empresas ${tab === 'active' ? 'activas' : 'legacy'}`

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-mulish font-bold text-xl text-text-primary">Empresas de Transporte</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {loading ? '…' : `${total.toLocaleString('es-CL')} empresa${total !== 1 ? 's' : ''}`}
          </p>
        </div>
        <ViewToggle value={viewMode} onChange={handleViewModeChange} labels={VIEW_LABELS} />
      </div>

      {/* ── Tabs Activas / Legacy — split principal, viene de operational_status ── */}
      {!loading && (
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {TABS.map(t => {
            const active = tab === t.id
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-pressed={active}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  active ? 'bg-white text-text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.label} <span className="ml-1 text-gray-400">{tabCounts[t.id]}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className="bg-white border border-border rounded-2xl px-3.5 py-2.5 flex items-center gap-2 flex-wrap">
        <div className="relative shrink-0">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Nombre o tax_id…"
            className="pl-8 pr-3 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30 w-60 bg-white placeholder:text-gray-400 transition-all"
          />
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400 gap-2 text-sm">
          <Loader2 size={16} className="animate-spin" /> Cargando…
        </div>
      ) : visibleItems.length === 0 ? (
        <p className="bg-white rounded-2xl border border-border px-4 py-14 text-center text-sm text-gray-400">{emptyLabel}</p>
      ) : viewMode === 'tablero' ? (
        <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 transition-opacity duration-150 ${fetching ? 'opacity-60' : ''}`}>
          {visibleItems.map(item => (
            <TransporterCard key={item.id} item={item} onOpen={setSelected} selected={selected?.id === item.id} />
          ))}
        </div>
      ) : (
        <div className={`transition-opacity duration-150 ${fetching ? 'opacity-60' : ''}`}>
          <div className="md:hidden grid grid-cols-1 gap-3">
            {visibleItems.map(item => (
              <TransporterCard key={item.id} item={item} onOpen={setSelected} selected={selected?.id === item.id} />
            ))}
          </div>

          <div className="hidden md:block bg-white rounded-2xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-[10px] font-bold text-gray-400 uppercase tracking-wide bg-gray-50">
                  <th className="px-3 py-3 text-left">Empresa</th>
                  <th className="px-3 py-3 text-left w-32">Tax ID</th>
                  <th className="px-3 py-3 text-left w-24">Estado</th>
                  <th className="px-3 py-3 text-center w-24">Requisitos</th>
                  <th className="px-3 py-3 text-left w-28">Última actualización</th>
                  <th className="px-3 py-3 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item, i) => (
                  <tr
                    key={item.id}
                    onClick={() => setSelected(item)}
                    className={`border-b border-border/60 last:border-0 cursor-pointer transition-colors ${
                      selected?.id === item.id ? 'bg-accent/5' : i % 2 === 1 ? 'bg-gray-50/40 hover:bg-gray-50' : 'hover:bg-gray-50/70'
                    }`}
                  >
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                          <Building2 size={14} className="text-gray-400" />
                        </div>
                        <p className="font-semibold text-text-primary truncate leading-tight">
                          {item.business_name || <span className="italic text-gray-400">Sin nombre</span>}
                        </p>
                      </div>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-gray-500">{item.tax_id}</td>
                    <td className="px-3 py-3 text-xs text-gray-600">{STATUS_LABELS[item.operational_status]}</td>
                    <td className="px-3 py-3 text-center"><span className="font-bold text-sm text-slate-700">{item.total_requirements}</span></td>
                    <td className="px-3 py-3 text-xs text-gray-500">{formatExpiry(item.last_document_update)}</td>
                    <td className="px-3 py-3 text-center">
                      <Link
                        href={`/dashboard/transportistas/empresa/${item.id}`}
                        onClick={e => e.stopPropagation()}
                        title="Ver ficha completa"
                        className="text-gray-300 hover:text-accent transition-colors"
                      >
                        <ChevronRight size={15} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <TransporterSlideOver item={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
