'use client'

import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Search, Loader2, X, CalendarClock, ShieldOff, FileWarning } from 'lucide-react'
import { insuranceApi } from '@/lib/api/insurance'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { InsuranceCompanyCard } from '@/components/dashboard/InsuranceCompanyCard'
import { InsurancePolicyModal } from '@/components/dashboard/InsurancePolicyModal'
import type { InsuranceSummaryRow } from '@/lib/types'
import {
  deriveInsuranceKpis, matchesInsuranceFilter, type InsuranceFilterId,
} from '@/lib/utils/insuranceFilters'

const KPI_CARDS: { id: InsuranceFilterId; label: string; countCls: string; activeCls: string }[] = [
  { id: 'ok',             label: 'Empresas con seguro al día',      countCls: 'text-green-600', activeCls: 'border-green-400 ring-2 ring-green-100 bg-green-50' },
  { id: 'overdue',        label: 'Con cuotas vencidas',              countCls: 'text-red-600',   activeCls: 'border-red-400 ring-2 ring-red-100 bg-red-50' },
  { id: 'due_this_month', label: 'Cuotas que vencen este mes',      countCls: 'text-amber-600', activeCls: 'border-amber-400 ring-2 ring-amber-100 bg-amber-50' },
]

const FILTER_CHIPS: { id: InsuranceFilterId; label: string }[] = [
  { id: 'overdue',        label: 'Vencidas' },
  { id: 'due_this_month', label: 'Vence este mes' },
  { id: 'ok',              label: 'Al día' },
]

// ── Donut de estado (CSS conic-gradient, sin dependencia de gráficos) ───────

function StatusDonut({ rows }: { rows: InsuranceSummaryRow[] }) {
  const total = rows.length
  const overdue = rows.filter(r => r.overdue_count > 0).length
  const noInfo  = rows.filter(r => r.overdue_count === 0 && r.policies_count === 0).length
  const ok      = total - overdue - noInfo

  if (total === 0) return null

  const okPct      = (ok / total) * 100
  const overduePct = (overdue / total) * 100
  const gradient = `conic-gradient(#22c55e 0% ${okPct}%, #ef4444 ${okPct}% ${okPct + overduePct}%, #d1d5db ${okPct + overduePct}% 100%)`

  return (
    <div className="flex items-center gap-4 shrink-0">
      <div className="relative w-16 h-16 shrink-0 rounded-full" style={{ background: gradient }}>
        <div className="absolute inset-[5px] bg-white rounded-full flex items-center justify-center">
          <span className="text-sm font-bold text-text-primary tabular-nums">{total}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1 text-xs">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500 shrink-0" /> <strong className="tabular-nums">{ok}</strong> al día</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 shrink-0" /> <strong className="tabular-nums">{overdue}</strong> con cuotas vencidas</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-gray-300 shrink-0" /> <strong className="tabular-nums">{noInfo}</strong> sin información</span>
      </div>
    </div>
  )
}

interface Props {
  canAdmin: boolean
  canEdit:  boolean
}

