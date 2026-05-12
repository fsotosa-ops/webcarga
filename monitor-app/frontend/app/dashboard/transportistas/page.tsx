'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Building2, ChevronRight, Users, Truck, Search, Loader2 } from 'lucide-react'
import { transportersApi } from '@/lib/api/transporters'
import type { TransporterListItem } from '@/lib/types'

type StageGroup = 'Operational' | 'Lead' | ''

const TABS: { id: StageGroup; label: string }[] = [
  { id: 'Operational', label: 'Operacionales' },
  { id: 'Lead',        label: 'Lead' },
  { id: '',            label: 'Todas' },
]

const STAGE_COLORS: Record<string, { bg: string; text: string }> = {
  Operational: { bg: '#eef6e6', text: '#62a420' },
  Lead:        { bg: '#e8eeff', text: '#053bfa' },
}

export default function EmpresasTransportePage() {
  const [items, setItems] = useState<TransporterListItem[]>([])
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const [stage, setStage] = useState<StageGroup>('Operational')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tabCounts, setTabCounts] = useState<Record<StageGroup, number>>({ Operational: 0, Lead: 0, '': 0 })

  const LIMIT = 48

  // Fetch counts once for tab badges
  useEffect(() => {
    Promise.all([
      transportersApi.list({ stage: 'Operational', limit: 1 }),
      transportersApi.list({ stage: 'Lead',        limit: 1 }),
      transportersApi.list({ limit: 1 }),
    ]).then(([op, lead, all]) => {
      setTabCounts({ Operational: op.count, Lead: lead.count, '': all.count })
    }).catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setPage(1)
    transportersApi.list({ q, stage, page: 1, limit: LIMIT })
      .then(res => {
        if (cancelled) return
        setItems(res.data)
        setTotal(res.count)
      })
      .catch(e => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Error cargando datos')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [q, stage])

  useEffect(() => {
    if (page === 1) return
    let cancelled = false
    setLoading(true)
    transportersApi.list({ q, stage, page, limit: LIMIT })
      .then(res => {
        if (cancelled) return
        setItems(res.data)
        setTotal(res.count)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.ceil(total / LIMIT)

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-mulish font-bold text-xl text-text-primary">Empresas de Transportes</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {loading ? '…' : `${total.toLocaleString('es-CL')} empresa${total !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            value={q}
            onChange={e => { setQ(e.target.value); setPage(1) }}
            placeholder="Nombre, RUT o Admin ID…"
            className="pl-9 pr-4 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/30 w-64 bg-white"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-border">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => { setStage(t.id); setPage(1) }}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              stage === t.id
                ? 'border-accent text-accent'
                : 'border-transparent text-gray-500 hover:text-text-primary'
            }`}
          >
            {t.label}
            {tabCounts[t.id] > 0 && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                stage === t.id ? 'bg-accent/10 text-accent' : 'bg-gray-100 text-gray-500'
              }`}>
                {tabCounts[t.id].toLocaleString('es-CL')}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400 gap-2 text-sm">
          <Loader2 size={16} className="animate-spin" /> Cargando…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {items.map(item => {
              const stageStyle = item.account_stage ? (STAGE_COLORS[item.account_stage] ?? { bg: '#f3f4f6', text: '#9ca3af' }) : null

              return (
                <Link
                  key={item.id}
                  href={`/dashboard/transportistas/empresa/${item.id}`}
                  className="bg-white rounded-xl border border-border p-5 hover:border-accent hover:shadow-md transition-all group flex flex-col gap-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center shrink-0 group-hover:bg-accent/10 transition-colors">
                        <Building2 size={18} className="text-gray-500 group-hover:text-accent transition-colors" />
                      </div>
                      <div className="min-w-0">
                        <h2 className="text-sm font-semibold text-text-primary leading-tight line-clamp-2">
                          {item.business_name ?? <span className="italic text-gray-400">Sin nombre</span>}
                        </h2>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {item.rut && <p className="text-xs text-gray-400 font-mono">{item.rut}</p>}
                          {item.admin_id && (
                            <span className="text-[10px] text-gray-300 font-mono">#{item.admin_id}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <ChevronRight size={16} className="text-gray-300 group-hover:text-accent shrink-0 mt-0.5 transition-colors" />
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {stageStyle && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: stageStyle.bg, color: stageStyle.text }}>
                        {item.account_stage}
                      </span>
                    )}
                    {item.has_manual_edits && (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-500">Editado</span>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-1 border-t border-border/60">
                    {[
                      { label: 'Conductores', value: item.driver_count },
                      { label: 'Vehículos',   value: item.vehicle_count },
                      { label: 'Ramplas',     value: item.trailer_count },
                    ].map(({ label, value }) => (
                      <div key={label} className="text-center">
                        <p className="font-mulish font-bold text-lg text-text-primary">{value}</p>
                        <p className="text-[10px] text-gray-400">{label}</p>
                      </div>
                    ))}
                  </div>
                </Link>
              )
            })}

            {items.length === 0 && (
              <div className="col-span-3 bg-white rounded-xl border border-border p-12 text-center text-sm text-gray-400">
                {q ? `Sin resultados para "${q}"` : 'Sin empresas en esta categoría'}
              </div>
            )}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-gray-50 disabled:opacity-40 transition-colors">
                ← Anterior
              </button>
              <span className="text-xs text-gray-500 px-2">Página {page} de {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-gray-50 disabled:opacity-40 transition-colors">
                Siguiente →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
