'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Building2, ChevronRight, Search, Loader2, X } from 'lucide-react'
import type { TransporterListItem } from '@/lib/types'
import { useTransporters } from '@/hooks/useTransporters'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { EligibilityDot } from '@/components/dashboard/EligibilityDot'
import { InsuranceStatusBadge } from '@/components/dashboard/InsuranceStatusBadge'
import {
  deriveTransporterKpis, matchesTransporterFilter, type TransporterFilterId,
} from '@/lib/utils/transporterFilters'

const LIMIT = 100

const KPI_CARDS: { id: TransporterFilterId; label: string; countCls: string; activeCls: string }[] = [
  { id: 'active',    label: 'Activas',                    countCls: 'text-slate-700', activeCls: 'border-slate-400 ring-2 ring-slate-100 bg-slate-50' },
  { id: 'eligible',  label: 'Habilitadas para asignar',   countCls: 'text-green-600', activeCls: 'border-green-400 ring-2 ring-green-100 bg-green-50' },
  { id: 'alert_any', label: 'Con alertas (docs o seguro)', countCls: 'text-amber-600', activeCls: 'border-amber-400 ring-2 ring-amber-100 bg-amber-50' },
  { id: 'inactive',  label: 'No activas',                 countCls: 'text-gray-500',  activeCls: 'border-gray-400 ring-2 ring-gray-100 bg-gray-50' },
]

const FILTER_CHIPS: { id: TransporterFilterId; label: string }[] = [
  { id: 'active',          label: 'Activas' },
  { id: 'inactive',        label: 'No activas' },
  { id: 'eligible',        label: 'Habilitadas' },
  { id: 'alert_docs',      label: 'Alerta documentación' },
  { id: 'alert_insurance', label: 'Alerta seguros' },
]

function ProgressBar({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-[10px] text-gray-300">—</span>
  const cls = pct >= 90 ? 'bg-green-500' : pct >= 60 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-1.5 w-20">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${cls}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      <span className="text-[10px] font-mono text-gray-500 shrink-0 w-8 text-right">{pct.toFixed(0)}%</span>
    </div>
  )
}

function ClientChips({ clients }: { clients: string[] }) {
  if (!clients.length) return <span className="text-[10px] text-gray-300">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {clients.map(c => (
        <span key={c} className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">{c}</span>
      ))}
    </div>
  )
}

