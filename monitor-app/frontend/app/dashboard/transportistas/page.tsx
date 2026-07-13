'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Building2, ChevronRight, Search, Loader2, X } from 'lucide-react'
import type { TransporterListItem } from '@/lib/types'
import { useTransporters } from '@/hooks/useTransporters'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { EligibilityDot } from '@/components/dashboard/EligibilityDot'
import { InsuranceStatusBadge } from '@/components/dashboard/InsuranceStatusBadge'
import { ClientChips } from '@/components/dashboard/ClientChips'
import { ComplianceProgressBar } from '@/components/dashboard/ComplianceProgressBar'
import { TransporterCard } from '@/components/dashboard/TransporterCard'
import { TransporterSlideOver } from '@/components/dashboard/TransporterSlideOver'
import { ViewToggle, type ViewMode } from '@/components/dashboard/ViewToggle'
import {
  deriveTransporterKpis, matchesTransporterFilter, type TransporterFilterId,
} from '@/lib/utils/transporterFilters'

const LIMIT = 100
const VIEW_MODE_STORAGE_KEY = 'empresas:vista'
const VIEW_LABELS = { tablero: 'Tarjetas', tabla: 'Tabla' }

type OperationalTab = 'operativa' | 'no_operativa'
const OPERATIONAL_TABS: { id: OperationalTab; label: string }[] = [
  { id: 'operativa',    label: 'Operativas' },
  { id: 'no_operativa', label: 'No operativas' },
]

const KPI_CARDS: { id: TransporterFilterId; label: string; countCls: string; activeCls: string }[] = [
  { id: 'eligible',  label: 'Habilitadas para asignar',   countCls: 'text-green-600', activeCls: 'border-green-400 ring-2 ring-green-100 bg-green-50' },
  { id: 'alert_any', label: 'Con alertas (docs o seguro)', countCls: 'text-amber-600', activeCls: 'border-amber-400 ring-2 ring-amber-100 bg-amber-50' },
]

const FILTER_CHIPS: { id: TransporterFilterId; label: string }[] = [
  { id: 'eligible',        label: 'Habilitadas' },
  { id: 'alert_docs',      label: 'Alerta documentación' },
  { id: 'alert_insurance', label: 'Alerta seguros' },
]