export function PolizasTab({ canAdmin, canEdit }: Props) {
  const searchParams = useSearchParams()
  const rutParam = searchParams.get('rut')

  const [q, setQ]                       = useState(rutParam ?? '')
  const [activeFilter, setActiveFilter] = useState<InsuranceFilterId | null>(null)
  const [selectedRut, setSelectedRut]   = useState<string | null>(rutParam)
  const qDebounced = useDebouncedValue(q, 300)

  const kpisQuery = useQuery({
    queryKey: ['insurance', 'kpis'],
    queryFn: () => insuranceApi.kpis(),
  })

  const query = useQuery({
    queryKey: ['insurance', 'summary', qDebounced],
    queryFn: () => insuranceApi.summary({ q: qDebounced }),
  })
  const rows = useMemo(() => query.data?.data ?? [], [query.data])
  const loading = query.isPending
  const error = query.error ? (query.error instanceof Error ? query.error.message : 'Error cargando seguros') : null

  const kpis = useMemo(() => deriveInsuranceKpis(rows), [rows])
  const visibleRows = useMemo(
    () => activeFilter ? rows.filter(r => matchesInsuranceFilter(r, activeFilter)) : rows,
    [rows, activeFilter],
  )
  const selectedRow = useMemo(() => rows.find(r => r.rut === selectedRut) ?? null, [rows, selectedRut])

  function toggleFilter(id: InsuranceFilterId) {
    setActiveFilter(prev => prev === id ? null : id)
  }

  const emptyLabel = q || activeFilter ? 'Sin resultados' : 'Sin empresas con pólizas registradas'

  return (
    <div className="p-4 md:p-6 space-y-5">
      <p className="text-xs text-gray-400">
        {loading ? '…' : `${rows.length.toLocaleString('es-CL')} empresa${rows.length !== 1 ? 's' : ''} con pólizas`}
      </p>

      {/* ── Panel único: donut + KPIs accionables + estadísticas + búsqueda ── */}
      <div className="border border-border rounded-2xl overflow-hidden bg-white">
        {!loading && (
          <div className="flex items-center gap-6 flex-wrap p-4 border-b border-border">
            <StatusDonut rows={rows} />
            <div className="flex gap-2.5 flex-wrap">
              {KPI_CARDS.map(card => {
                const count  = kpis[card.id]
                const active = activeFilter === card.id
                return (
                  <button
                    key={card.id}
                    onClick={() => toggleFilter(card.id)}
                    disabled={count === 0 && !active}
                    aria-pressed={active}
                    className={`flex items-center gap-2.5 bg-white border rounded-2xl px-4 py-2.5 transition-all disabled:opacity-40 disabled:cursor-default hover:shadow-sm ${
                      active ? card.activeCls : 'border-border hover:border-gray-300'
                    }`}
                  >
                    <span className={`text-xl font-bold leading-none tabular-nums ${count > 0 ? card.countCls : 'text-gray-300'}`}>{count}</span>
                    <span className="text-xs font-semibold text-gray-500 text-left leading-tight">{card.label}</span>
                    {active && <X size={12} className="text-gray-400" />}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {kpisQuery.data && (
          <div className="flex items-center gap-5 flex-wrap px-4 py-3 bg-gray-50/70 border-b border-border text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <CalendarClock size={13} className="text-amber-500 shrink-0" />
              <strong className="font-bold text-gray-700 tabular-nums">{kpisQuery.data.expiring_30d}</strong> pólizas vencen en 30 días
            </span>
            <span className="flex items-center gap-1.5">
              <ShieldOff size={13} className="text-gray-400 shrink-0" />
              <strong className="font-bold text-gray-700 tabular-nums">{kpisQuery.data.without_policies}</strong> empresas activas sin pólizas
            </span>
            <span className="flex items-center gap-1.5">
              <FileWarning size={13} className="text-red-400 shrink-0" />
              <strong className="font-bold text-gray-700 tabular-nums">{kpisQuery.data.incomplete_docs}</strong> pólizas con documentos incompletos
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap p-4">
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
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-all ${
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
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400 gap-2 text-sm">
          <Loader2 size={16} className="animate-spin" /> Cargando…
        </div>
      ) : visibleRows.length === 0 ? (
        <p className="bg-white rounded-2xl border border-border px-4 py-16 text-center text-sm text-gray-400">{emptyLabel}</p>
      ) : (
        <div className="space-y-3">
          {visibleRows.map(row => (
            <InsuranceCompanyCard
              key={row.rut}
              row={row}
              active={selectedRut === row.rut}
              onOpen={() => setSelectedRut(row.rut)}
            />
          ))}
        </div>
      )}

      <InsurancePolicyModal
        row={selectedRow}
        onClose={() => setSelectedRut(null)}
        canAdmin={canAdmin}
        canEdit={canEdit}
      />
    </div>
  )
}
