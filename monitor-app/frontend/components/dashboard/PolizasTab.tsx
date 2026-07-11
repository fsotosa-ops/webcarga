'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Search, Loader2, X, CalendarClock, ShieldOff, FileWarning } from 'lucide-react'
import { insuranceApi } from '@/lib/api/insurance'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { InsuranceCompanyCard } from '@/components/dashboard/InsuranceCompanyCard'
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

interface Props {
  canAdmin: boolean
  canEdit:  boolean
}

export function PolizasTab({ canAdmin, canEdit }: Props) {
  const searchParams = useSearchParams()
  const rutParam = searchParams.get('rut')

  const [q, setQ]                       = useState(rutParam ?? '')
  const [activeFilter, setActiveFilter] = useState<InsuranceFilterId | null>(null)
  const [expanded, setExpanded]         = useState<Set<string>>(new Set())
  const qDebounced = useDebouncedValue(q, 300)
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const scrolledToParam = useRef(false)

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

  // Prefiltra + expande + hace scroll a la card cuando llega ?rut= desde la ficha de empresa
  useEffect(() => {
    if (!rutParam || rows.length === 0 || scrolledToParam.current) return
    const match = rows.find(r => r.rut === rutParam)
    if (match) {
      setExpanded(prev => new Set(prev).add(match.rut))
      scrolledToParam.current = true
      setTimeout(() => cardRefs.current.get(match.rut)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
    }
  }, [rutParam, rows])

  const kpis = useMemo(() => deriveInsuranceKpis(rows), [rows])
  const visibleRows = useMemo(
    () => activeFilter ? rows.filter(r => matchesInsuranceFilter(r, activeFilter)) : rows,
    [rows, activeFilter],
  )

  function toggleFilter(id: InsuranceFilterId) {
    setActiveFilter(prev => prev === id ? null : id)
  }

  function toggleExpanded(rut: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(rut)) next.delete(rut)
      else next.add(rut)
      return next
    })
  }

  const emptyLabel = q || activeFilter ? 'Sin resultados' : 'Sin empresas con pólizas registradas'

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-5xl">
      <p className="text-xs text-gray-400">
        {loading ? '…' : `${rows.length.toLocaleString('es-CL')} empresa${rows.length !== 1 ? 's' : ''} con pólizas`}
      </p>

      {/* ── Una sola franja de KPIs: accionables (filtran la lista) + informativos ── */}
      {!loading && (
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
          {kpisQuery.data && (
            <>
              <div className="flex items-center gap-2.5 bg-white border border-border rounded-2xl px-4 py-2.5">
                <CalendarClock size={15} className="text-amber-500 shrink-0" />
                <span className="text-xl font-bold text-amber-600 tabular-nums leading-none">{kpisQuery.data.expiring_30d}</span>
                <span className="text-xs font-semibold text-gray-500 leading-tight whitespace-nowrap">Vencen en 30 días</span>
              </div>
              <div className="flex items-center gap-2.5 bg-white border border-border rounded-2xl px-4 py-2.5">
                <ShieldOff size={15} className="text-gray-400 shrink-0" />
                <span className="text-xl font-bold text-gray-500 tabular-nums leading-none">{kpisQuery.data.without_policies}</span>
                <span className="text-xs font-semibold text-gray-500 leading-tight whitespace-nowrap">Sin pólizas</span>
              </div>
              <div className="flex items-center gap-2.5 bg-white border border-border rounded-2xl px-4 py-2.5">
                <FileWarning size={15} className="text-red-500 shrink-0" />
                <span className="text-xl font-bold text-red-600 tabular-nums leading-none">{kpisQuery.data.incomplete_docs}</span>
                <span className="text-xs font-semibold text-gray-500 leading-tight whitespace-nowrap">Docs incompletos</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Búsqueda + chips ─────────────────────────────────────── */}
      <div className="bg-white border border-border rounded-2xl px-4 py-3 flex items-center gap-2 flex-wrap">
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
              expanded={expanded.has(row.rut)}
              onToggle={() => toggleExpanded(row.rut)}
              canAdmin={canAdmin}
              canEdit={canEdit}
              ref={el => { if (el) cardRefs.current.set(row.rut, el); else cardRefs.current.delete(row.rut) }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