export default function EmpresasTransportePage() {
  const [q, setQ]                 = useState('')
  const [tab, setTab]             = useState<OperationalTab>('operativa')
  const [activeFilter, setActiveFilter] = useState<TransporterFilterId | null>(null)
  const [viewMode, setViewMode]   = useState<ViewMode>('tablero')
  const [selected, setSelected]   = useState<TransporterListItem | null>(null)
  const qDebounced = useDebouncedValue(q, 300)

  const query = useTransporters({ q: qDebounced, limit: LIMIT })
  const items = useMemo(() => query.data?.data ?? [], [query.data])
  const total = query.data?.count ?? 0
  const loading  = query.isPending
  const fetching = query.isFetching
  const error = query.error ? (query.error instanceof Error ? query.error.message : 'Error cargando empresas') : null

  const itemsInTab = useMemo(() => items.filter(i => i.operational_status === tab), [items, tab])
  const kpis = useMemo(() => deriveTransporterKpis(itemsInTab), [itemsInTab])
  const visibleItems = useMemo(
    () => activeFilter ? itemsInTab.filter(i => matchesTransporterFilter(i, activeFilter)) : itemsInTab,
    [itemsInTab, activeFilter],
  )

  useEffect(() => {
    const saved = localStorage.getItem(VIEW_MODE_STORAGE_KEY)
    if (saved === 'tabla' || saved === 'tablero') setViewMode(saved)
  }, [])

  function handleViewModeChange(v: ViewMode) {
    setViewMode(v)
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, v)
  }

  function toggleFilter(id: TransporterFilterId) {
    setActiveFilter(prev => prev === id ? null : id)
  }

  const emptyLabel = q || activeFilter
    ? 'Sin resultados'
    : `Sin empresas ${tab === 'operativa' ? 'operativas' : 'no operativas'}`

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-mulish font-bold text-xl text-text-primary">Empresas de Transporte</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {loading ? '…' : `${total.toLocaleString('es-CL')} empresa${total !== 1 ? 's' : ''}`}
          </p>
        </div>
        <ViewToggle value={viewMode} onChange={handleViewModeChange} labels={VIEW_LABELS} />
      </div>

      {/* ── Tabs Operativa / No operativa — split principal, viene de operational_status ── */}
      {!loading && (
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {OPERATIONAL_TABS.map(t => {
            const count  = items.filter(i => i.operational_status === t.id).length
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
                {t.label} <span className="ml-1 text-gray-400">{count}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* ── KPIs accionables ─────────────────────────────────────── */}
      {!loading && (
        <div className="flex gap-2 flex-wrap">
          {KPI_CARDS.map(card => {
            const count  = kpis[card.id as keyof typeof kpis]
            const active = activeFilter === card.id
            return (
              <button
                key={card.id}
                onClick={() => toggleFilter(card.id)}
                disabled={count === 0 && !active}
                aria-pressed={active}
                className={`flex items-center gap-2 bg-white border rounded-2xl px-3.5 py-2 transition-all disabled:opacity-40 disabled:cursor-default ${
                  active ? card.activeCls : 'border-border hover:border-gray-300'
                }`}
              >
                <span className={`text-lg font-bold leading-none ${count > 0 ? card.countCls : 'text-gray-300'}`}>{count}</span>
                <span className="text-[11px] font-medium text-gray-500">{card.label}</span>
                {active && <X size={11} className="text-gray-400" />}
              </button>
            )
          })}
        </div>
      )}

      {/* ── Barra de filtros: búsqueda + chips ──────────────────────── */}
      <div className="bg-white border border-border rounded-2xl px-3.5 py-2.5 flex items-center gap-2 flex-wrap">
        <div className="relative shrink-0">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Nombre o RUT…"
            className="pl-8 pr-3 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30 w-60 bg-white placeholder:text-gray-400 transition-all"
          />
        </div>

        {FILTER_CHIPS.map(chip => {
          const active = activeFilter === chip.id
          return (
            <button
              key={chip.id}
              onClick={() => toggleFilter(chip.id)}
              aria-pressed={active}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all ${
                active ? 'bg-accent border-accent text-white' : 'text-gray-500 border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              {chip.label}
            </button>
          )
        })}

        {activeFilter && (
          <button
            onClick={() => setActiveFilter(null)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 hover:border-gray-300 rounded-lg bg-white transition-colors ml-auto"
          >
            <X size={11} /> Limpiar
          </button>
        )}
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
        // ── Vista Tarjetas (default) — grid responsive, funciona igual en mobile ──
        <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 transition-opacity duration-150 ${fetching ? 'opacity-60' : ''}`}>
          {visibleItems.map(item => (
            <TransporterCard key={item.id} item={item} onOpen={setSelected} selected={selected?.id === item.id} />
          ))}
        </div>
      ) : (
        // ── Vista Tabla — desktop; en mobile la tarjeta sigue siendo el layout natural ──
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
                  <th className="px-3 py-3 text-center w-8"></th>
                  <th className="px-3 py-3 text-left">Empresa</th>
                  <th className="px-3 py-3 text-left w-28">RUT</th>
                  <th className="px-3 py-3 text-left w-28">Clientes</th>
                  <th className="px-3 py-3 text-center w-20">Conductores</th>
                  <th className="px-3 py-3 text-center w-16">Tractos</th>
                  <th className="px-3 py-3 text-center w-16">Ramplas</th>
                  <th className="px-3 py-3 text-left w-32">Avance</th>
                  <th className="px-3 py-3 text-left w-28">Seguro</th>
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
                    <td className="px-3 py-3 text-center">
                      <EligibilityDot eligible={item.eligible} blockingReasons={item.blocking_reasons} compliancePct={item.compliance_pct} />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                          <Building2 size={14} className="text-gray-400" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-text-primary truncate leading-tight">
                            {item.business_name ?? <span className="italic text-gray-400">Sin nombre</span>}
                          </p>
                          {item.admin_id && <p className="text-[10px] text-gray-300 font-mono">#{item.admin_id}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-gray-500">{item.rut ?? '—'}</td>
                    <td className="px-3 py-3"><ClientChips clients={item.clients} /></td>
                    <td className="px-3 py-3 text-center"><span className="font-bold text-sm text-slate-700">{item.driver_count}</span></td>
                    <td className="px-3 py-3 text-center"><span className="font-bold text-sm text-slate-700">{item.tracto_count}</span></td>
                    <td className="px-3 py-3 text-center"><span className="font-bold text-sm text-slate-700">{item.trailer_count}</span></td>
                    <td className="px-3 py-3">
                      <div className="space-y-1">
                        <ComplianceProgressBar pct={item.avance_80_20} />
                        {item.avance_total != null && (
                          <p className="text-[9px] text-gray-400">Total: <span className="font-mono">{item.avance_total.toFixed(0)}%</span></p>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3"><InsuranceStatusBadge insuranceOk={item.insurance_ok} policiesCount={item.policies_count} /></td>
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
