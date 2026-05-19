'use client'

import { useEffect, useState, useCallback } from 'react'
import { Search, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import { tripsApi } from '@/lib/api/trips'
import { transportersApi } from '@/lib/api/transporters'
import type { Trip, ComplianceAlertSummary } from '@/lib/types'
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

type BoolFilter = boolean | null

export default function DiarioPage() {
  const [tab, setTab]               = useState<Tab>('en_curso')
  const [fecha, setFecha]           = useState(todayISO)
  const [q, setQ]                   = useState('')
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')
  const [statusFilter, setStatus]   = useState('')
  const [fActivo, setFActivo]             = useState<BoolFilter>(null)
  const [fTrabajando, setFTrabajando]     = useState<BoolFilter>(null)
  const [fAsignado, setFAsignado]         = useState<BoolFilter>(null)
  const [fPrimeraVuelta, setFPrimeraVuelta] = useState<BoolFilter>(null)
  const [trips, setTrips]           = useState<Trip[]>([])
  const [total, setTotal]           = useState(0)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [selected, setSelected]     = useState<Trip | null>(null)
  const [alertSummary, setAlertSummary] = useState<ComplianceAlertSummary | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    const boolParams = {
      ...(fActivo        != null ? { activo:         fActivo }        : {}),
      ...(fTrabajando    != null ? { trabajando:     fTrabajando }    : {}),
      ...(fAsignado      != null ? { asignado:       fAsignado }      : {}),
      ...(fPrimeraVuelta != null ? { primera_vuelta: fPrimeraVuelta } : {}),
    }
    const params =
      tab === 'en_curso'
        ? { fecha, view: 'en_curso' as const, q, limit: 200, ...boolParams }
        : { view: 'historial' as const, q, fecha_desde: fechaDesde, fecha_hasta: fechaHasta, status: statusFilter, limit: 200, ...boolParams }

    tripsApi.list(params)
      .then(res => { setTrips(res.data); setTotal(res.count) })
      .catch(e => setError(e instanceof Error ? e.message : 'Error cargando viajes'))
      .finally(() => setLoading(false))
  }, [tab, fecha, q, fechaDesde, fechaHasta, statusFilter, fActivo, fTrabajando, fAsignado, fPrimeraVuelta])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    transportersApi.getComplianceAlertSummary()
      .then(setAlertSummary)
      .catch(console.error)
  }, [])

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
          <div className="space-y-2">
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

            {/* Boolean flag filters */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {([
                { key: 'activo',         label: 'Activo',      val: fActivo,        set: setFActivo,        on: 'bg-blue-500 text-white border-blue-500',    off: 'bg-blue-50 text-blue-600 border-blue-200' },
                { key: 'trabajando',     label: 'Trabajando',  val: fTrabajando,    set: setFTrabajando,    on: 'bg-green-500 text-white border-green-500',  off: 'bg-green-50 text-green-600 border-green-200' },
                { key: 'asignado',       label: 'Asignado',    val: fAsignado,      set: setFAsignado,      on: 'bg-violet-500 text-white border-violet-500', off: 'bg-violet-50 text-violet-600 border-violet-200' },
                { key: '1ra_vuelta',     label: '1ra Vuelta',  val: fPrimeraVuelta, set: setFPrimeraVuelta, on: 'bg-amber-500 text-white border-amber-500',  off: 'bg-amber-50 text-amber-600 border-amber-200' },
              ] as const).map(f => (
                <button
                  key={f.key}
                  onClick={() => f.set(prev => prev === true ? null : true)}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                    f.val === true ? f.on : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {f.label}
                </button>
              ))}
              {(fActivo != null || fTrabajando != null || fAsignado != null || fPrimeraVuelta != null) && (
                <button
                  onClick={() => { setFActivo(null); setFTrabajando(null); setFAsignado(null); setFPrimeraVuelta(null) }}
                  className="text-[11px] text-gray-400 hover:text-gray-600 px-1.5 py-1 transition-colors"
                >
                  ✕ limpiar
                </button>
              )}
            </div>
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
              onSaved={handleSaved}
              alertSummary={alertSummary}
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
