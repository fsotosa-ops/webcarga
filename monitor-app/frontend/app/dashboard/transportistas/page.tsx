'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Building2, ChevronRight, Search, Loader2, AlertTriangle, ShieldCheck } from 'lucide-react'
import { transportersApi } from '@/lib/api/transporters'
import type { TransporterListItem } from '@/lib/types'

export default function EmpresasTransportePage() {
  const [items, setItems] = useState<TransporterListItem[]>([])
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const LIMIT = 60

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setPage(1)
    transportersApi.list({ q, stage: 'Operational', page: 1, limit: LIMIT })
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
  }, [q])

  useEffect(() => {
    if (page === 1) return
    let cancelled = false
    setLoading(true)
    transportersApi.list({ q, stage: 'Operational', page, limit: LIMIT })
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
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-mulish font-bold text-xl text-text-primary">Empresas de Transporte</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {loading ? '…' : `${total.toLocaleString('es-CL')} empresa${total !== 1 ? 's' : ''} operacionales`}
          </p>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            value={q}
            onChange={e => { setQ(e.target.value); setPage(1) }}
            placeholder="Nombre o RUT…"
            className="pl-9 pr-4 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/30 w-56 bg-white"
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
      ) : (
        <>
          <div className="bg-white rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-[10px] font-bold text-gray-400 uppercase tracking-wide bg-gray-50">
                  <th className="px-5 py-3 text-left">Empresa</th>
                  <th className="px-4 py-3 text-left w-32">RUT</th>
                  <th className="px-4 py-3 text-center w-24">Conductores</th>
                  <th className="px-4 py-3 text-center w-24">Tractos</th>
                  <th className="px-4 py-3 text-left w-36">Cumplimiento</th>
                  <th className="px-3 py-3 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr
                    key={item.id}
                    className={`border-b border-border/60 last:border-0 transition-colors ${
                      i % 2 === 1 ? 'bg-gray-50/40 hover:bg-gray-50' : 'hover:bg-gray-50/70'
                    }`}
                  >
                    <td className="px-5 py-3">
                      <Link
                        href={`/dashboard/transportistas/empresa/${item.id}`}
                        className="flex items-center gap-3 group"
                      >
                        <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0 group-hover:bg-accent/10 transition-colors">
                          <Building2 size={14} className="text-gray-400 group-hover:text-accent transition-colors" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-text-primary group-hover:text-accent transition-colors truncate leading-tight">
                            {item.business_name ?? <span className="italic text-gray-400">Sin nombre</span>}
                          </p>
                          {item.admin_id && (
                            <p className="text-[10px] text-gray-300 font-mono">#{item.admin_id}</p>
                          )}
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">
                      {item.rut ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="font-bold text-sm text-slate-700">{item.driver_count}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="font-bold text-sm text-slate-700">{item.vehicle_count}</span>
                    </td>
                    <td className="px-4 py-3">
                      {item.has_active_alerts ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-100">
                          <AlertTriangle size={9} /> Con alertas
                        </span>
                      ) : item.driver_count > 0 || item.vehicle_count > 0 ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-100">
                          <ShieldCheck size={9} /> Al día
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <Link
                        href={`/dashboard/transportistas/empresa/${item.id}`}
                        className="text-gray-300 hover:text-accent transition-colors"
                      >
                        <ChevronRight size={15} />
                      </Link>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-14 text-center text-sm text-gray-400">
                      {q ? `Sin resultados para "${q}"` : 'Sin empresas operacionales'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-gray-50 disabled:opacity-40 transition-colors"
              >
                ← Anterior
              </button>
              <span className="text-xs text-gray-500 px-2">Página {page} de {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-gray-50 disabled:opacity-40 transition-colors"
              >
                Siguiente →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
