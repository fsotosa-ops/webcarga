'use client'

import { useEffect, useState, useCallback } from 'react'
import { Search, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import { tripsApi } from '@/lib/api/trips'
import type { Trip } from '@/lib/types'
import { TripTable } from '@/components/dashboard/TripTable'
import { TripSlideOver } from '@/components/dashboard/TripSlideOver'

type Tab = 'en_curso' | 'historial'

function todayISO() {
  return new Date().toISOString().split('T')[0]
}

function fmtDate(iso: string) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('es-CL', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function prevDay(iso: string) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

function nextDay(iso: string) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}

export default function DiarioPage() {
  const [tab, setTab]               = useState<Tab>('en_curso')
  const [fecha, setFecha]           = useState(todayISO)
  const [q, setQ]                   = useState('')
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')
  const [statusFilter, setStatus]   = useState('')
  const [trips, setTrips]           = useState<Trip[]>([])
  const [total, setTotal]           = useState(0)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [selected, setSelected]     = useState<Trip | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    const params =
      tab === 'en_curso'
        ? { fecha, view: 'en_curso' as const, q, limit: 200 }
        : { view: 'historial' as const, q, fecha_desde: fechaDesde, fecha_hasta: fechaHasta, status: statusFilter, limit: 200 }

    tripsApi.list(params)
      .then(res => { setTrips(res.data); setTotal(res.count) })
      .catch(e => setError(e instanceof Error ? e.message : 'Error cargando viajes'))
      .finally(() => setLoading(false))
  }, [tab, fecha, q, fechaDesde, fechaHasta, statusFilter])

  useEffect(() => { load() }, [load])

  function handleSaved(updated: Trip) {
    setSelected(updated)
    setTrips(prev => prev.map(t => (t.id === updated.id ? updated : t)))
  }

  const isToday = fecha === todayISO()

  return (
    <div className="flex h-full overflow-hidden relative">
      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="p-4 md:p-6 space-y-4 flex-1 overflow-y-auto">

          {/* Header */}
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="font-mulish font-bold text-xl text-text-primary capitalize">
                {tab === 'en_curso' ? fmtDate(fecha) : 'Base Histórica'}
              </h1>
              <p className="text-xs text-gray-400 mt-0.5">
                {loading ? '…' : `${total.toLocaleString('es-CL')} viaje${total !== 1 ? 's' : ''}`}
              </p>
            </div>

            {tab === 'en_curso' && (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setFecha(prevDay(fecha))}
                  className="px-2.5 py-1.5 text-xs border border-border rounded-lg hover:bg-white hover:border-accent transition-colors text-gray-500"
                >
                  <ChevronLeft size={14} className="inline -mt-0.5" /> Anterior
                </button>
                {!isToday && (
                  <button
                    onClick={() => setFecha(todayISO())}
                    className="px-2.5 py-1.5 text-xs border border-border rounded-lg text-accent font-medium hover:bg-white hover:border-accent transition-colors"
                  >
                    Hoy
                  </button>
                )}
                <button
                  onClick={() => setFecha(nextDay(fecha))}
                  className="px-2.5 py-1.5 text-xs border border-border rounded-lg hover:bg-white hover:border-accent transition-colors text-gray-500"
                >
                  Siguiente <ChevronRight size={14} className="inline -mt-0.5" />
                </button>
              </div>
            )}
          </div>

          {/* Tabs */}
          <div className="flex gap-0 border-b border-border">
            <button
              onClick={() => setTab('en_curso')}
              className={`pb-2.5 px-1 mr-6 text-sm font-medium border-b-2 transition-colors ${
                tab === 'en_curso'
                  ? 'border-accent text-accent'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              En Curso (Hoy)
            </button>
            <button
              onClick={() => setTab('historial')}
              className={`pb-2.5 px-1 text-sm font-medium border-b-2 transition-colors ${
                tab === 'historial'
                  ? 'border-accent text-accent'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              Base Histórica y Filtros
            </button>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Tracto, conductor, EETT…"
                className="pl-9 pr-4 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/30 w-56 bg-white"
              />
            </div>

            {tab === 'historial' && (
              <>
                <input
                  type="date"
                  value={fechaDesde}
                  onChange={e => setFechaDesde(e.target.value)}
                  className="px-3 py-2 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
                <span className="text-xs text-gray-400">→</span>
                <input
                  type="date"
                  value={fechaHasta}
                  onChange={e => setFechaHasta(e.target.value)}
                  className="px-3 py-2 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
                <select
                  value={statusFilter}
                  onChange={e => setStatus(e.target.value)}
                  className="px-3 py-2 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-accent/30"
                >
                  <option value="">Todos los estados</option>
                  <option value="ASIGNADO">ASIGNADO</option>
                  <option value="RUTA">RUTA</option>
                  <option value="EN LOCAL">EN LOCAL</option>
                  <option value="RETORNANDO">RETORNANDO</option>
                  <option value="RETORNADO CD">RETORNADO CD</option>
                  <option value="CANCELADO">CANCELADO</option>
                  <option value="CERRADO FINALIZADO">CERRADO FINALIZADO</option>
                  <option value="CERRADO INCOMPLETO">CERRADO INCOMPLETO</option>
                </select>
              </>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3">{error}</div>
          )}

          {/* Table */}
          {loading ? (
            <div className="flex items-center justify-center py-20 text-gray-400 gap-2 text-sm">
              <Loader2 size={16} className="animate-spin" /> Cargando…
            </div>
          ) : (
            <TripTable
              trips={trips}
              selectedId={selected?.id ?? null}
              onSelect={setSelected}
            />
          )}
        </div>
      </div>

      {/* Slide-over */}
      <TripSlideOver
        trip={selected}
        onClose={() => setSelected(null)}
        onSaved={handleSaved}
      />
    </div>
  )
}