export default function EmpresasTransportePage() {
  const [q, setQ]                 = useState('')
  const [activeFilter, setActiveFilter] = useState<TransporterFilterId | null>(null)
  const qDebounced = useDebouncedValue(q, 300)

  const query = useTransporters({ q: qDebounced, limit: LIMIT })
  const items = useMemo(() => query.data?.data ?? [], [query.data])
  const total = query.data?.count ?? 0
  const loading  = query.isPending
  const fetching = query.isFetching
  const error = query.error ? (query.error instanceof Error ? query.error.message : 'Error cargando empresas') : null

  const kpis = useMemo(() => deriveTransporterKpis(items), [items])
  const visibleItems = useMemo(
    () => activeFilter ? items.filter(i => matchesTransporterFilter(i, activeFilter)) : items,
    [items, activeFilter],
  )

  function toggleFilter(id: TransporterFilterId) {
    setActiveFilter(prev => prev === id ? null : id)
  }

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
      </div>

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
                className={`flex items-center gap-2 bg-white border rounded-xl px-3.5 py-2 transition-all disabled:opacity-40 disabled:cursor-default ${
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
      <div className="bg-white border border-border rounded-xl px-3.5 py-2.5 flex items-center gap-2 flex-wrap">
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
      ) : (
        <div className={`bg-white rounded-xl border border-border overflow-hidden transition-opacity duration-150 ${fetching ? 'opacity-60' : ''}`}>

          {/* ── Mobile: card list ─────────────────────────────── */}
          <div className="md:hidden divide-y divide-border/60">
            {visibleItems.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-gray-400">
                {q || activeFilter ? 'Sin resultados' : 'Sin empresas'}
              </p>
            )}
            {visibleItems.map(item => (
              <MobileCard key={item.id} item={item} />
            ))}
          </div>

          {/* ── Desktop: table ────────────────────────────────── */}
          <table className="hidden md:table w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[10px] font-bold text-gray-400 uppercase tracking-wide bg-gray-50">
                <th className="px-3 py-3 text-center w-8"></th>
                <th className="px-3 py-3 text-left">Empresa</th>
                <th className="px-3 py-3 text-left w-28">RUT</th>
                <th className="px-3 py-3 text-left w-28">Clientes</th>
                <th className="px-3 py-3 text-center w-20">Conductores</th>
                <th className="px-3 py-3 text-center w-16">Tractos</th>
                <th className="px-3 py-3 text-center w-16">Ramplas</th>
                <th className="px-3 py-3 text-left w-28">Avance 80/20</th>
                <th className="px-3 py-3 text-left w-20">Avance total</th>
                <th className="px-3 py-3 text-left w-28">Seguro</th>
                <th className="px-3 py-3 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item, i) => (
                <tr
                  key={item.id}
                  className={`border-b border-border/60 last:border-0 transition-colors ${
                    i % 2 === 1 ? 'bg-gray-50/40 hover:bg-gray-50' : 'hover:bg-gray-50/70'
                  }`}
                >
                  <td className="px-3 py-3 text-center">
                    <EligibilityDot eligible={item.eligible} blockingReasons={item.blocking_reasons} compliancePct={item.compliance_pct} />
                  </td>
                  <td className="px-3 py-3">
                    <Link href={`/dashboard/transportistas/empresa/${item.id}`} className="flex items-center gap-3 group">
                      <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0 group-hover:bg-accent/10 transition-colors">
                        <Building2 size={14} className="text-gray-400 group-hover:text-accent transition-colors" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-text-primary group-hover:text-accent transition-colors truncate leading-tight">
                          {item.business_name ?? <span className="italic text-gray-400">Sin nombre</span>}
                        </p>
                        {item.admin_id && <p className="text-[10px] text-gray-300 font-mono">#{item.admin_id}</p>}
                      </div>
                    </Link>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-gray-500">{item.rut ?? '—'}</td>
                  <td className="px-3 py-3"><ClientChips clients={item.clients} /></td>
                  <td className="px-3 py-3 text-center"><span className="font-bold text-sm text-slate-700">{item.driver_count}</span></td>
                  <td className="px-3 py-3 text-center"><span className="font-bold text-sm text-slate-700">{item.tracto_count}</span></td>
                  <td className="px-3 py-3 text-center"><span className="font-bold text-sm text-slate-700">{item.trailer_count}</span></td>
                  <td className="px-3 py-3"><ProgressBar pct={item.avance_80_20} /></td>
                  <td className="px-3 py-3">
                    {item.avance_total != null
                      ? <span className="text-[11px] font-mono text-gray-500">{item.avance_total.toFixed(0)}%</span>
                      : <span className="text-[10px] text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-3"><InsuranceStatusBadge insuranceOk={item.insurance_ok} policiesCount={item.policies_count} /></td>
                  <td className="px-3 py-3 text-center">
                    <Link href={`/dashboard/transportistas/empresa/${item.id}`} className="text-gray-300 hover:text-accent transition-colors">
                      <ChevronRight size={15} />
                    </Link>
                  </td>
                </tr>
              ))}
              {visibleItems.length === 0 && (
                <tr><td colSpan={11} className="px-5 py-14 text-center text-sm text-gray-400">
                  {q || activeFilter ? 'Sin resultados' : 'Sin empresas'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function MobileCard({ item }: { item: TransporterListItem }) {
  return (
    <Link
      href={`/dashboard/transportistas/empresa/${item.id}`}
      className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50/70 transition-colors"
    >
      <EligibilityDot eligible={item.eligible} blockingReasons={item.blocking_reasons} compliancePct={item.compliance_pct} />
      <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
        <Building2 size={15} className="text-gray-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-text-primary truncate leading-tight">
          {item.business_name ?? <span className="italic text-gray-400">Sin nombre</span>}
        </p>
        <p className="text-[11px] text-gray-400 mt-0.5 font-mono">{item.rut ?? '—'}</p>
        <p className="text-[10px] text-gray-400 mt-0.5">
          {item.driver_count} cond. · {item.tracto_count} tractos · {item.trailer_count} ramplas
        </p>
        <div className="mt-1 flex items-center gap-1.5">
          <ClientChips clients={item.clients} />
          <InsuranceStatusBadge insuranceOk={item.insurance_ok} policiesCount={item.policies_count} />
        </div>
      </div>
      <ChevronRight size={14} className="text-gray-300 shrink-0" />
    </Link>
  )
}
